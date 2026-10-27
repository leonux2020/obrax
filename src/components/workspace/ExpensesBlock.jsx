import { useI18n } from '../../lib/i18n.jsx';
import { RENTAL_CATEGORIES, dayOf, rentalsDue } from '../../lib/ledger.js';
import Hourglass from '../Hourglass.jsx';
import Block from './Block.jsx';
import QueueList from './QueueList.jsx';

/**
 * ZONE B, "Gastos y boletas": the receipts already tabulated, the ones still waiting for a connection (deferred queue) and,
 * for rented tools, the return date with its one-tap "returned" switch and the hourglass when it falls due.
 */
export default function ExpensesBlock({ expenses, queued, receipts, onChange, open, onToggle }) {
  const { t, money } = useI18n();
  const due = rentalsDue(expenses, Date.now());
  const toggleReturned = (id) => onChange(expenses.map((e) => (e.id === id ? { ...e, returned: !e.returned } : e)));

  return (
    <Block id="expenses" title={t('ws.expenses')} open={open} onToggle={onToggle} testId="ws-expenses">
      <QueueList rows={queued} onRetry={receipts?.retry} onDiscard={receipts?.discard} onAccept={receipts?.accept} />
      {expenses.length === 0 && queued.length === 0 && <p className="text-sm text-[#E0E0E0]/60">{t('ws.noExpenses')}</p>}
      {expenses.length > 0 && (
        <ul className="space-y-2" data-testid="expense-list">
          {expenses.map((e) => {
            const rental = RENTAL_CATEGORIES.includes(e.category);
            const isDue = due.some((x) => x.id === e.id);
            return (
              <li key={e.id} data-testid={`expense-${e.id}`} data-due={isDue ? 'true' : undefined} className="rounded-xl border border-l-2 border-white/10 px-3 py-2" style={isDue ? { borderLeftColor: '#d4af37' } : undefined}>
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{e.description || t(`exp.cat.${e.category}`)}</span>
                    <span className="block truncate text-xs text-[#E0E0E0]/60">{[t(`exp.cat.${e.category}`), e.supplier].filter(Boolean).join(' · ')}</span>
                  </span>
                  {isDue && <Hourglass label={t('rental.dueToday')} size={18} />}
                  <span className="text-sm font-extrabold tabular-nums">{money(e.amount)}</span>
                  <button type="button" onClick={() => onChange(expenses.filter((x) => x.id !== e.id))} aria-label={`${t('common.delete')}: ${e.description || t(`exp.cat.${e.category}`)}`} className="flex h-10 w-10 items-center justify-center text-lg text-[#E0E0E0]/50 hover:text-red-400">
                    ×
                  </button>
                </div>
                {rental && (
                  <button
                    type="button"
                    onClick={() => toggleReturned(e.id)}
                    aria-pressed={Boolean(e.returned)}
                    data-testid={`expense-return-${e.id}`}
                    className="mt-2 min-h-[44px] w-full rounded-lg border border-white/15 px-3 text-sm font-bold"
                    style={e.returned ? { color: '#22c55e' } : isDue ? { color: '#e8c35f', borderColor: '#d4af37' } : undefined}
                  >
                    {e.returned ? `✓ ${t('rental.returned')}` : e.returnDate ? t('rental.returnBy', { date: e.returnDate === dayOf(Date.now()) ? t('light.todayShort') : e.returnDate }) : t('rental.markReturned')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Block>
  );
}
