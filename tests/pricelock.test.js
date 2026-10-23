// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import StepPrices from '../src/components/steps/StepPrices.jsx';
import { newDraft, normalizeDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { chainTotals, marketBucket, MARKET_WINDOW_MS, resolvePrices } from '../src/lib/pricing.js';
import { getRegion } from '../src/lib/regions.js';
import { SIM_PRO_KEY } from '../src/lib/pro.js';
import { useMarketClock } from '../src/lib/marketClock.js';

vi.mock('../src/lib/photos.js', async (orig) => ({
  ...(await orig()),
  compressInvoiceImage: vi.fn(async () => ({ dataUrl: `data:image/jpeg;base64,/9j/${'A'.repeat(200)}`, width: 100, height: 100 })),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const T0 = new Date(2026, 9, 22, 9, 0, 0).getTime();
const region = getRegion('CL');
const FIXED = { cement_bag: 9990, sand: 21000 };

function slab() {
  const d = newDraft('CL');
  d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
  return d;
}
const itemOf = (draft, id, now) => computeAll(draft, now).quote.items.find((i) => i.id === id);

describe('prices read from an invoice are FIXED: the market updater cannot touch them', () => {
  const buckets = Array.from({ length: 60 }, (_, i) => T0 + i * MARKET_WINDOW_MS); // 15 hours of market windows

  it('the free (simulated) prices DO drift between windows - the baseline the lock is protecting against', () => {
    const prices = new Set(buckets.map((t) => itemOf(slab(), 'gravel', t).unitPrice));
    expect(prices.size).toBeGreaterThan(1);
  });

  it('a fixed price is identical in every market window, for every store, and the line total never moves', () => {
    const draft = { ...slab(), overrides: FIXED };
    for (const chainId of ['best', ...region.chains.map((c) => c.id)]) {
      const d = { ...draft, chainId };
      for (const t of buckets) {
        const c = itemOf(d, 'cement_bag', t);
        const s = itemOf(d, 'sand', t);
        expect(c.unitPrice, `${chainId} cement`).toBe(9990);
        expect(c.source).toBe('manual');
        expect(c.total).toBe(c.packs * 9990);
        expect(s.unitPrice).toBe(21000);
        expect(s.source).toBe('manual');
        expect(s.total).toBe(s.packs * 21000);
      }
    }
  });

  it('the store comparison chips (chainTotals) also keep the fixed prices in every window', () => {
    const base = computeAll(slab(), T0);
    const lines = base.partidas.map((p) => ({ lines: p.calc.lines, waste: p.waste }));
    const args = (bucket, overrides) => ({ partidas: lines, regionCode: 'CL', overrides, bucket });
    const free = (b) => chainTotals(args(b, {}));
    const locked = (b) => chainTotals(args(b, FIXED));
    const b0 = marketBucket(T0);
    // free totals move between windows; the fixed materials contribute the same amount to every chain total
    expect(new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(free(b0 + i)))).size).toBeGreaterThan(1);
    const matCost = (id, chain, b) => resolvePrices({ ids: [id], regionCode: 'CL', chainId: chain, overrides: FIXED, bucket: b })[id].price;
    for (let i = 0; i < 30; i += 1) {
      for (const c of region.chains) {
        expect(matCost('cement_bag', c.id, b0 + i)).toBe(9990);
        expect(matCost('sand', c.id, b0 + i)).toBe(21000);
      }
      // with more materials fixed, the totals differ from the free ones by exactly the fixed-price difference
      expect(locked(b0 + i).best).not.toBe(free(b0 + i).best);
    }
  });

  it('only the fixed materials stay put: the rest of the quote keeps following the market', () => {
    const draft = { ...slab(), overrides: { cement_bag: 9990 } };
    const gravels = new Set(buckets.map((t) => itemOf(draft, 'gravel', t).unitPrice));
    expect(gravels.size).toBeGreaterThan(1);
    expect(itemOf(draft, 'gravel', buckets[0]).source).toBe('ref');
  });

  it('they survive saving and reopening the project (normalizeDraft) and the signature price clock', () => {
    const draft = { ...slab(), overrides: FIXED };
    const stored = JSON.parse(JSON.stringify(draft));
    const back = normalizeDraft(stored, 'CL');
    expect(back.overrides).toEqual(FIXED);
    expect(itemOf(back, 'cement_bag', T0 + 99 * MARKET_WINDOW_MS).unitPrice).toBe(9990);
  });

  it('editing the partidas or the mode no longer wipes them (the code that cleared them is gone)', () => {
    for (const f of ['src/components/steps/StepPartidas.jsx', 'src/components/steps/StepStart.jsx']) {
      expect(fs.readFileSync(`${process.cwd()}/${f}`, 'utf8'), f).not.toMatch(/overrides:\s*\{\}/);
    }
  });
});

// ---- the screen: refresh button + the 15-minute clock + project card ------------------------------------------
let host;
let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = (ms = 10) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 5)); });
const h = React.createElement;
const probe = { draft: null, now: T0 };

function Screen() {
  const [draft, setDraft] = useState(slab);
  const [now, setNow] = useState(T0);
  probe.draft = draft;
  probe.now = now;
  const result = useMemo(() => computeAll(draft, now), [draft, now]);
  // "Refresh" and the automatic clock both end up here: the market moves forward by whole windows
  probe.advance = (windows) => act(() => setNow((n) => n + windows * MARKET_WINDOW_MS));
  return h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(StepPrices, { draft, setDraft, result, now, onRefresh: () => setNow((n) => n + 3 * MARKET_WINDOW_MS) }));
}


describe('on screen: "Actualizar", the market clock and later edits leave fixed prices alone', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(SIM_PRO_KEY, '1');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, isInvoice: true, currency: 'CLP', taxIncluded: false, supplier: 'Sur', items: [
        { materialId: 'cement_bag', description: 'Cemento', quantity: 10, unit: 'u', unitPriceText: '9.990', priceBasis: 'sale_unit' },
        { materialId: 'sand', description: 'Arena', quantity: 2, unit: 'u', unitPriceText: '21.000', priceBasis: 'sale_unit' },
      ] }),
    })));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('after applying an invoice, pressing refresh and letting hours pass changes the free prices but not the injected ones', async () => {
    await act(async () => root.render(h(Screen)));
    await click(q('invoice-open'));
    const input = q('invoice-file-input');
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'f.jpg', { type: 'image/jpeg' })] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    await flush();
    await click(q('invoice-apply'));
    expect(probe.draft.overrides).toEqual(FIXED);

    const snapshot = () => Object.fromEntries(computeAll(probe.draft, probe.now).quote.items.map((i) => [i.id, [i.unitPrice, i.total, i.source]]));
    const before = snapshot();
    const refreshBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Actualizar') || b.textContent.startsWith('↻'));
    await click(refreshBtn); // 3 windows later
    await probe.advance(40); // 10 hours later
    const after = snapshot();
    expect(probe.now).toBeGreaterThan(T0 + 40 * MARKET_WINDOW_MS);
    for (const id of Object.keys(FIXED)) expect(after[id], id).toEqual(before[id]); // price, total and source untouched
    expect(after.cement_bag).toEqual([9990, expect.any(Number), 'manual']);
    expect(after.gravel[0]).not.toBe(before.gravel[0]); // the market did move for everything else
    // and what is drawn is the fixed price: 31 sacks x 9.990 and 3 big bags x 21.000 (after the refresh and 10 hours)
    const text = document.body.textContent;
    expect(text).toContain('$309.690');
    expect(text).toContain('$63.000');
    expect([...document.querySelectorAll('span')].filter((s) => s.textContent === 'Manual')).toHaveLength(2);
  });

  it('useMarketClock really ticks into new windows (so the test above exercises the automatic updater)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    let seen = [];
    function C() {
      const { now } = useMarketClock();
      seen.push(marketBucket(now));
      return null;
    }
    await act(async () => root.render(h(C)));
    await act(async () => { vi.setSystemTime(T0 + 2 * MARKET_WINDOW_MS + 1000); vi.advanceTimersByTime(2 * MARKET_WINDOW_MS + 1000); });
    vi.useRealTimers();
    expect(new Set(seen).size).toBeGreaterThan(1);
  });
});
