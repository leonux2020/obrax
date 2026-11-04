// @vitest-environment happy-dom
// Expenses sheet of the project: the "receipt stack" (receipts grouped by supplier).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ExpensesBlock from '../src/components/workspace/ExpensesBlock.jsx';
import { expenseDayLabel, groupExpensesBySupplier, supplierTotals } from '../src/lib/ledger.js';

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

describe('groupExpensesBySupplier', () => {
  it('every expense lands in exactly one group, newest receipt first inside it, same order as supplierTotals', () => {
    const list = [
      exp('a', 'Sodimac', 100, { date: '2026-10-01' }),
      exp('b', ' sodimac', 50, { date: '2026-10-09' }),
      exp('c', '', 10, { at: 5 }),
      exp('d', 'Easy', 500, { currency: 'eur' }),
      exp('e', 'Easy', 1),
    ];
    const groups = groupExpensesBySupplier(list);
    expect(groups.map((g) => g.key)).toEqual(supplierTotals(list).map((g) => g.key));
    expect(groups.flatMap((g) => g.items.map((e) => e.id)).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(groups.find((g) => g.name === 'Sodimac').items.map((e) => e.id)).toEqual(['b', 'a']);
    expect(groupExpensesBySupplier(null)).toEqual([]);
  });
});

describe('ExpensesBlock: receipt stack grouped by supplier', () => {
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

  it('groups the receipts by supplier: biggest first, "Sin proveedor" last, each with its name big and what was spent there', async () => {
    await mount(list);
    expect(q('supplier-totals')).toBeNull(); // the old chips strip is gone: the stack replaces it
    expect(qa('stack-shop-name').map((n) => n.textContent)).toEqual(['Sodimac', 'Sin proveedor']);
    const totals = qa('stack-shop-total').map((n) => n.textContent);
    expect(totals[0]).toContain('14.900');
    expect(totals[1]).toContain('4.500');
    for (const c of ['text-lg', 'text-neutral-200', 'truncate']) expect(qa('stack-shop-name')[0].className).toContain(c);
    expect(qa('stack-shop-total')[0].className).toContain('text-neutral-200');
    // the supplier appears ONCE: its receipts are stacked underneath, never repeating the name
    expect(q('expense-list').textContent.match(/Sodimac/g)).toHaveLength(1);
    expect([...q('stack-shop-0').querySelectorAll('li')].map((li) => li.dataset.testid)).toEqual(['expense-e1', 'expense-e2']); // newest receipt first
    expect([...q('stack-shop-1').querySelectorAll('li')]).toHaveLength(2);
  });

  it('every receipt is grey micro-text under its supplier: date (+ sucursal) and the description, with its amount on the right', async () => {
    await mount(list);
    const card = (id) => q(`expense-${id}`);
    const line = card('e1').querySelector('[data-testid="stack-line"]');
    expect(line.textContent).toMatch(/29.*2026/);
    for (const c of ['text-xs', 'text-neutral-400']) expect(line.className).toContain(c);
    const desc = card('e1').querySelector('[data-testid="stack-desc"]');
    expect(desc.textContent).toBe('Cemento');
    for (const c of ['text-xs', 'text-neutral-500']) expect(desc.className).toContain(c);
    expect(card('e1').querySelector('[data-testid="stack-amount"]').textContent).toContain('11.900');
    expect(card('e3').querySelector('[data-testid="stack-desc"]').textContent).toBe('Peaje'); // no shop: the description is still there
    expect(card('e4').querySelector('[data-testid="stack-desc"]')).toBeNull(); // nothing at all: just a date and the amount
    expect(card('e4').querySelector('[data-testid="stack-amount"]').textContent).toContain('500');
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
