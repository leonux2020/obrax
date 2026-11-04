import { useMemo } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { expensesTotal } from '../../lib/ledger.js';
import Block from './Block.jsx';
import QueueList from './QueueList.jsx';
import ReceiptStack from './ReceiptStack.jsx';
import { ReceiptIcon } from './icons.jsx';

/**
 * The auditor's total, where the x used to be: everything the project spent, in the project's BASE currency (the frozen `amountBase` of every
 * foreign receipt, see fx.js). It follows the list live (a returned rental, a deleted line, a receipt just saved) because it is computed from it.
 */
function TotalAuditor({ expenses }) {
  const { t, money } = useI18n();
  const total = useMemo(() => expensesTotal(expenses), [expenses]);
  return (
    <div className="flex min-w-0 shrink-0 flex-col items-end justify-center pt-0.5 text-right" role="status" aria-live="polite" data-testid="expenses-total" data-total={total}>
      <span className="text-xs font-medium uppercase text-neutral-500">{t('rcpt.total')}</span>
      <span className={`max-w-[11rem] truncate text-xl font-semibold leading-tight tabular-nums ${total < 0 ? 'text-brand-500' : 'text-[#e8c35f]'}`} data-testid="expenses-total-amount">
        {money(total)}
      </span>
    </div>
  );
}

/**
 * ZONE B, "Gastos y boletas": the receipt stack (expenses grouped by supplier), the receipts still waiting for a connection (deferred queue) and,
 * for rented tools, the return date with its one-tap "returned" switch and the hourglass when it falls due. The sheet has no x: the total of the
 * project sits in its corner and the sheet closes the native way (Back, swipe down, backdrop).
 */
export default function ExpensesBlock({ expenses, queued, receipts, onChange, open, onToggle }) {
  const { t } = useI18n();
  return (
    <Block
      icon={<ReceiptIcon size={32} />}
      label={t('ws.menu.expenses')}
      id="expenses"
      title={t('ws.expenses')}
      open={open}
      onToggle={onToggle}
      testId="ws-expenses"
      swipeToClose
      headerAction={<TotalAuditor expenses={expenses} />}
    >
      <QueueList rows={queued} onRetry={receipts?.retry} onDiscard={receipts?.discard} onAccept={receipts?.accept} />
      {expenses.length === 0 && queued.length === 0 && <p className="text-sm text-neutral-400">{t('ws.noExpenses')}</p>}
      <ReceiptStack expenses={expenses} onChange={onChange} />
    </Block>
  );
}
