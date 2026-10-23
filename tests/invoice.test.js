// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import {
  parseAmount,
  normalizeExtraction,
  planInvoicePrices,
  overridesFromRows,
  requestExtraction,
  InvoiceError,
  ERROR_CODES,
  INVOICE_ENDPOINT,
  INVOICE_LIMITS,
} from '../src/lib/invoice.js';
import { newDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { taxRateFor } from '../src/lib/pricing.js';
import { CATALOG } from '../src/lib/catalog.js';
import { getRegion } from '../src/lib/regions.js';
import { compressInvoiceImage, PhotoError } from '../src/lib/photos.js';
import { DICT } from '../src/lib/dict.js';
import { LANGS } from '../src/lib/regions.js';
import { isPro, setSimulatedPro, SIM_PRO_KEY, isProFeature } from '../src/lib/pro.js';

const NOW = new Date(2026, 9, 22, 9, 0, 0).getTime();
const region = getRegion('CL');

function validDraft() {
  const d = newDraft('CL'); // default partida: slab -> cement, sand, gravel, mesh, poly
  d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
  return d;
}
const quote = () => computeAll(validDraft(), NOW).quote;
const line = (over = {}) => ({ description: 'x', materialId: 'cement_bag', quantity: 10, unitPriceText: '4.990', priceBasis: 'sale_unit', ...over });

describe('parseAmount: figures exactly as printed, in any country format', () => {
  it.each([
    ['4.990', 4990], // CLP / COP / CRC thousands
    ['14.500', 14500],
    ['1.234.567', 1234567],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['12,5', 12.5],
    ['9.49', 9.49],
    ['0.500', 0.5],
    ['$ 4 990', 4990],
    ['CLP 15.990', 15990],
    ['890', 890],
    ['1234.567', 1234.567],
  ])('%s -> %s', (text, n) => expect(parseAmount(text)).toBe(n));
  it('rejects non numbers', () => {
    for (const v of ['', 'gratis', null, undefined, {}, '-', '0', 0, -5, NaN, Infinity]) expect(parseAmount(v), String(v)).toBeNull();
    expect(parseAmount(12.5)).toBe(12.5);
  });
});

describe('normalizeExtraction: nothing the model prints can break the app', () => {
  it('keeps catalog ids only, bounds numbers, strips markup, uses the printed text over the number', () => {
    const ex = normalizeExtraction({
      isInvoice: true,
      currency: ' clp ',
      taxIncluded: true,
      supplier: '<b>Sur</b>\u0000 SpA',
      invoiceDate: '2026-10-20',
      items: [
        line({ unitPrice: 4.99 }),
        line({ materialId: 'nope', description: '<script>x</script>' }),
        line({ materialId: '__proto__' }),
        line({ unitPriceText: '', unitPrice: 12.5, quantity: 'abc' }),
        line({ unitPriceText: 'gratis' }),
        line({ priceBasis: 'weird' }),
        null,
        7,
      ],
    });
    expect(ex.currency).toBe('CLP');
    expect(ex.taxIncluded).toBe(true);
    expect(ex.supplier).toBe('b Sur /b SpA');
    expect(ex.items.map((i) => i.materialId)).toEqual(['cement_bag', null, null, 'cement_bag', 'cement_bag']);
    expect(ex.items[0].unitPrice).toBe(4990); // not the model's 4.99
    expect(ex.items[1].description).not.toMatch(/[<>]/);
    expect(ex.items[3]).toMatchObject({ unitPrice: 12.5, quantity: null });
    expect(ex.items[4].priceBasis).toBe('sale_unit');
    expect(normalizeExtraction(undefined)).toMatchObject({ items: [], isInvoice: true });
    expect(normalizeExtraction({ isInvoice: false }).isInvoice).toBe(false);
    expect(normalizeExtraction({ currency: 'PESOS', invoiceDate: 'hoy' })).toMatchObject({ currency: '', date: '' });
  });
  it('flags a line whose quantity x price does not match its printed total', () => {
    const [ok, bad, unknown] = normalizeExtraction({ items: [line({ lineTotalText: '49.900' }), line({ lineTotalText: '4.990' }), line({ lineTotalText: undefined })] }).items;
    expect([ok.consistent, bad.consistent, unknown.consistent]).toEqual([true, false, null]);
  });
});

describe('planInvoicePrices: map invoice lines onto the CURRENT quote', () => {
  const q = quote();
  const ids = q.items.map((i) => i.id);
  const plan = (items, extra = {}, opts = {}) => planInvoicePrices({ currency: 'CLP', items, ...extra }, { quoteItems: q.items, region, taxRate: 0.19, ...opts });

  it('the sample quote uses the materials we map to', () => {
    for (const id of ['cement_bag', 'sand']) expect(ids).toContain(id);
  });

  it('price per SALE unit, rounded to the currency, selected by default', () => {
    const { rows, ignored, currencyMismatch } = plan([line(), line({ materialId: 'sand', unitPriceText: '14.500' }), line({ materialId: null, description: 'Flete' })]);
    expect(currencyMismatch).toBe(false);
    expect(rows.map((r) => [r.id, r.price, r.selected, r.selectable])).toEqual([
      ['cement_bag', 4990, true, true],
      ['sand', 14500, true, true],
    ]);
    expect(ignored).toEqual([{ description: 'Flete', reason: 'nomatch' }]);
  });

  it('a price quoted per BASE unit is converted with the sale size (sand: per m3 -> big bag of 0.5 m3)', () => {
    const { rows } = plan([line({ materialId: 'sand', unitPriceText: '29.000', priceBasis: 'base_unit', lineTotalText: undefined })]);
    expect(CATALOG.sand.size).toBe(0.5);
    expect(rows[0].price).toBe(14500);
  });

  it('prices printed WITH tax are taxed out for the quote (tax is added again by the quote)', () => {
    const { rows } = plan([line({ unitPriceText: '5.938' })], { taxIncluded: true }); // 4990 * 1.19
    expect(rows[0].price).toBe(4990);
    expect(plan([line({ unitPriceText: '5.938' })], { taxIncluded: false }).rows[0].price).toBe(5938);
  });

  it('several lines of one material become one quantity-weighted average', () => {
    const { rows } = plan([line({ quantity: 10, unitPriceText: '5.000' }), line({ quantity: 30, unitPriceText: '4.000' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ price: 4250, lines: 2, quantity: 40 });
  });

  it('materials the quote does not use are ignored, a foreign currency blocks application, absurd prices are not preselected', () => {
    const out = plan([line({ materialId: 'paint_bucket', unitPriceText: '60.000' })]);
    expect(out.rows).toEqual([]);
    expect(out.ignored[0]).toMatchObject({ reason: 'notinquote', materialId: 'paint_bucket' });

    const usd = planInvoicePrices({ currency: 'USD', items: [line({ unitPriceText: '4,99' })] }, { quoteItems: q.items, region, taxRate: 0 });
    expect(usd.currencyMismatch).toBe(true);
    expect(usd.rows[0]).toMatchObject({ selectable: false, selected: false });
    expect(overridesFromRows(usd.rows, ['cement_bag'])).toEqual({});

    const odd = plan([line({ unitPriceText: '4.990.000', lineTotalText: undefined }), line({ materialId: 'sand', unitPriceText: '14.500', quantity: 2, lineTotalText: '9.000' })]);
    const cement = odd.rows.find((r) => r.id === 'cement_bag');
    expect(cement).toMatchObject({ suspicious: true, selected: false, selectable: true }); // user may still opt in
    expect(odd.rows.find((r) => r.id === 'sand')).toMatchObject({ suspicious: true, selected: false }); // total does not match
  });

  it('overridesFromRows only returns chosen, valid prices', () => {
    const { rows } = plan([line(), line({ materialId: 'sand', unitPriceText: '14.500' })]);
    expect(overridesFromRows(rows, ['sand'])).toEqual({ sand: 14500 });
    expect(overridesFromRows(rows, [])).toEqual({});
    expect(overridesFromRows(rows, ['gravel', 'x'])).toEqual({});
  });

  it('applying the overrides REPLACES the simulated prices in the quote (manual source, new total)', () => {
    const d = validDraft();
    const before = computeAll(d, NOW).quote;
    const { rows } = planInvoicePrices({ currency: 'CLP', items: [line({ unitPriceText: '9.990' })] }, { quoteItems: before.items, region, taxRate: taxRateFor(region, d.finance) });
    const after = computeAll({ ...d, overrides: overridesFromRows(rows, ['cement_bag']) }, NOW).quote;
    const was = before.items.find((i) => i.id === 'cement_bag');
    const now = after.items.find((i) => i.id === 'cement_bag');
    expect(was.source).toBe('ref');
    expect(now.source).toBe('manual');
    expect(now.unitPrice).toBe(9990);
    expect(now.total).toBe(now.packs * 9990);
    expect(after.total).not.toBe(before.total);
  });
});

describe('requestExtraction: the browser only talks to OUR proxy', () => {
  const ok = { ok: true, isInvoice: true, currency: 'CLP', items: [{ materialId: 'cement_bag', description: 'c', unitPrice: 4990, priceBasis: 'sale_unit' }] };
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  it('POSTs JSON {image, currency, lang} to /api/extract-invoice (same origin) and returns a clean extraction', async () => {
    const f = vi.fn(async () => res(200, ok));
    const ex = await requestExtraction('data:image/jpeg;base64,AAAA', { currency: 'CLP', lang: 'es', fetchImpl: f });
    expect(ex.items[0]).toMatchObject({ materialId: 'cement_bag', unitPrice: 4990 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(INVOICE_ENDPOINT);
    expect(url.startsWith('/')).toBe(true); // relative: never an absolute Google URL
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ image: 'data:image/jpeg;base64,AAAA', currency: 'CLP', lang: 'es' });
    expect(JSON.stringify(init.headers)).not.toMatch(/key|authorization/i);
  });

  it('maps every failure to a stable code the UI translates', async () => {
    const code = async (f, opts = {}) => {
      try {
        await requestExtraction('x', { fetchImpl: f, ...opts });
      } catch (e) {
        expect(e).toBeInstanceOf(InvoiceError);
        return e.code;
      }
      return 'no-error';
    };
    expect(await code(async () => res(503, { ok: false, error: 'not_configured' }))).toBe('not_configured');
    expect(await code(async () => res(429, { ok: false, error: 'rate_limited' }))).toBe('rate_limited');
    expect(await code(async () => res(400, { ok: false, error: 'bad_image' }))).toBe('bad_image');
    expect(await code(async () => res(422, { ok: false, error: 'not_invoice' }))).toBe('not_invoice');
    expect(await code(async () => res(502, { ok: false, error: '<script>' }))).toBe('upstream'); // unknown codes are not trusted
    expect(await code(async () => ({ ok: false, status: 404, json: async () => { throw new Error('html'); } }))).toBe('not_configured'); // static hosting: no /api
    expect(await code(async () => { throw new TypeError('offline'); })).toBe('network');
    expect(await code(async () => res(200, { ok: true, isInvoice: false, items: [] }))).toBe('not_invoice');
    expect(await code(async () => res(200, { ok: true, items: [] }))).toBe('unreadable');
    expect(await code(async () => res(200, { ok: true, items: [{ materialId: 'cement_bag' }] }))).toBe('unreadable'); // no usable price
  });

  it('can be cancelled', async () => {
    const ctl = new AbortController();
    const f = vi.fn((_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))));
    const p = requestExtraction('x', { fetchImpl: f, signal: ctl.signal }).catch((e) => e.code);
    ctl.abort();
    expect(await p).toBe('cancelled');
  });

  it('every error code has a message in six languages', () => {
    for (const l of LANGS) {
      for (const c of ERROR_CODES.filter((x) => x !== 'cancelled')) expect(DICT[l][`inv.err.${c}`], `${l}:${c}`).toBeTruthy();
      expect(DICT[l]['inv.err.photo']).toBeTruthy();
    }
  });
});

describe('invoice photo compression (receipts need more detail than evidence photos)', () => {
  const canvas = () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => `data:image/jpeg;base64,${'A'.repeat(1000)}` });
  it('limits the longest side to 1600 px and returns a JPEG data URL', async () => {
    const out = await compressInvoiceImage({ type: 'image/jpeg', size: 1000 }, { decode: async () => ({ source: {}, width: 4000, height: 3000, close() {} }), makeCanvas: canvas });
    expect(Math.max(out.width, out.height)).toBe(INVOICE_LIMITS.maxSide);
    expect(out.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });
  it('rejects non-images and absurd inputs', async () => {
    await expect(compressInvoiceImage({ type: 'application/pdf', size: 10 })).rejects.toBeInstanceOf(PhotoError);
    await expect(compressInvoiceImage({ type: 'image/jpeg', size: 999_999_999 })).rejects.toMatchObject({ code: 'size' });
    await expect(compressInvoiceImage(null)).rejects.toMatchObject({ code: 'type' });
  });
});

describe('PRO gate (simulated): nobody is PRO unless the development switch was used', () => {
  it('isPro is false by default; the switch is a local flag; AI reading is a PRO feature', () => {
    localStorage.clear();
    expect(isPro()).toBe(false);
    expect(isProFeature('ai')).toBe(true);
    setSimulatedPro(true);
    expect(localStorage.getItem(SIM_PRO_KEY)).toBe('1');
    expect(isPro()).toBe(true);
    setSimulatedPro(false);
    expect(isPro()).toBe(false);
    localStorage.setItem(SIM_PRO_KEY, 'yes');
    expect(isPro()).toBe(false); // only the exact flag counts
    localStorage.clear();
  });
  it('production builds can never be PRO through the flag (guarded by import.meta.env.DEV)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(`${process.cwd()}/src/lib/pro.js`, 'utf8');
    expect(src).toMatch(/if \(!import\.meta\.env\.DEV\) return false;/);
    expect(fs.readFileSync(`${process.cwd()}/src/components/ProPaywall.jsx`, 'utf8')).toMatch(/import\.meta\.env\.DEV && \(/);
  });
});
