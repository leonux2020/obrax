// @vitest-environment happy-dom
// "Moneda Base inmutable": a project works in ONE currency. A receipt printed in another one is converted ONCE (rate frozen with the
// expense: amountOriginal / currencyOriginal / exchangeRate / amountBase) and every total adds the frozen base value, never the foreign one.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ReceiptSheet from '../src/components/ReceiptSheet.jsx';
import ReceiptStack from '../src/components/workspace/ReceiptStack.jsx';
import { FX_FRESH_MS, FX_SOURCES, applyRates, baseOf, convertToBase, fetchRate, freezeExpense, needsFx, resolveRate, staticRate } from '../src/lib/fx.js';
import { cashSummary, expensesByCategory, expensesTotal, liquidity, normalizeExpenses, profitability, supplierTotals } from '../src/lib/ledger.js';
import { dropDuplicateReceipts, expenseFingerprints, normalizeReceipts } from '../src/lib/receipt.js';
import { mergeProject } from '../src/lib/merge.js';
import { newProject } from '../src/lib/projects.js';
import { makeI18n } from '../src/lib/i18n.jsx';
import { clearGeminiKey } from '../src/lib/geminiKey.js';
import { geminiReply, seedKey } from './helpers/gemini.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const memStore = (init = {}) => {
  let data = { ...init };
  return { read: () => data, write: (o) => (data = o), get data() { return data; } };
};
const okFetch = (rates) => vi.fn(async () => ({ ok: true, json: async () => ({ result: 'success', rates }) }));
const NOW = 1_800_000_000_000;

describe('fx.js: the rate', () => {
  it('fetchRate reads 1 `from` in `to` from the service and rejects everything else', async () => {
    expect(await fetchRate('EUR', 'CLP', { fetchImpl: okFetch({ CLP: 1050.5 }) })).toBe(1050.5);
    await expect(fetchRate('EUR', 'CLP', { fetchImpl: okFetch({ USD: 1 }) })).rejects.toThrow();
    await expect(fetchRate('EUR', 'CLP', { fetchImpl: okFetch({ CLP: 'abc' }) })).rejects.toThrow();
    await expect(fetchRate('EUR', 'CLP', { fetchImpl: okFetch({ CLP: -3 }) })).rejects.toThrow();
    await expect(fetchRate('EUR', 'CLP', { fetchImpl: async () => ({ ok: false }) })).rejects.toThrow();
    await expect(fetchRate('EUR', 'CLP', { fetchImpl: async () => { throw new Error('net'); } })).rejects.toThrow();
    await expect(fetchRate('EUR', 'CLP', { fetchImpl: async () => ({ ok: true, json: async () => ({ result: 'error' }) }) })).rejects.toThrow();
    await expect(fetchRate('EUR', 'CLP', { fetchImpl: null })).rejects.toThrow();
  });

  it('order: service -> (fresh) cache -> last known -> reference table -> nothing', async () => {
    const store = memStore();
    const fetchImpl = okFetch({ CLP: 1000 });
    const a = await resolveRate('EUR', 'CLP', { fetchImpl, store, now: NOW, online: true });
    expect(a).toEqual({ rate: 1000, source: 'api', at: NOW });
    // a few minutes later: served from the cache, the service is not asked again
    const b = await resolveRate('EUR', 'CLP', { fetchImpl, store, now: NOW + 60_000, online: true });
    expect(b).toMatchObject({ rate: 1000, source: 'cache' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // stale + offline: the last known rate is still a market rate
    const c = await resolveRate('EUR', 'CLP', { fetchImpl: null, store, now: NOW + FX_FRESH_MS + 1, online: false });
    expect(c).toMatchObject({ rate: 1000, source: 'cache' });
    // nothing cached, no service: the reference table (approximate)
    const d = await resolveRate('EUR', 'CLP', { fetchImpl: async () => { throw new Error('down'); }, store: memStore(), now: NOW, online: true });
    expect(d.source).toBe('static');
    expect(d.rate).toBeCloseTo(staticRate('EUR', 'CLP'), 6);
    expect(d.rate).toBeGreaterThan(100);
    // unknown currency
    expect(await resolveRate('XXX', 'CLP', { fetchImpl: null, store: memStore(), now: NOW, online: false })).toBeNull();
    expect(await resolveRate('', 'CLP', { store: memStore() })).toBeNull();
    // same currency: 1
    expect((await resolveRate('CLP', 'CLP', { store: memStore(), now: NOW })).rate).toBe(1);
  });

  it('the service being slow or down never blocks: a rejected call falls through to the table', async () => {
    const r = await resolveRate('USD', 'CLP', { fetchImpl: () => Promise.reject(new Error('x')), store: memStore(), now: NOW, online: true });
    expect(r.source).toBe('static');
  });
});

describe('fx.js: freezing', () => {
  const line = (extra = {}) => ({ id: 'aaaaaa', amount: 10, currency: 'EUR', supplier: 'Conad', unitPrice: 5, netAmount: 8, taxAmount: 2, ...extra });

  it('freezeExpense keeps the original beside the base value and converts net / tax / unit price', () => {
    const f = freezeExpense(line(), { base: 'CLP', digits: 0, rate: 1000.4, source: 'api', at: NOW });
    expect(f).toMatchObject({ currency: 'CLP', currencyOriginal: 'EUR', amountOriginal: 10, exchangeRate: 1000.4, amountBase: 10004, amount: 10004, fxSource: 'api', fxAt: NOW, unitPrice: 5002, netAmount: 8003, taxAmount: 2001 });
  });
  it('is pure and never converts twice', () => {
    const e = line();
    const copy = JSON.parse(JSON.stringify(e));
    const f = freezeExpense(e, { base: 'CLP', digits: 0, rate: 1000, source: 'api', at: NOW });
    expect(e).toEqual(copy);
    expect(needsFx(e, 'CLP')).toBe(true);
    expect(needsFx(f, 'CLP')).toBe(false); // base currency + already frozen
    const again = applyRates([f], { base: 'CLP', digits: 0, rates: { EUR: { rate: 5, source: 'api' } } });
    expect(again.expenses[0]).toBe(f);
  });
  it('a negative line (discount) stays negative and a tiny amount never rounds to nothing', () => {
    expect(freezeExpense(line({ amount: -1.2 }), { base: 'CLP', digits: 0, rate: 1000, source: 'manual' }).amountBase).toBe(-1200);
    const tiny = freezeExpense(line({ amount: 0.001, unitPrice: undefined }), { base: 'CLP', digits: 0, rate: 0.5, source: 'manual' });
    expect(tiny.amountBase).toBe(1);
  });
  it('no valid rate -> the expense comes back untouched', () => {
    const e = line();
    expect(freezeExpense(e, { base: 'CLP', rate: 0 })).toBe(e);
    expect(freezeExpense(e, { base: 'CLP', rate: 'abc' })).toBe(e);
  });
  it('applyRates lists the currencies it had no rate for; base-currency lines are not touched', () => {
    const native = { id: 'bbbbbb', amount: 500, currency: 'CLP' };
    const nocur = { id: 'cccccc', amount: 700 };
    const out = applyRates([line(), line({ id: 'dddddd', currency: 'USD' }), native, nocur], { base: 'CLP', digits: 0, rates: { EUR: { rate: 1000, source: 'api' } } });
    expect(out.missing).toEqual(['USD']);
    expect(out.expenses[0].amountBase).toBe(10000);
    expect(out.expenses[1].amountBase).toBeUndefined();
    expect(out.expenses[2]).toBe(native);
    expect(out.expenses[3]).toBe(nocur);
  });
  it('convertToBase flags approximate (table) rates and missing ones', async () => {
    const mk = (rate, source) => async () => ({ rate, source, at: NOW });
    const real = await convertToBase([line()], { base: 'CLP', digits: 0, resolve: mk(1000, 'api'), now: NOW });
    expect(real.approximate).toEqual([]);
    expect(real.expenses[0].amountBase).toBe(10000);
    const approx = await convertToBase([line()], { base: 'CLP', digits: 0, resolve: mk(1000, 'static'), now: NOW });
    expect(approx.approximate).toEqual(['EUR']);
    const none = await convertToBase([line()], { base: 'CLP', digits: 0, resolve: async () => null, now: NOW });
    expect(none.missing).toEqual(['EUR']);
    expect(none.expenses[0].currencyOriginal).toBeUndefined();
  });
  it('baseOf prefers the frozen value and is never NaN', () => {
    expect(baseOf({ amount: 5, amountBase: 7 })).toBe(7);
    expect(baseOf({ amount: '12,5' })).toBe(12.5);
    expect(baseOf({ amount: 'x' })).toBe(0);
    expect(baseOf(null)).toBe(0);
    expect(FX_SOURCES).toContain('manual');
  });
});

describe('the ledger: the frozen value is the one that counts', () => {
  const frozen = (id, amount, rate, extra = {}) => ({ id, amount: 1, amountOriginal: amount, currencyOriginal: 'EUR', exchangeRate: rate, amountBase: Math.round(amount * rate), fxSource: 'api', supplier: 'Conad', category: 'food', currency: 'CLP', ...extra });

  it('normalizeExpenses keeps the four fields and forces amount = amountBase (a tampered amount cannot override it)', () => {
    const [e] = normalizeExpenses([frozen('aaaaaa', 10, 1000)]);
    expect(e).toMatchObject({ amountOriginal: 10, currencyOriginal: 'EUR', exchangeRate: 1000, amountBase: 10000, amount: 10000, fxSource: 'api' });
  });
  it('a record without amountBase gets original x rate; a broken snapshot is a plain expense', () => {
    const [a] = normalizeExpenses([{ id: 'bbbbbb', amount: 3, amountOriginal: 10, currencyOriginal: 'EUR', exchangeRate: 900 }]);
    expect(a.amountBase).toBe(9000);
    const [b] = normalizeExpenses([{ id: 'cccccc', amount: 3, amountOriginal: 10, currencyOriginal: 'EUR', exchangeRate: -1 }]);
    expect(b.amount).toBe(3);
    expect(b.amountBase).toBeUndefined();
    const [c] = normalizeExpenses([{ id: 'dddddd', amount: 42 }]);
    expect(c).not.toHaveProperty('amountBase');
    expect(c.amount).toBe(42);
  });
  it('every total adds amountBase: a EUR receipt never mixes with CLP', () => {
    const list = normalizeExpenses([frozen('aaaaaa', 10, 1000), { id: 'bbbbbb', amount: 500, supplier: 'Conad', category: 'food', currency: 'CLP' }]);
    expect(expensesTotal(list)).toBe(10500);
    expect(supplierTotals(list)[0].total).toBe(10500);
    expect(expensesByCategory(list).find((c) => c.category === 'food' || c.id === 'food')).toBeTruthy();
    expect(liquidity([{ amount: 20000 }], list, [])).toBe(9500);
    expect(cashSummary(100000, [{ amount: 1 }]).paid).toBe(1);
    const p = { ...newProject({ regionCode: 'CL', name: 'Casa', now: 1 }), expenses: list.map((e) => ({ ...e, projectId: 'x' })) };
    expect(profitability(p, 0).spent).toBe(10500);
  });
  it('a stray amountBase on the raw list (not normalised) still wins in the sums', () => {
    expect(expensesTotal([{ amount: 1, amountBase: 5000 }, { amount: 100 }])).toBe(5100);
  });
  it('mergeProject keeps the snapshot of an expense that arrives from another device', () => {
    const base = newProject({ regionCode: 'CL', name: 'Casa', now: 1 });
    const remote = { ...base, updatedAt: 50, expenses: normalizeExpenses([frozen('aaaaaa', 10, 1000, { at: 5, updatedAt: 50 })]) };
    const m = mergeProject({ ...base, updatedAt: 10 }, remote);
    expect(m.expenses[0]).toMatchObject({ amountOriginal: 10, currencyOriginal: 'EUR', exchangeRate: 1000, amountBase: 10000, amount: 10000 });
  });
  it('the receipt dedup compares the ORIGINAL printed amount (the same ticket scanned twice is still a duplicate)', () => {
    const stored = normalizeExpenses([frozen('aaaaaa', 10, 1000, { docId: 'doc111', date: '2026-11-02', supplier: 'Conad' })]);
    expect([...expenseFingerprints(stored)]).toEqual(['1000|2026-11-02|conad']);
    const { fresh, skipped } = dropDuplicateReceipts(normalizeReceipts({ receipts: [{ isReceipt: true, vendorName: 'Conad', receiptDate: '2026-11-02', currency: 'EUR', totalText: '10,00', items: [{ description: 'A', amountText: '10,00', category: 'food' }] }] }).receipts, stored);
    expect(fresh).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

describe('the screens', () => {
  let host;
  let root;
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
  beforeEach(() => {
    seedKey(); // BYOK: the user's own key is saved on this device
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    clearGeminiKey();
    act(() => root.unmount());
    host.remove();
  });
  const eur = { isReceipt: true, vendorName: 'Conad', receiptDate: '2026-11-02', currency: 'EUR', purchaseType: 'food', totalText: '10,00', items: [{ description: 'PANE', amountText: '10,00', category: 'food' }] };
  const scan = async (resolveFx) => {
    const saved = [];
    const fetchImpl = vi.fn(async () => geminiReply({ receipts: [eur] }));
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(ReceiptSheet, { onSave: (list, extra) => saved.push({ list, extra }), onClose: () => {}, prepareImage: async () => ({ dataUrl: 'data:image/jpeg;base64,/9j/AAAA' }), fetchImpl, resolveFx })));
    });
    const input = q('receipt-file-input');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'r.jpg', { type: 'image/jpeg' })], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await flush(40);
    return saved;
  };

  it('a EUR receipt in a CLP project: the rate card is collapsed (only a quiet link), the summary is original -> base, and the expense is frozen', async () => {
    const saved = await scan(async () => ({ rate: 1000, source: 'api', at: NOW }));
    expect(q('receipt-fx-EUR')).toBeNull(); // no technical card by default
    expect(q('receipt-fx-edit-EUR').textContent).toBe('Modificar tipo de cambio');
    expect(q('receipt-fx-rate-EUR')).toBeNull();
    const total = q('receipt-total').textContent.replace(/\s/g, '');
    expect(total).toMatch(/€10,00→≈\$10\.000/); // Total: €10,00 -> ≈ $10.000
    expect(q('receipt-total-base').textContent.replace(/\D/g, '')).toBe('10000');
    await act(async () => q('receipt-save').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(saved).toHaveLength(1);
    expect(saved[0].list[0]).toMatchObject({ currency: 'CLP', currencyOriginal: 'EUR', amountOriginal: 10, exchangeRate: 1000, amountBase: 10000, amount: 10000, fxSource: 'api' });
  });
  it('"Modificar tipo de cambio" opens the card; the rate typed by hand is frozen with source "manual"', async () => {
    const saved = await scan(async () => ({ rate: 900, source: 'static', at: NOW }));
    await act(async () => q('receipt-fx-edit-EUR').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(q('receipt-fx-EUR')).not.toBeNull();
    expect(q('receipt-fx-link-EUR')).toBeNull();
    expect(q('receipt-fx-src-EUR').dataset.source).toBe('static');
    await act(async () => q('receipt-fx-rate-EUR').dispatchEvent(new MouseEvent('click', { bubbles: true }))); // opens the number pad
    await act(async () => q('pad-5').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush(20);
    expect(q('receipt-fx-src-EUR').dataset.source).toBe('manual');
    await act(async () => q('pad-back').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await act(async () => q('receipt-save').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const [e] = saved[0].list;
    expect(e.fxSource).toBe('manual');
    expect(e.amountBase).toBe(Math.round(10 * e.exchangeRate));
    expect(e.amount).toBe(e.amountBase);
  });
  it('no rate could be found: the card opens by itself so it can be typed (and saving waits for it)', async () => {
    await scan(async () => null);
    expect(q('receipt-fx-EUR')).not.toBeNull();
    expect(q('receipt-save').disabled).toBe(true);
    expect(q('receipt-total-base')).toBeNull();
  });
  it('a receipt in the project currency has no rate card at all', async () => {
    const saved = [];
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'IT' }, React.createElement(ReceiptSheet, { onSave: (l) => saved.push(l), onClose: () => {}, prepareImage: async () => ({ dataUrl: 'data:image/jpeg;base64,/9j/AAAA' }), fetchImpl: async () => new Response(JSON.stringify({ ok: true, receipts: normalizeReceipts({ receipts: [eur] }).receipts }), { status: 200, headers: { 'content-type': 'application/json' } }) })));
    });
    const input = q('receipt-file-input');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'r.jpg', { type: 'image/jpeg' })], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await flush(40);
    expect(q('receipt-fx-EUR')).toBeNull();
    expect(q('receipt-fx-edit-EUR')).toBeNull();
    expect(q('receipt-total-base')).toBeNull();
  });
  it('the receipt stack shows the base value and a dim tag with the original foreign amount', () => {
    const stored = normalizeExpenses([{ id: 'aaaaaa', amount: 1, amountOriginal: 10, currencyOriginal: 'EUR', exchangeRate: 1000, amountBase: 10000, supplier: 'Conad', category: 'food', currency: 'CLP', projectId: 'x' }]);
    const html = renderToStaticMarkup(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(ReceiptStack, { expenses: stored })));
    expect(html).toContain('data-testid="stack-fx"');
    expect(html).toMatch(/10[.,]00/);
    expect(html).toMatch(/×1[.,]000/);
    const none = renderToStaticMarkup(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(ReceiptStack, { expenses: normalizeExpenses([{ id: 'bbbbbb', amount: 500, supplier: 'Conad', category: 'food', projectId: 'x' }]) })));
    expect(none).not.toContain('stack-fx');
  });
  it('the labels exist in the six languages', () => {
    for (const lang of ['es', 'en', 'pt', 'fr', 'it', 'de']) {
      const t = makeI18n(lang, 'CL').t;
      for (const k of ['fx.rate', 'fx.src.api', 'fx.src.cache', 'fx.src.static', 'fx.src.manual', 'fx.src.loading', 'fx.edit']) expect(t(k)).not.toBe(k);
    }
  });
});
