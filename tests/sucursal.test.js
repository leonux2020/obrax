// @vitest-environment happy-dom
// Logistic traceability: the vision AI reads the shop's branch / street address ("sucursal"), it is stored with each expense (IndexedDB)
// and the project's receipt stack (Gastos) shows it as grey micro-text next to the date, the product description under it.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { buildReceiptPrompt, RECEIPT_DOC_SCHEMA, RECEIPT_SCHEMA } from '../server/geminiProxy.js';
import { normalizeReceipt, normalizeReceipts, receiptMeta, expensesFromRows, batchExpenses } from '../src/lib/receipt.js';
import { normalizeExpenses } from '../src/lib/ledger.js';
import { projectStore } from '../src/lib/projectStore.js';
import { newProject } from '../src/lib/projects.js';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ExpensesBlock from '../src/components/workspace/ExpensesBlock.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const RAW = (extra = {}) => ({
  isReceipt: true,
  vendorName: 'Sodimac',
  receiptDate: '2026-10-02',
  currency: 'CLP',
  purchaseType: 'material',
  totalText: '30.000',
  items: [{ description: 'Cemento 25 kg', amountText: '30.000', category: 'material' }],
  ...extra,
});

describe('AI schema + prompt', () => {
  it('the receipt schema has a nullable string "sucursal" per document (not required: older answers still validate)', () => {
    const f = RECEIPT_DOC_SCHEMA.properties.sucursal;
    expect(f).toMatchObject({ type: 'STRING', nullable: true });
    expect(RECEIPT_SCHEMA.properties.receipts.items).toBe(RECEIPT_DOC_SCHEMA);
    expect(RECEIPT_DOC_SCHEMA.required ?? []).not.toContain('sucursal');
  });

  it('the vision prompt tells the model to find the physical address / branch id, with examples, and to return null otherwise', () => {
    const p = buildReceiptPrompt({ currency: 'CLP', today: '2026-11-02' });
    expect(p).toContain('"sucursal"');
    expect(p).toContain('physical address of the shop');
    expect(p).toContain('branch');
    expect(p).toContain('Via Roma 123');
    expect(p).toContain('Sucursal Centro');
    expect(p).toMatch(/If no address is visible, return null/);
    expect(p).toMatch(/NEVER invent/);
  });
});

describe('normalize + save', () => {
  it('normalizeReceipt keeps a clean sucursal (or `branch`), null when absent / blank / not a string; control chars and length are cleaned', () => {
    expect(normalizeReceipt(RAW({ sucursal: '  Via Roma 123 ' })).sucursal).toBe('Via Roma 123');
    expect(normalizeReceipt(RAW({ branch: 'Sucursal Centro' })).sucursal).toBe('Sucursal Centro');
    expect(normalizeReceipt(RAW({ sucursal: null })).sucursal).toBeNull();
    expect(normalizeReceipt(RAW({ sucursal: '   ' })).sucursal).toBeNull();
    expect(normalizeReceipt(RAW({ sucursal: 42 })).sucursal).toBeNull();
    expect(normalizeReceipt(RAW()).sucursal).toBeNull();
    expect(normalizeReceipt(RAW({ sucursal: 'Av.\u0000 Pajaritos\n  1234' })).sucursal).toBe('Av. Pajaritos 1234');
    expect(normalizeReceipt(RAW({ sucursal: 'x'.repeat(300) })).sucursal).toHaveLength(80);
  });

  it('every document of a batch carries ITS OWN sucursal into its expense lines', () => {
    const batch = normalizeReceipts({ isReceipt: true, receipts: [RAW({ sucursal: 'Via Roma 123' }), RAW({ vendorName: 'Copec', sucursal: null })] });
    expect(receiptMeta(batch.receipts[0]).sucursal).toBe('Via Roma 123');
    const lines = batchExpenses(batch.receipts, { now: 5 });
    expect(lines[0]).toMatchObject({ supplier: 'Sodimac', sucursal: 'Via Roma 123' });
    expect('sucursal' in lines[1]).toBe(false); // nothing invented when the paper showed none
  });

  it('expensesFromRows only adds the field when there is one', () => {
    const rows = [{ selected: true, amount: 10, category: 'material', description: 'Clavos' }];
    expect(expensesFromRows(rows, { supplier: 'S', sucursal: 'Sucursal Centro' })[0].sucursal).toBe('Sucursal Centro');
    expect('sucursal' in expensesFromRows(rows, { supplier: 'S', sucursal: null })[0]).toBe(false);
  });

  it('normalizeExpenses (what storage and the Drive restore run) keeps it; old records without it are untouched', () => {
    const [a, b, c] = normalizeExpenses([
      { id: 'gasto001', amount: 5, sucursal: ' Via Roma 123 ' },
      { id: 'gasto002', amount: 6 },
      { id: 'gasto003', amount: 7, sucursal: '<b>Sucursal</b> Norte' },
    ]);
    expect(a.sucursal).toBe('Via Roma 123');
    expect('sucursal' in b).toBe(false);
    expect(c.sucursal).not.toContain('<');
  });

  it('it is persisted in IndexedDB with the expense (save -> load)', async () => {
    const p = newProject({ regionCode: 'IT', name: 'Casa', now: 1 });
    p.expenses = normalizeExpenses([{ id: 'gasto001', amount: 5, supplier: 'Obi', description: 'Viti', sucursal: 'Via Roma 123' }]);
    await projectStore.save(p);
    const back = (await projectStore.load()).find((x) => x.id === p.id);
    expect(back.expenses[0]).toMatchObject({ supplier: 'Obi', description: 'Viti', sucursal: 'Via Roma 123' });
    await projectStore.remove(p.id);
  });
});

describe('Receipt stack micro-text (project > Gastos)', () => {
  let host;
  let root;
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const show = async (expenses) => {
    await act(async () => {
      root.render(
        React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(ExpensesBlock, { expenses: normalizeExpenses(expenses), queued: [], receipts: {}, onChange: () => {}, open: true, onToggle: () => {} })),
      );
    });
  };

  it('the date and the sucursal share the first micro-line; the product description goes under it; no sucursal / description = only the date', async () => {
    await show([
      { id: 'gasto001', amount: 30000, supplier: 'Sodimac', description: 'Cemento 25 kg', sucursal: 'Via Roma 123', date: '2026-10-02' },
      { id: 'gasto002', amount: 20000, supplier: 'Sodimac', description: 'Clavos 2"', date: '2026-10-05' },
      { id: 'gasto003', amount: 9000, supplier: 'Sodimac', description: '', date: '2026-10-07' },
    ]);
    const line = (id) => q(`expense-${id}`).querySelector('[data-testid="stack-line"]');
    const desc = (id) => q(`expense-${id}`).querySelector('[data-testid="stack-desc"]');
    expect(line('gasto001').textContent).toMatch(/2026 · Via Roma 123$/);
    expect(desc('gasto001').textContent).toBe('Cemento 25 kg');
    expect(line('gasto002').textContent).toMatch(/2026$/); // no branch: only the date
    expect(desc('gasto002').textContent).toBe('Clavos 2"');
    expect(desc('gasto003')).toBeNull(); // date only
    expect(q('expense-gasto003').textContent).not.toContain('•');
    for (const id of ['gasto001', 'gasto002', 'gasto003']) for (const c of ['text-xs', 'text-neutral-400', 'truncate']) expect(line(id).className).toContain(c);
  });

  it('a receipt with only a sucursal (no description) still shows it', async () => {
    await show([{ id: 'gasto001', amount: 100, supplier: 'Obi', sucursal: 'Sucursal Centro', date: '2026-10-02' }]);
    expect(q('expense-gasto001').querySelector('[data-testid="stack-line"]').textContent).toContain('Sucursal Centro');
    expect(q('expense-gasto001').querySelector('[data-testid="stack-desc"]')).toBeNull();
  });
});
