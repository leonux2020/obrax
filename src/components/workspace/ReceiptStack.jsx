import { useMemo } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { RENTAL_CATEGORIES, dayOf, expenseDayLabel, groupExpensesBySupplier, rentalsDue } from '../../lib/ledger.js';
import Hourglass from '../Hourglass.jsx';
import { expenseTitle } from '../ExpenseParts.jsx';

/**
 * "Receipt stack": the project's expenses as ONE block per supplier (its name big, what was spent there) with the individual receipts stacked
 * underneath as grey micro-text (date + sucursal, then the description, the amount on the right). Renders nothing when there are no expenses.
 *
 * It belongs to the TACTICAL view only (Gastos block): the Audit mode shows the profitability x-ray instead, never the receipts.
 */
export default function ReceiptStack({ expenses, onChange = null }) {
  const { t, money, moneyIn, locale } = useI18n();
  const day = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }), [locale]);
  const groups = useMemo(() => groupExpensesBySupplier(expenses), [expenses]);
  const due = rentalsDue(expenses, Date.now());
  const editable = typeof onChange === 'function';
  const toggleReturned = (id) => onChange(expenses.map((e) => (e.id === id ? { ...e, returned: !e.returned } : e)));
  if (!expenses.length) return null;

  return (
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
                        <span className="block truncate text-xs tabular-nums text-neutral-500" data-testid="stack-line">
                          {[when, e.sucursal].filter(Boolean).join(' · ')}
                        </span>
                        {e.description && (
                          <span className="block truncate text-xs text-neutral-500" data-testid="stack-desc">
                            {e.description}
                          </span>
                        )}
                      </span>
                      {isDue && <Hourglass label={t('rental.dueToday')} size={18} />}
                      <span className={`shrink-0 text-xs tabular-nums ${e.amount < 0 ? 'text-brand-500' : 'text-neutral-400'}`} data-testid="stack-amount" data-negative={e.amount < 0 ? 'true' : undefined}>
                        {fmt(e.amount)}
                      </span>
                      {editable && (
                        <button type="button" onClick={() => onChange(expenses.filter((x) => x.id !== e.id))} aria-label={`${t('common.delete')}: ${expenseTitle(e, t)}`} className="-my-2 flex h-10 w-10 shrink-0 items-center justify-center text-lg text-neutral-500 hover:text-red-400">
                          ×
                        </button>
                      )}
                    </div>
                    {rental && editable && (
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
  );
}
