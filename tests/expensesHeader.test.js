// @vitest-environment happy-dom
// "Spese e scontrini": no x in the header; the project's TOTAL (sum of the frozen base amounts) sits in the top-right corner and follows the list live.
// The sheet closes the native way: Escape / backdrop / swipe down / device Back.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ExpensesBlock from '../src/components/workspace/ExpensesBlock.jsx';
import { normalizeExpenses } from '../src/lib/ledger.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const plain = (id, amount) => ({ id, amount, supplier: 'Sodimac', category: 'material', currency: 'CLP', projectId: 'x' });
const foreign = (id) => ({ id, amount: 1, amountOriginal: 10, currencyOriginal: 'EUR', exchangeRate: 1000, amountBase: 10000, supplier: 'Conad', category: 'other', currency: 'CLP', projectId: 'x' });

describe('ExpensesBlock header', () => {
  let host;
  let root;
  const q = (id) => document.querySelector(`[data-testid="${id}"]`);
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const render = async (expenses, { open = true, onToggle = () => {}, lang = 'es' } = {}) =>
    act(async () => {
      root.render(h(I18nProvider, { lang, regionCode: 'CL' }, h(ExpensesBlock, { expenses, queued: [], receipts: null, onChange: () => {}, open, onToggle })));
    });

  it('has no close button; the corner holds the total of the project in its base currency (original EUR never mixed in)', async () => {
    await render(normalizeExpenses([plain('aaaaaa', 500), foreign('bbbbbb')]));
    const sheet = document.querySelector('[role="dialog"]');
    expect(sheet.querySelector('[data-sheet-close]')).toBeNull();
    expect(sheet.querySelector('h2').parentElement.textContent).not.toContain('×'); // (the rows keep their own delete buttons)
    expect(q('expenses-total').dataset.total).toBe('10500');
    expect(q('expenses-total-amount').textContent.replace(/\D/g, '')).toBe('10500');
    // the title is on the left and the total on the right of the same header row
    const row = sheet.querySelector('h2').parentElement;
    expect(row.className).toContain('justify-between');
    expect(row.lastElementChild.contains(q('expenses-total'))).toBe(true);
    expect(sheet.hasAttribute('data-swipe-close')).toBe(true);
  });
  it('the total is reactive: a new receipt, a deleted line (and the empty list) update it', async () => {
    const one = normalizeExpenses([plain('aaaaaa', 500)]);
    await render(one);
    expect(q('expenses-total').dataset.total).toBe('500');
    await render([...normalizeExpenses([foreign('bbbbbb')]), ...one]);
    expect(q('expenses-total').dataset.total).toBe('10500');
    await render([]);
    expect(q('expenses-total').dataset.total).toBe('0');
  });
  it('a discount line lowers the total', async () => {
    await render(normalizeExpenses([plain('aaaaaa', 500), plain('bbbbbb', -120)]));
    expect(q('expenses-total').dataset.total).toBe('380');
  });
  it('it still closes natively: Escape and the backdrop call onToggle(id, false)', async () => {
    const onToggle = vi.fn();
    await render(normalizeExpenses([plain('aaaaaa', 500)]), { onToggle });
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onToggle).toHaveBeenCalledWith('expenses', false);
    onToggle.mockClear();
    await act(async () => q('sheet-backdrop').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onToggle).toHaveBeenCalledWith('expenses', false);
  });
  it('the label of the total is translated (it: Totale)', async () => {
    await render(normalizeExpenses([plain('aaaaaa', 500)]), { lang: 'it' });
    expect(q('expenses-total').textContent).toContain('Totale');
  });
});
