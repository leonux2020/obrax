// @vitest-environment happy-dom
// Batch processing: ONE photo can hold several receipts. Each is an independent record, and EVERY expense inherits the context
// (projectId, currency, place) of the project it is saved into: no expense is ever orphan.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ReceiptSheet from '../src/components/ReceiptSheet.jsx';
import { asReceipts, batchExpenses, normalizeReceipts, requestReceipt } from '../src/lib/receipt.js';
import { addExpenses } from '../src/lib/receiptSync.js';
import { newProject, normalizeProject } from '../src/lib/projects.js';
import { normalizeExpenses, withProjectContext } from '../src/lib/ledger.js';
import { getToasts, resetToasts } from '../src/lib/notify.js';
import { makeI18n } from '../src/lib/i18n.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const photo = {
  isReceipt: true,
  receipts: [
    { vendorName: 'Sodimac', receiptDate: '2026-10-29', currency: 'CLP', vendorTaxId: '96.792.430-K', documentType: 'invoice', documentNumber: '1001', paymentMethod: 'card', totalText: '11.900', netAmountText: '10.000', taxAmountText: '1.900', purchaseType: 'material', items: [{ description: 'Cemento', quantity: 2, amountText: '11.900', category: 'material' }] },
    { vendorName: 'Copec', receiptDate: '2026-10-29', currency: 'CLP', documentType: 'ticket', documentNumber: '77', paymentMethod: 'cash', purchaseType: 'transport', items: [{ description: 'Diésel', amountText: '30.000', category: 'transport' }] },
    { vendorName: 'Jumbo', receiptDate: '2026-10-28', currency: 'CLP', purchaseType: 'food', items: [{ description: 'Pan', amountText: '5.000', category: 'food' }, { description: 'Bebidas', amountText: '3.500', category: 'food' }] },
  ],
};
const ok = (body) => vi.fn(async () => new Response(JSON.stringify({ ok: true, ...body }), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('parser: normalizeReceipts / requestReceipt', () => {
  it('a photo with three receipts becomes three independent receipts, each with its own fiscal data and lines', () => {
    const { isReceipt, receipts } = normalizeReceipts(photo);
    expect(isReceipt).toBe(true);
    expect(receipts.map((r) => r.supplier)).toEqual(['Sodimac', 'Copec', 'Jumbo']); // `vendorName` -> supplier
    expect(receipts[0]).toMatchObject({ vendorTaxId: '96.792.430-K', documentType: 'invoice', documentNumber: '1001', paymentMethod: 'card', netAmount: 10000, taxAmount: 1900 });
    expect(receipts[1]).toMatchObject({ documentType: 'ticket', vendorTaxId: null, netAmount: null });
    expect(receipts[2].items.map((i) => i.amount)).toEqual([5000, 3500]);
    expect(receipts[2].documentNumber).toBeNull(); // nothing leaks between documents
  });

  it('is tolerant: the older single-receipt shape is one receipt, junk is none, empty documents are dropped, the number is bounded', () => {
    expect(normalizeReceipts({ isReceipt: true, supplier: 'Easy', items: [{ amountText: '10', category: 'other' }] }).receipts).toHaveLength(1);
    expect(normalizeReceipts(null).receipts).toEqual([]);
    expect(normalizeReceipts({ isReceipt: false, receipts: [] })).toEqual({ isReceipt: false, receipts: [] });
    expect(normalizeReceipts({ isReceipt: true, receipts: [{ vendorName: 'x', items: [] }, ...photo.receipts] }).receipts).toHaveLength(3);
    expect(normalizeReceipts({ isReceipt: true, receipts: Array.from({ length: 40 }, () => photo.receipts[1]) }).receipts).toHaveLength(10);
    expect(asReceipts({ receipts: [1, 2] })).toEqual([1, 2]);
    expect(asReceipts({ items: [] })).toHaveLength(1);
    expect(asReceipts(null)).toEqual([]);
  });

  it('requestReceipt returns the batch from the proxy and maps empty answers to the fixed error codes', async () => {
    const batch = await requestReceipt('data:image/jpeg;base64,/9j/AAAA', { fetchImpl: ok({ receipts: normalizeReceipts(photo).receipts }) });
    expect(batch.receipts).toHaveLength(3);
    await expect(requestReceipt('data:image/jpeg;base64,/9j/AAAA', { fetchImpl: ok({ receipts: [] }) })).rejects.toMatchObject({ code: 'unreadable' });
    await expect(requestReceipt('data:image/jpeg;base64,/9j/AAAA', { fetchImpl: ok({ isReceipt: false, receipts: [] }) })).rejects.toMatchObject({ code: 'not_invoice' });
  });
});

describe('every expense of a batch inherits the project context (never orphan)', () => {
  const project = () => newProject({ regionCode: 'CL', name: 'Casa Soto', cityOrRegion: 'Valparaíso' });

  it('batchExpenses: one group (docId) per receipt, with its own fiscal data and net / tax split', () => {
    const list = batchExpenses(normalizeReceipts(photo).receipts, { now: 5 });
    expect(list).toHaveLength(4); // 1 + 1 + 2 lines
    expect(new Set(list.map((e) => e.docId)).size).toBe(3);
    expect(list.map((e) => e.supplier)).toEqual(['Sodimac', 'Copec', 'Jumbo', 'Jumbo']);
    expect(list[0]).toMatchObject({ documentNumber: '1001', netAmount: 10000, taxAmount: 1900 });
    expect(list[1]).not.toHaveProperty('netAmount');
    expect(list[2].docId).toBe(list[3].docId);
  });

  it('withProjectContext stamps the project id (always the project\'s own), the currency and the place on EVERY line of the array', () => {
    const p = project();
    const list = batchExpenses(normalizeReceipts(photo).receipts, { now: 5 }).map((e, i) => (i === 0 ? { ...e, projectId: 'someoneelse' } : e));
    const stamped = withProjectContext(p, list);
    expect(stamped).toHaveLength(4);
    for (const e of stamped) expect(e).toMatchObject({ projectId: p.id, currency: 'CLP', place: 'Valparaíso' });
    expect(stamped.every((e) => e.projectId === p.id)).toBe(true); // a foreign id is overridden
    expect(withProjectContext(p, [{ amount: 1 }])[0].projectId).toBe(p.id);
    expect(withProjectContext(p, null)).toEqual([]);
    // a receipt printed in another currency keeps ITS currency
    expect(withProjectContext(p, [{ amount: 1, currency: 'USD' }])[0].currency).toBe('USD');
    // the stamped records survive the storage validation
    for (const e of normalizeExpenses(stamped)) expect(e).toMatchObject({ projectId: p.id, place: 'Valparaíso' });
  });

  it('addExpenses (the deferred queue / background sync) stamps every line too, and the project keeps them all', () => {
    const p = project();
    const next = addExpenses(p, batchExpenses(normalizeReceipts(photo).receipts, { now: 5 }));
    expect(next.expenses).toHaveLength(4);
    expect(next.expenses.every((e) => e.projectId === p.id)).toBe(true);
  });

  it('an expense saved without a project id (old records) gets it when the project is loaded', () => {
    const p = project();
    const old = JSON.parse(JSON.stringify({ ...p, expenses: [{ id: 'abcd1234', amount: 10, category: 'other', description: 'viejo' }] }));
    expect(normalizeProject(old).expenses[0].projectId).toBe(p.id);
  });
});

describe('ReceiptSheet: several receipts in one photo', () => {
  let host;
  let root;
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
  const click = async (el) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
  };
  beforeEach(() => {
    resetToasts();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const scan = async (body, props = {}) => {
    const saved = [];
    await act(async () => {
      root.render(
        React.createElement(
          I18nProvider,
          { lang: 'es', regionCode: 'CL' },
          React.createElement(ReceiptSheet, { onSave: (list, extra) => saved.push({ list, extra }), onClose: () => {}, prepareImage: async () => ({ dataUrl: 'data:image/jpeg;base64,/9j/AAAA' }), fetchImpl: ok(body), ...props })
        )
      );
    });
    const input = q('receipt-file-input');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'r.jpg', { type: 'image/jpeg' })], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(30);
    return saved;
  };

  it('shows every receipt as its own group, saves one independent group of expenses per receipt and says "Se registraron 3 comprobantes"', async () => {
    const saved = await scan({ receipts: normalizeReceipts(photo).receipts });
    expect(q('receipt-sheet').getAttribute('data-phase')).toBe('review');
    expect(q('receipt-batch').textContent).toContain('3');
    expect([0, 1, 2].map((d) => q(`receipt-doc-${d}`)?.textContent)).toEqual([expect.stringContaining('Comprobante 1 de 3'), expect.stringContaining('Comprobante 2 de 3'), expect.stringContaining('Comprobante 3 de 3')]);
    expect(q('receipt-doc-0').textContent).toContain('Sodimac');
    expect(q('receipt-doc-0').textContent).toContain('1001');
    expect(q('receipt-row-r3')).not.toBeNull(); // 4 lines, sequential keys across the photo
    await click(q('receipt-save'));
    expect(saved).toHaveLength(1);
    const { list, extra } = saved[0];
    expect(list).toHaveLength(4);
    expect(extra).toMatchObject({ receipts: 3, image: expect.anything() });
    expect(new Set(list.map((e) => e.docId)).size).toBe(3);
    expect(list.map((e) => e.documentNumber ?? null)).toEqual(['1001', '77', null, null]);
    expect(getToasts().at(-1)).toMatchObject({ key: 'rcpt.toast.many', params: { n: 3 }, tone: 'ok' });
    expect(makeI18n('es', 'CL').t('rcpt.toast.many', { n: 3 })).toBe('Se registraron 3 comprobantes');
  });

  it('a photo with ONE receipt says "Se guardó 1 comprobante"; unticking every line of a receipt leaves it out of the count', async () => {
    const one = await scan({ receipts: [normalizeReceipts(photo).receipts[0]] });
    expect(q('receipt-batch')).toBeNull(); // no batch header for a single document
    await click(q('receipt-save'));
    expect(one[0].extra.receipts).toBe(1);
    expect(getToasts().at(-1)).toMatchObject({ key: 'rcpt.toast.one' });
    expect(makeI18n('es', 'CL').t('rcpt.toast.one')).toBe('Se guardó 1 comprobante');

    act(() => root.unmount());
    root = createRoot(host);
    resetToasts();
    const some = await scan({ receipts: normalizeReceipts(photo).receipts });
    await click(host.querySelector('[data-testid="receipt-row-r1"] input[type="checkbox"]')); // Copec's only line
    await click(q('receipt-save'));
    expect(some[0].extra.receipts).toBe(2);
    expect(some[0].list).toHaveLength(3);
    expect(getToasts().at(-1)).toMatchObject({ key: 'rcpt.toast.many', params: { n: 2 } });
  });
});
