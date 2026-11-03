import { useI18n } from '../../lib/i18n.jsx';
import { useMemo } from 'react';
import { RENTAL_CATEGORIES, dayOf, expenseDayLabel, groupExpensesBySupplier, rentalsDue } from '../../lib/ledger.js';
import Hourglass from '../Hourglass.jsx';
import { expenseTitle } from '../ExpenseParts.jsx';
import Block from './Block.jsx';
import QueueList from './QueueList.jsx';
import { ReceiptIcon } from './icons.jsx';

/**
 * ZONE B, "Gastos y boletas": the receipts already tabulated, the ones still waiting for a connection (deferred queue) and,
 * for rented tools, the return date with its one-tap "returned" switch and the hourglass when it falls due.
 */
export default function ExpensesBlock({ expenses, queued, receipts, onChange, open, onToggle }) {
  const { t, money, moneyIn, locale } = useI18n();
  const day = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }), [locale]);
  const groups = useMemo(() => groupExpensesBySupplier(expenses), [expenses]);
  const due = rentalsDue(expenses, Date.now());
  const toggleReturned = (id) => onChange(expenses.map((e) => (e.id === id ? { ...e, returned: !e.returned } : e)));

  return (
    <Block icon={<ReceiptIcon size={32} />} label={t('ws.menu.expenses')} id="expenses" title={t('ws.expenses')} open={open} onToggle={onToggle} testId="ws-expenses">
      <QueueList rows={queued} onRetry={receipts?.retry} onDiscard={receipts?.discard} onAccept={receipts?.accept} />
      {expenses.length === 0 && queued.length === 0 && <p className="text-sm text-[#E0E0E0]/60">{t('ws.noExpenses')}</p>}
      {expenses.length > 0 && (
        // "Receipt stack": ONE block per supplier (its name big, what was spent there), the individual receipts stacked underneath as grey micro-text
        <div className="space-y-3" data-testid="expense-list">
          {groups.map((g, i) => {
            const fmt = (v) => (g.currency ? moneyIn(v, g.currency) : money(v));
            return (
              <section key={g.key} data-testid={`stack-shop-${i}`} className="rounded-xl border border-white/10 px-3 py-3">
                <h3 className="flex items-baseline justify-between gap-3">
                  <span className={`min-w-0 flex-1 truncate text-lg font-medium tracking-tight ${g.name ? 'text-neutral-200' : 'text-neutral-400'}`} data-testid="stack-shop-name">
                    {g.name || t('exp.noSupplier')}
                  </span>
                  <span className="shrink-0 text-lg font-medium tabular-nums text-neutral-200" data-testid="stack-shop-total">
                    {fmt(g.total)}
                  </span>
                </h3>
                <ul className="mt-1 divide-y divide-white/5">
                  {g.items.map((e) => {
                    const rental = RENTAL_CATEGORIES.includes(e.category);
                    const isDue = due.some((x) => x.id === e.id);
                    const when = expenseDayLabel(e.date, locale) || day.format(new Date(e.at || Date.now()));
                    return (
                      <li key={e.id} data-testid={`expense-${e.id}`} data-due={isDue ? 'true' : undefined} className="py-2">
                        <div className="flex items-start gap-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-neutral-500 tabular-nums" data-testid="stack-line">
                              {[when, e.sucursal].filter(Boolean).join(' · ')}
                            </span>
                            {e.description && (
                              <span className="block truncate text-xs text-neutral-500" data-testid="stack-desc">
                                {e.description}
                              </span>
                            )}
                          </span>
                          {isDue && <Hourglass label={t('rental.dueToday')} size={18} />}
                          <span className="shrink-0 text-xs tabular-nums text-neutral-400" data-testid="stack-amount">
                            {fmt(e.amount)}
                          </span>
                          <button type="button" onClick={() => onChange(expenses.filter((x) => x.id !== e.id))} aria-label={`${t('common.delete')}: ${expenseTitle(e, t)}`} className="-my-2 flex h-10 w-10 shrink-0 items-center justify-center text-lg text-neutral-500 hover:text-red-400">
                            ×
                          </button>
                        </div>
                        {rental && (
                          <button
                            type="button"
                            onClick={() => toggleReturned(e.id)}
                            aria-pressed={Boolean(e.returned)}
                            data-testid={`expense-return-${e.id}`}
                            className="mt-2 min-h-[44px] w-full rounded-lg border border-white/15 px-3 text-sm font-semibold"
                            style={e.returned ? { color: '#22c55e' } : isDue ? { color: '#e8c35f', borderColor: '#d4af37' } : undefined}
                          >
                            {e.returned ? `✓ ${t('rental.returned')}` : e.returnDate ? t('rental.returnBy', { date: e.returnDate === dayOf(Date.now()) ? t('light.todayShort') : e.returnDate }) : t('rental.markReturned')}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Block>
  );
}
