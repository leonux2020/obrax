// @vitest-environment happy-dom
// Expenses tab: the per-shop totals strip on top and the shop-first expense card.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ExpensesBlock from '../src/components/workspace/ExpensesBlock.jsx';
import { expenseDayLabel, supplierTotals } from '../src/lib/ledger.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const exp = (id, supplier, amount, extra = {}) => ({ id, supplier, description: '', amount, category: 'material', returnDate: '', returned: false, ...extra });

describe('supplierTotals', () => {
  it('sums by shop (ignoring case / spaces), biggest first, and the nameless ones go last in a single group', () => {
    const list = supplierTotals([exp('a1', 'Sodimac', 1000), exp('a2', 'Eurospin', 45), exp('a3', ' sodimac ', 200), exp('a4', '', 9999), exp('a5', '   ', 1), exp('a6', 'Easy', 5000)]);
    expect(list.map((g) => [g.name, g.total, g.count])).toEqual([['Easy', 5000, 1], ['Sodimac', 1200, 2], ['Eurospin', 45, 1], ['', 10000, 2]]);
  });

  it('never adds different currencies together, adds cents exactly and tolerates junk', () => {
    const list = supplierTotals([exp('a1', 'Obramat', 10, { currency: 'EUR' }), exp('a2', 'Obramat', 20), exp('a3', 'Obramat', 0.1), exp('a4', 'Obramat', 0.2)]);
    expect(list).toHaveLength(2);
    expect(list.find((g) => g.currency === '').total).toBe(20.3);
    expect(supplierTotals(null)).toEqual([]);
    expect(supplierTotals([null, {}, { supplier: 5, amount: 'x' }])[0]).toMatchObject({ name: '', total: 0 });
  });

  it('expenseDayLabel formats the printed day, and is empty for nothing / odd values', () => {
    expect(expenseDayLabel('2026-10-29', 'es-CL')).toMatch(/29/);
    expect(expenseDayLabel('2026-10-29', 'es-CL')).toMatch(/2026/);
    expect(expenseDayLabel('', 'es')).toBe('');
    expect(expenseDayLabel('2026-02-31', 'es')).toBe('');
    expect(expenseDayLabel(undefined)).toBe('');
  });
});

describe('ExpensesBlock: totals strip + shop-first cards', () => {
  let host;
  let root;
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const qa = (id) => [...host.querySelectorAll(`[data-testid="${id}"]`)];
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const mount = async (expenses, onChange = () => {}) => {
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(ExpensesBlock, { expenses, queued: [], receipts: {}, onChange, open: true, onToggle: () => {} })));
    });
  };
  const list = [
    exp('e1', 'Sodimac', 11900, { description: 'Cemento', date: '2026-10-29' }),
    exp('e2', 'Sodimac', 3000, { description: 'Clavos', category: 'tool_rental', returnDate: '2099-01-01' }),
    exp('e3', '', 4000, { description: 'Peaje', category: 'transport' }),
    exp('e4', '', 500),
  ];

  it('shows a horizontally scrollable strip of chips above the list: biggest shop first, "Sin proveedor" last', async () => {
    await mount(list);
    const strip = q('supplier-totals');
    expect(strip.className).toContain('overflow-x-auto');
    expect(strip.compareDocumentPosition(q('expense-list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // right above the list
    const chips = qa('supplier-total-name').map((n) => n.textContent);
    expect(chips).toEqual(['Sodimac', 'Sin proveedor']);
    const amounts = qa('supplier-total-amount').map((n) => n.textContent);
    expect(amounts[0]).toContain('14.900');
    expect(amounts[1]).toContain('4.500');
  });

  it('the card headline is the shop (else the description, else "Gasto"), with date + category as subtitles and the amount on the right', async () => {
    await mount(list);
    const card = (id) => q(`expense-${id}`);
    expect(card('e1').querySelector('[data-testid="expense-title"]').textContent).toBe('Sodimac');
    expect(card('e1').querySelector('[data-testid="expense-sub"]').textContent).toMatch(/29.*2026 · Material/);
    expect(card('e1').querySelector('[data-testid="expense-detail"]').textContent).toBe('Cemento');
    expect(card('e1').textContent).toContain('11.900');
    expect(card('e3').querySelector('[data-testid="expense-title"]').textContent).toBe('Peaje'); // no shop: the description
    expect(card('e3').querySelector('[data-testid="expense-detail"]')).toBeNull();
    expect(card('e4').querySelector('[data-testid="expense-title"]').textContent).toBe('Gasto'); // nothing at all
  });

  it('editing and deleting keep working: × removes exactly that expense and the rental switch still toggles', async () => {
    const onChange = vi.fn();
    await mount(list, onChange);
    await act(async () => {
      q('expense-e1').querySelector('button[aria-label]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].map((e) => e.id)).toEqual(['e2', 'e3', 'e4']);
    expect(q('expense-e1').querySelector('button[aria-label]').getAttribute('aria-label')).toContain('Sodimac');
    await act(async () => {
      q('expense-return-e2').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange.mock.calls[1][0].find((e) => e.id === 'e2').returned).toBe(true);
    await mount([]);
    expect(q('supplier-totals')).toBeNull(); // nothing to summarise
  });
});
