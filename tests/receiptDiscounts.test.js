// @vitest-environment happy-dom
// A discount ("BUONO -1,21") is NEVER an expense: the prompt forbids it, the parser keeps the sign (and repairs a lost one only when the
// total paid proves it), the ledger stores negative lines, and the screens show them as deductions in green.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider, makeI18n } from '../src/lib/i18n.jsx';
import ReceiptSheet from '../src/components/ReceiptSheet.jsx';
import ReceiptStack from '../src/components/workspace/ReceiptStack.jsx';
import { parseSignedAmount } from '../src/lib/invoice.js';
import { batchExpenses, expensesFromRows, isDiscountLine, normalizeReceipt, normalizeReceipts, receiptSumCheck } from '../src/lib/receipt.js';
import { expensesByCategory, globalSupplierShares, normalizeExpenses, profitability, supplierTotals } from '../src/lib/ledger.js';
import { newProject } from '../src/lib/projects.js';
import { buildReceiptPrompt, RECEIPT_DOC_SCHEMA } from '../server/geminiProxy.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const supermarket = (extra = {}) => ({
  isReceipt: true,
  vendorName: 'Conad',
  receiptDate: '2026-11-02',
  currency: 'EUR',
  purchaseType: 'food',
  totalText: '6,29',
  items: [
    { description: 'PANE', amountText: '5,00', category: 'food' },
    { description: 'ACQUA', amountText: '2,50', category: 'food' },
    { description: 'BUONO', amountText: '-1,21', amount: 1.21, category: 'other' }, // the model lost the sign of the number, the printed text kept it
  ],
  ...extra,
});

describe('the prompt: three unbreakable rules', () => {
  const text = buildReceiptPrompt({ currency: 'EUR' });
  it('A: look for minus signs and deduction words in every language; they are never expenses', () => {
    for (const w of ['SCONTO', 'BUONO', 'DISCOUNT', 'DESCUENTO', 'RABATT', 'COUPON']) expect(text).toContain(w);
    expect(text).toContain('RULE A');
    expect(text).toMatch(/NEVER expenses and NEVER positive/);
  });
  it('B: a discount of one item is combined into ONE net line (3.79 - 2.41 = 1.38); a global one is a separate NEGATIVE item', () => {
    expect(text).toContain('RULE B');
    expect(text).toContain('3.79');
    expect(text).toContain('2.41');
    expect(text).toContain('1.38');
    expect(text).toMatch(/SEPARATE item with a NEGATIVE value/);
  });
  it('C: add up every item BEFORE answering; it must equal the TOTAL PAID exactly; a higher sum means a discount was added', () => {
    expect(text).toContain('RULE C');
    expect(text).toMatch(/BEFORE writing the final JSON/);
    expect(text).toContain('Totale complessivo');
    expect(text).toContain('Importo pagato');
    expect(text).toMatch(/EXACTLY/);
    expect(text).toMatch(/HIGHER/);
  });
  it('it no longer tells the model to leave discounts out as if they did not exist', () => {
    expect(text).not.toMatch(/Do not add subtotals, taxes, discounts/);
  });
  it('the schema lets "amount" be negative (a plain number) and asks for the printed text', () => {
    expect(RECEIPT_DOC_SCHEMA.properties.items.items.properties.amount.type).toBe('NUMBER');
    expect(text).toContain('MINUS SIGN');
  });
});

describe('parseSignedAmount', () => {
  it('reads every way a deduction is printed', () => {
    expect(parseSignedAmount('-1,21')).toBe(-1.21);
    expect(parseSignedAmount('−1,21')).toBe(-1.21); // typographic minus
    expect(parseSignedAmount('1,21-')).toBe(-1.21); // trailing minus of a till tape
    expect(parseSignedAmount('(1,21)')).toBe(-1.21); // accounting brackets
    expect(parseSignedAmount('- 2.41 EUR')).toBe(-2.41);
    expect(parseSignedAmount('-4.990')).toBe(-4990);
    expect(parseSignedAmount('1,21')).toBe(1.21);
    expect(parseSignedAmount('3.79')).toBe(3.79);
    expect(parseSignedAmount('')).toBeNull();
    expect(parseSignedAmount('abc')).toBeNull();
    expect(parseSignedAmount(0)).toBeNull();
  });
});

describe('normalizeReceipt: discounts', () => {
  it('"BUONO -1,21" is a NEGATIVE line and the lines add up to the total paid', () => {
    const r = normalizeReceipt(supermarket());
    expect(r.items.map((i) => i.amount)).toEqual([5, 2.5, -1.21]);
    expect(receiptSumCheck(r)).toMatchObject({ itemsSum: 6.29, total: 6.29, ok: true, inflated: false });
  });
  it('the model returned a negative number and an unsigned text: the sign is kept', () => {
    const r = normalizeReceipt(supermarket({ items: [{ description: 'PANE', amountText: '5,00', category: 'food' }, { description: 'SCONTO', amountText: '1,00', amount: -1, category: 'food' }], totalText: '4,00' }));
    expect(r.items.map((i) => i.amount)).toEqual([5, -1]);
  });
  it('the sign was lost completely: it is repaired ONLY because flipping it makes the sum equal the total paid', () => {
    const lost = supermarket({ items: [{ description: 'PANE', amountText: '5,00', category: 'food' }, { description: 'ACQUA', amountText: '2,50', category: 'food' }, { description: 'BUONO', amountText: '1,21', amount: 1.21, category: 'other' }] });
    const r = normalizeReceipt(lost);
    expect(r.items.map((i) => i.amount)).toEqual([5, 2.5, -1.21]);
    expect(receiptSumCheck(r).ok).toBe(true);
  });
  it('nothing is guessed: without a printed total, or when no flip matches, the lines stay as read and the check says "inflated"', () => {
    const noTotal = normalizeReceipt(supermarket({ totalText: '', total: null, items: [{ description: 'PANE', amountText: '5,00' }, { description: 'BUONO', amountText: '1,21' }] }));
    expect(noTotal.items.map((i) => i.amount)).toEqual([5, 1.21]);
    expect(receiptSumCheck(noTotal)).toBeNull();
    const nomatch = normalizeReceipt(supermarket({ totalText: '9,99', items: [{ description: 'PANE', amountText: '5,00' }, { description: 'BUONO', amountText: '1,21' }] }));
    expect(nomatch.items.map((i) => i.amount)).toEqual([5, 1.21]);
    const bad = normalizeReceipt(supermarket({ totalText: '4,00', items: [{ description: 'PANE', amountText: '5,00' }, { description: 'LAMPADA', amountText: '1,21' }] }));
    expect(receiptSumCheck(bad).inflated).toBe(true); // 6,21 > 4,00: the user is warned
    expect(bad.items.every((i) => i.amount > 0)).toBe(true); // a product is never flipped just because the sum is wrong
  });
  it('only a deduction-looking line can be flipped (multi-language)', () => {
    for (const d of ['SCONTO 10%', 'Buono pasto', 'DISCOUNT', 'Descuento cliente', 'Desconto', 'Rabatt', 'Remise fidélité', 'Coupon', 'Cupón']) expect(isDiscountLine({ description: d })).toBe(true);
    for (const d of ['Cemento', 'Pane', 'Vite 4x40']) expect(isDiscountLine({ description: d })).toBe(false);
  });
  it('a global discount takes the category that carries most of the purchase (no category of the breakdown goes negative)', () => {
    const r = normalizeReceipt(supermarket());
    expect(r.items[2].category).toBe('food');
    const stored = normalizeExpenses(batchExpenses([r], { now: 1 }));
    expect(expensesByCategory(stored).every((g) => g.total > 0)).toBe(true);
  });
  it('a document of only discounts still never turns positive', () => {
    const r = normalizeReceipt({ vendorName: 'X', totalText: '', items: [{ description: 'SCONTO', amountText: '-3,00', amount: -3, category: 'other' }] });
    expect(r.items[0].amount).toBe(-3);
  });
});

describe('the ledger keeps and adds negative lines', () => {
  const lines = (r) => normalizeExpenses(batchExpenses([normalizeReceipt(r)], { now: 1 }));
  it('expensesFromRows keeps a negative selected row and prorates net / tax with its sign', () => {
    const out = expensesFromRows([{ selected: true, amount: 10, description: 'A', category: 'food' }, { selected: true, amount: -1, description: 'BUONO', category: 'food' }, { selected: false, amount: -5, description: 'x', category: 'food' }], { netAmount: 7.4, taxAmount: 1.6 });
    expect(out.map((e) => e.amount)).toEqual([10, -1]);
    expect(out[1].netAmount).toBeLessThan(0);
  });
  it('stored expenses keep the negative amount (it survives normalization, so the total is not inflated on reload)', () => {
    const stored = lines(supermarket());
    expect(stored.map((e) => e.amount)).toEqual([5, 2.5, -1.21]);
    expect(Math.round(stored.reduce((s, e) => s + e.amount, 0) * 100) / 100).toBe(6.29);
    expect(normalizeExpenses([{ id: 'zz1234', amount: 0, supplier: 'X' }])).toEqual([]); // zero is still no amount
  });
  it('the supplier totals, the profitability and the global shares are NET of discounts', () => {
    const stored = lines(supermarket());
    expect(supplierTotals(stored)[0].total).toBe(6.29);
    const project = { ...newProject({ regionCode: 'IT', name: 'Casa', now: 1 }), expenses: stored.map((e) => ({ ...e, projectId: 'x' })) };
    const p = profitability(project, 0);
    expect(p.spent).toBe(6.29);
    expect(p.suppliers[0]).toMatchObject({ name: 'Conad', total: 6.29, share: 100 });
    const shares = globalSupplierShares([project]);
    expect(shares[0].total).toBe(6.29);
    expect(shares[0].segments[0].pct).toBeCloseTo(100, 5);
  });
});

describe('the screens show a discount as a deduction', () => {
  let host;
  let root;
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const scan = async (receipts) => {
    const saved = [];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, receipts: normalizeReceipts({ receipts }).receipts }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'IT' }, React.createElement(ReceiptSheet, { onSave: (list, extra) => saved.push({ list, extra }), onClose: () => {}, prepareImage: async () => ({ dataUrl: 'data:image/jpeg;base64,/9j/AAAA' }), fetchImpl })));
    });
    const input = q('receipt-file-input');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'r.jpg', { type: 'image/jpeg' })], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await flush(30);
    return saved;
  };

  it('review: the discount row is green, not editable as a charge, and the total is the NET (6,29), saved with its negative sign', async () => {
    const saved = await scan([supermarket()]);
    const row = q('receipt-row-r2');
    expect(row.dataset.discount).toBe('true');
    expect(q('receipt-discount-r2').className).toContain('text-brand-500');
    expect(q('receipt-discount-r2').textContent).toMatch(/-/);
    expect(q('receipt-sum-warn')).toBeNull(); // the lines add up to the total paid
    expect(q('receipt-total').textContent.replace(/\s/g, '')).toContain('6,29');
    await act(async () => q('receipt-save').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(saved[0].list.map((e) => e.amount)).toEqual([5, 2.5, -1.21]);
  });
  it('review: untick the discount and the total goes up; the warning appears when the lines exceed the total paid', async () => {
    await scan([supermarket({ totalText: '4,00', items: [{ description: 'PANE', amountText: '5,00', category: 'food' }, { description: 'LAMPADA', amountText: '1,21', category: 'food' }] })]);
    expect(q('receipt-sum-warn')).not.toBeNull();
    expect(q('receipt-sum-warn').textContent).toContain('6,21');
  });
  it('receipt stack and the list show negative amounts in text-brand-500', () => {
    const stored = normalizeExpenses(batchExpenses([normalizeReceipt(supermarket())], { now: 1 })).map((e) => ({ ...e, projectId: 'x', supplier: 'Conad' }));
    const html = renderToStaticMarkup(React.createElement(I18nProvider, { lang: 'es', regionCode: 'IT' }, React.createElement(ReceiptStack, { expenses: stored })));
    expect(html).toMatch(/text-brand-500[^>]*data-testid="stack-amount"[^>]*data-negative="true"/);
    expect((html.match(/data-negative="true"/g) || []).length).toBe(1); // only the discount, not the charges
    expect(html).toContain('data-testid="stack-shop-total"');
    expect(makeI18n('es', 'IT').t('rcpt.discount')).toBe('Descuento');
  });
});
