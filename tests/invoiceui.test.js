// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import StepPrices from '../src/components/steps/StepPrices.jsx';
import ProPaywall from '../src/components/ProPaywall.jsx';
import { newDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { SIM_PRO_KEY, isPro } from '../src/lib/pro.js';

vi.mock('../src/lib/photos.js', async (orig) => ({
  ...(await orig()),
  compressInvoiceImage: vi.fn(async () => ({ dataUrl: `data:image/jpeg;base64,/9j/${'A'.repeat(200)}`, width: 100, height: 100 })),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const NOW = new Date(2026, 9, 22, 9, 0, 0).getTime();

let host;
let root;
const probe = { draft: null };
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = (ms = 10) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 5)); });
const pickFile = (input, type = 'image/jpeg') =>
  act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'factura.jpg', { type })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
  });

const h = React.createElement;
function Harness({ onPro }) {
  const [draft, setDraft] = useState(() => {
    const d = newDraft('CL');
    d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
    return d;
  });
  probe.draft = draft;
  const result = useMemo(() => computeAll(draft, NOW), [draft]);
  return h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(StepPrices, { draft, setDraft, result, now: NOW, onRefresh: () => {}, onPro }));
}

const ok = (items, extra = {}) => ({ ok: true, status: 200, json: async () => ({ ok: true, isInvoice: true, currency: 'CLP', taxIncluded: false, supplier: 'Ferretería Sur', items, ...extra }) });
const fail = (status, error) => ({ ok: false, status, json: async () => ({ ok: false, error }) });
const L = (materialId, unitPriceText, extra = {}) => ({ materialId, description: `${materialId} factura`, quantity: 10, unit: 'u', unitPriceText, priceBasis: 'sale_unit', ...extra });

async function mount(onPro = vi.fn()) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(h(Harness, { onPro })));
  return onPro;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('"Leer factura con IA" is a PRO function behind the paywall', () => {
  it('free user: the button carries a PRO badge and opens the paywall (reason "ai"), never the reader', async () => {
    const onPro = await mount();
    const btn = q('invoice-open');
    expect(btn.textContent).toContain('Leer factura con IA');
    expect(btn.textContent).toContain('PRO');
    await click(btn);
    expect(onPro).toHaveBeenCalledWith('ai');
    expect(q('invoice-sheet')).toBeNull();
    expect(q('invoice-camera-input')).toBeNull();
  });

  it('the paywall explains it and offers the development-only switch that unlocks it on localhost', async () => {
    const onClose = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(ProPaywall, { feature: 'ai', onClose }))));
    expect(q('pro-reason').textContent).toContain('lectura de facturas con IA');
    expect(q('pro-subscribe').disabled).toBe(true); // billing still simulated
    expect(isPro()).toBe(false);
    await click(q('pro-dev-activate'));
    expect(localStorage.getItem(SIM_PRO_KEY)).toBe('1');
    expect(isPro()).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('PRO user: the button has no PRO badge and opens the camera / upload sheet', async () => {
    localStorage.setItem(SIM_PRO_KEY, '1');
    const onPro = await mount();
    expect(q('invoice-open').textContent).not.toMatch(/PRO$/);
    await click(q('invoice-open'));
    expect(onPro).not.toHaveBeenCalled();
    expect(q('invoice-sheet').dataset.phase).toBe('pick');
    expect(q('invoice-camera-input').getAttribute('capture')).toBe('environment');
    expect(q('invoice-file-input').getAttribute('accept')).toContain('image/png');
    expect(q('invoice-sheet').textContent).toContain('Gemini');
  });
});

describe('invoice -> proxy -> review -> real prices in the quote', () => {
  const open = async () => {
    localStorage.setItem(SIM_PRO_KEY, '1');
    await mount();
    await click(q('invoice-open'));
  };

  it('uploads the photo to OUR endpoint, lists the matches, applies the chosen prices as manual overrides', async () => {
    const f = vi.fn(async () => ok([L('cement_bag', '4.990'), L('sand', '14.500'), L('block_14', '890'), { ...L(null, '12.000'), description: 'Flete' }]));
    vi.stubGlobal('fetch', f);
    await open();
    await pickFile(q('invoice-file-input'));
    await flush();

    // exactly one request, to the same-origin proxy, carrying the compressed image and no secrets
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/extract-invoice');
    const sent = JSON.parse(init.body);
    expect(sent.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(sent.currency).toBe('CLP');
    expect(JSON.stringify(init)).not.toMatch(/AIza|key/i);

    expect(q('invoice-sheet').dataset.phase).toBe('review');
    expect(q('invoice-sheet').textContent).toContain('Ferretería Sur');
    const rows = [...document.querySelectorAll('[data-testid^="invoice-row-"]')].map((r) => r.dataset.testid);
    expect(rows.sort()).toEqual(['invoice-row-cement_bag', 'invoice-row-sand']); // block_14 is not in a slab quote; "Flete" has no match
    expect(q('invoice-ignored').textContent).toContain('2');
    expect(q('invoice-apply').textContent).toBe('Aplicar 2 precios');

    // untick one, apply the other
    await click(q('invoice-row-sand').querySelector('input[type="checkbox"]'));
    expect(q('invoice-apply').textContent).toBe('Aplicar 1 precios');
    const before = probe.draft.overrides;
    expect(before).toEqual({});
    await click(q('invoice-apply'));
    expect(probe.draft.overrides).toEqual({ cement_bag: 4990 });
    expect(q('invoice-sheet')).toBeNull(); // sheet closed
    expect(q('invoice-applied').textContent).toContain('1 precios');
    // the price list now shows the invoice price as the MANUAL (non-simulated) one
    const manual = [...document.querySelectorAll('span')].filter((s) => s.textContent === 'Manual');
    expect(manual.length).toBe(1);
  });

  it('shows a friendly, translated error for every proxy failure and lets the user try again', async () => {
    for (const [status, code, text] of [
      [503, 'not_configured', 'servidor sin configurar'],
      [429, 'rate_limited', 'Demasiadas lecturas'],
      [422, 'not_invoice', 'no parece una factura'],
      [502, 'upstream', 'no respondió bien'],
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => fail(status, code)));
      localStorage.setItem(SIM_PRO_KEY, '1');
      await mount();
      await click(q('invoice-open'));
      await pickFile(q('invoice-file-input'));
      await flush();
      expect(q('invoice-error').dataset.code, code).toBe(code);
      expect(q('invoice-error').textContent, code).toContain(text);
      expect(q('invoice-sheet').dataset.phase).toBe('pick'); // can retry
      expect(probe.draft.overrides).toEqual({});
      act(() => root.unmount());
      host.remove();
    }
    // afterEach unmounts again: re-mount something so it has a root to unmount
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  it('no network: offline message; a photo that cannot be read: photo message; nothing is applied', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await open();
    await pickFile(q('invoice-file-input'));
    await flush();
    expect(q('invoice-error').textContent).toContain('Sin conexión');
    const { compressInvoiceImage, PhotoError } = await import('../src/lib/photos.js');
    compressInvoiceImage.mockRejectedValueOnce(new PhotoError('decode'));
    await pickFile(q('invoice-file-input'));
    await flush();
    expect(q('invoice-error').dataset.code).toBe('photo');
    expect(probe.draft.overrides).toEqual({});
  });

  it('reading can be cancelled and nothing is applied', async () => {
    vi.stubGlobal('fetch', vi.fn((_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))))));
    await open();
    await pickFile(q('invoice-file-input'));
    expect(q('invoice-reading').textContent).toContain('Leyendo la factura');
    await click(q('invoice-cancel'));
    await flush();
    expect(q('invoice-sheet').dataset.phase).toBe('pick');
    expect(q('invoice-error')).toBeNull();
  });

  it('an invoice in another currency is shown but cannot be applied; a doubtful price is not preselected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok([L('cement_bag', '4,99')], { currency: 'USD' })));
    await open();
    await pickFile(q('invoice-file-input'));
    await flush();
    expect(q('invoice-currency').textContent).toContain('USD');
    expect(q('invoice-apply').disabled).toBe(true);
    expect(q('invoice-row-cement_bag').querySelector('input').disabled).toBe(true);

    await click(q('invoice-retry'));
    vi.stubGlobal('fetch', vi.fn(async () => ok([L('cement_bag', '4.990.000', { quantity: null })])));
    await pickFile(q('invoice-file-input'));
    await flush();
    expect(q('invoice-row-cement_bag').dataset.suspicious).toBe('true');
    expect(q('invoice-apply').disabled).toBe(true); // unticked by default
    await click(q('invoice-row-cement_bag').querySelector('input'));
    expect(q('invoice-apply').disabled).toBe(false); // the user may still opt in
  });

  it('a signed-in free user can still use every other part of the price step', async () => {
    await mount();
    expect(q('prices-auto')).not.toBeNull();
    expect(document.querySelectorAll('li.card').length).toBeGreaterThan(0);
  });
});
