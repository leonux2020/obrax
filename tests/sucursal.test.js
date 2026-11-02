// @vitest-environment happy-dom
// Logistic traceability: the vision AI reads the shop's branch / street address ("sucursal"), it is stored with each expense (IndexedDB)
// and Contabilidad shows it as grey micro-text, falling back to the product description.
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
import ProjectFinancialDashboard from '../src/components/ProjectFinancialDashboard.jsx';
import { createExportQueue } from '../src/lib/exportQueue.js';

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

describe('Contabilidad micro-text priority', () => {
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
    const p = newProject({ regionCode: 'CL', name: 'Casa', now: 1 });
    p.expenses = normalizeExpenses(expenses);
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(ProjectFinancialDashboard, { project: p, onCloseRendition: async () => {}, queue: createExportQueue() })));
    });
  };

  it('sucursal first; when empty, the product description; when both are empty, only the date', async () => {
    await show([
      { id: 'gasto001', amount: 30000, supplier: 'Sodimac', description: 'Cemento 25 kg', sucursal: 'Via Roma 123', date: '2026-10-02' },
      { id: 'gasto002', amount: 20000, supplier: 'Sodimac', description: 'Clavos 2"', date: '2026-10-05' },
      { id: 'gasto003', amount: 9000, supplier: 'Sodimac', description: '', date: '2026-10-07' },
    ]);
    const note = (id) => q(`fin-expense-${id}`).querySelector('[data-testid="fin-expense-note"]');
    expect(note('gasto001').textContent).toBe('Via Roma 123'); // NOT "Cemento 25 kg"
    expect(note('gasto001').dataset.source).toBe('sucursal');
    expect(q('fin-expense-gasto001').textContent).not.toContain('Cemento');
    expect(note('gasto002').textContent).toBe('Clavos 2"'); // fallback
    expect(note('gasto002').dataset.source).toBe('description');
    expect(note('gasto003')).toBeNull(); // date only
    expect(q('fin-expense-gasto003').textContent).not.toContain('•');
    // same micro-typography for both sources
    for (const id of ['gasto001', 'gasto002']) for (const c of ['text-xs', 'text-neutral-500', 'truncate', 'max-w-[150px]']) expect(note(id).className).toContain(c);
    expect(note('gasto001').getAttribute('title')).toBe('Via Roma 123');
  });

  it('a ticket with only a sucursal (no description) still shows it', async () => {
    await show([{ id: 'gasto001', amount: 100, supplier: 'Obi', sucursal: 'Sucursal Centro', date: '2026-10-02' }]);
    expect(q('fin-expense-gasto001').querySelector('[data-testid="fin-expense-note"]').textContent).toBe('Sucursal Centro');
  });
});
