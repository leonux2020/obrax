// @vitest-environment happy-dom
// Smart deduplication (amount + date + normalized shop), the editable "Sucursal / Indirizzo" field of the review sheet,
// and the branch in the Excel (joined to the shop name: the column layout does not change).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider, makeI18n } from '../src/lib/i18n.jsx';
import ReceiptSheet from '../src/components/ReceiptSheet.jsx';
import { dropDuplicateExpenses, dropDuplicateReceipts, expenseFingerprints, normalizeReceipts, normalizeShop, receiptFingerprint, batchExpenses } from '../src/lib/receipt.js';
import { normalizeExpenses } from '../src/lib/ledger.js';
import { getToasts, resetToasts } from '../src/lib/notify.js';
import { newProject } from '../src/lib/projects.js';
import { buildRenditionSheets } from '../src/lib/rendition.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const doc = (extra = {}) => ({ isReceipt: true, vendorName: 'Sodimac', receiptDate: '2026-10-02', currency: 'CLP', purchaseType: 'material', items: [{ description: 'Cemento', amountText: '20.000', category: 'material' }, { description: 'Clavos', amountText: '10.000', category: 'material' }], ...extra });
const ok = (body) => vi.fn(async () => new Response(JSON.stringify({ ok: true, ...body }), { status: 200, headers: { 'content-type': 'application/json' } }));
const stored = (receipt) => normalizeExpenses(batchExpenses(normalizeReceipts({ receipts: [receipt] }).receipts, { now: 1 })); // what the project holds after saving it

describe('fingerprint', () => {
  it('shop names are compared without case, accents, punctuation or spacing', () => {
    expect(normalizeShop('  Sodímac  S.A. ')).toBe('sodimacsa');
    expect(normalizeShop('SODIMAC S.A')).toBe('sodimacsa');
    expect(normalizeShop(null)).toBe('');
  });
  it('needs a positive total, a valid date and a shop; otherwise null (never discarded)', () => {
    expect(receiptFingerprint({ amount: 30000, date: '2026-10-02', supplier: 'Sodimac' })).toBe('3000000|2026-10-02|sodimac');
    expect(receiptFingerprint({ amount: 30000, date: '', supplier: 'Sodimac' })).toBeNull();
    expect(receiptFingerprint({ amount: 30000, date: '2026-10-02', supplier: '' })).toBeNull();
    expect(receiptFingerprint({ amount: 0, date: '2026-10-02', supplier: 'X' })).toBeNull();
  });
  it('the project fingerprints one DOCUMENT (the sum of its lines), a manual expense being a document of one line', () => {
    const fps = expenseFingerprints([...stored(doc()), { id: 'manual01', amount: 500, supplier: 'Obi', date: '2026-10-03' }, { id: 'manual02', amount: 700, supplier: 'Obi' }]);
    expect([...fps].sort()).toEqual(['3000000|2026-10-02|sodimac', '50000|2026-10-03|obi']);
  });
});

describe('dropDuplicateReceipts / dropDuplicateExpenses', () => {
  const existing = stored(doc());
  it('skips the same total + date + shop (however the shop is written) and keeps the rest', () => {
    const { receipts } = normalizeReceipts({ receipts: [doc({ vendorName: ' SODÍMAC. ' }), doc({ vendorName: 'Sodimac', receiptDate: '2026-10-03' }), doc({ vendorName: 'Copec' }), doc({ items: [{ description: 'Otra cosa', amountText: '30.001', category: 'material' }] })] });
    const r = dropDuplicateReceipts(receipts, existing);
    expect(r.skipped).toBe(1);
    expect(r.fresh.map((x) => x.supplier + x.date)).toEqual(['Sodimac2026-10-03', 'Copec2026-10-02', 'Sodimac2026-10-02']);
    expect(r.fresh).toHaveLength(3);
  });
  it('no date or no shop = it is never dropped', () => {
    const { receipts } = normalizeReceipts({ receipts: [doc({ receiptDate: null })] });
    expect(dropDuplicateReceipts(receipts, stored(doc({ receiptDate: null }))).skipped).toBe(0);
  });
  it('the queue path: lines of an already stored document are dropped as a group', () => {
    const lines = batchExpenses(normalizeReceipts({ receipts: [doc(), doc({ vendorName: 'Copec' })] }).receipts, { now: 2 });
    const r = dropDuplicateExpenses(lines, existing);
    expect(r.skipped).toBe(1);
    expect(r.fresh.every((e) => e.supplier === 'Copec')).toBe(true);
    expect(r.fresh).toHaveLength(2);
  });
});

describe('ReceiptSheet', () => {
  let host;
  let root;
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
  const click = async (el) => {
    await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
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
  const scan = async (receipts, props = {}) => {
    const saved = [];
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(ReceiptSheet, { onSave: (list, extra) => saved.push({ list, extra }), onClose: () => {}, prepareImage: async () => ({ dataUrl: 'data:image/jpeg;base64,/9j/AAAA' }), fetchImpl: ok({ receipts: normalizeReceipts({ receipts }).receipts }), ...props })));
    });
    const input = q('receipt-file-input');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'r.jpg', { type: 'image/jpeg' })], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await flush(30);
    return saved;
  };
  const type = async (el, value) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('a photo whose only receipt is already stored: quiet "Duplicado omitido" toast, back to the camera, no error', async () => {
    await scan([doc()], { existing: stored(doc()) });
    expect(q('receipt-sheet').getAttribute('data-phase')).toBe('pick');
    expect(q('receipt-error')).toBeNull();
    expect(getToasts().at(-1)).toMatchObject({ key: 'rcpt.dup.one', tone: 'info' });
    expect(makeI18n('es', 'CL').t('rcpt.dup.one')).toBe('Duplicado omitido');
  });

  it('a batch with a repeated receipt: the repeated one disappears from the review, the new ones stay', async () => {
    const saved = await scan([doc(), doc({ vendorName: 'Copec', items: [{ description: 'Diésel', amountText: '5.000', category: 'transport' }] })], { existing: stored(doc()) });
    expect(q('receipt-sheet').getAttribute('data-phase')).toBe('review');
    expect(q('receipt-review').textContent).toContain('Diésel');
    expect(q('receipt-review').textContent).not.toContain('Cemento');
    expect(getToasts().some((t) => t.key === 'rcpt.dup.one')).toBe(true);
    await click(q('receipt-save'));
    expect(saved[0].list.map((e) => e.supplier)).toEqual(['Copec']);
  });

  it('without duplicates nothing changes (no toast, everything reviewed)', async () => {
    await scan([doc()], { existing: [] });
    expect(q('receipt-sheet').getAttribute('data-phase')).toBe('review');
    expect(getToasts().some((t) => t.key.startsWith('rcpt.dup'))).toBe(false);
  });

  it('the review has a "Sucursal / Dirección" input with what the AI read: the user can correct it or empty it', async () => {
    const saved = await scan([doc({ sucursal: 'Via Roma 123' })]);
    const input = q('receipt-branch-0');
    expect(host.querySelector('label[for="branch-0"]').textContent).toBe('Sucursal / Dirección');
    expect(input.value).toBe('Via Roma 123');
    await type(input, 'Sucursal Centro');
    await click(q('receipt-save'));
    expect(saved[0].list.every((e) => e.sucursal === 'Sucursal Centro')).toBe(true);
  });

  it('emptying the field stores no sucursal; a receipt without address shows an empty field that can be filled', async () => {
    const a = await scan([doc({ sucursal: 'Via Roma 123' })]);
    await type(q('receipt-branch-0'), '');
    await click(q('receipt-save'));
    expect('sucursal' in a[0].list[0]).toBe(false);

    act(() => root.unmount());
    root = createRoot(host);
    const b = await scan([doc()]);
    expect(q('receipt-branch-0').value).toBe('');
    await type(q('receipt-branch-0'), 'Av. Pajaritos 1234');
    await click(q('receipt-save'));
    expect(b[0].list[0].sucursal).toBe('Av. Pajaritos 1234');
  });

  it('in a batch every receipt has its own field', async () => {
    const saved = await scan([doc({ sucursal: 'Via Roma 123' }), doc({ vendorName: 'Copec', sucursal: 'Ruta 5' })]);
    expect(q('receipt-branch-0').value).toBe('Via Roma 123');
    expect(q('receipt-branch-1').value).toBe('Ruta 5');
    await type(q('receipt-branch-1'), 'Ruta 68');
    await click(q('receipt-save'));
    expect(saved[0].list.map((e) => e.sucursal)).toEqual(['Via Roma 123', 'Via Roma 123', 'Ruta 68', 'Ruta 68']);
  });

  it('every language has the three texts', () => {
    for (const [lang, region] of [['es', 'CL'], ['en', 'US'], ['pt', 'BR'], ['fr', 'FR'], ['it', 'IT'], ['de', 'DE']]) {
      const { t } = makeI18n(lang, region);
      for (const k of ['rcpt.dup.one', 'rcpt.dup.many', 'rcpt.branch']) expect(t(k, { n: 2 })).not.toBe(k);
    }
    expect(makeI18n('it', 'IT').t('rcpt.branch')).toBe('Filiale / Indirizzo');
  });
});

describe('Excel: the branch travels with the shop name', () => {
  const t = makeI18n('es', 'CL').t;
  const build = (expenses) => {
    const p = newProject({ regionCode: 'CL', name: 'Casa', now: 1 });
    p.expenses = normalizeExpenses(expenses);
    const rows = buildRenditionSheets([p], new Map([[p.id, 0]]), { t, locale: 'es', currency: 'CLP' })[1].rows;
    return { rows, col: rows[0].findIndex((c) => (c?.v ?? c) === t('xl.supplier')) };
  };
  it('"Sodimac - Via Roma 123" in the shop column, same 16 columns; no branch = the plain shop; the description is untouched', () => {
    const { rows, col } = build([
      { id: 'gasto001', amount: 100, supplier: 'Sodimac', description: 'Cemento', sucursal: 'Via Roma 123' },
      { id: 'gasto002', amount: 100, supplier: 'Sodimac', description: 'Clavos' },
      { id: 'gasto003', amount: 100, supplier: '', description: 'Varios', sucursal: 'Sucursal Centro' },
    ]);
    expect(rows[0]).toHaveLength(16);
    const shop = (r) => rows.find((x) => x.some((c) => (c?.v ?? c) === r))[col];
    expect(shop('Cemento')).toBe('Sodimac - Via Roma 123');
    expect(shop('Clavos')).toBe('Sodimac');
    expect(shop('Varios')).toBe('Sucursal Centro');
    expect(rows.every((r) => r.length === 16)).toBe(true);
  });
});
