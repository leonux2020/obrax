import { useI18n } from '../../lib/i18n.jsx';
import Block from './Block.jsx';
import QueueList from './QueueList.jsx';
import ReceiptStack from './ReceiptStack.jsx';
import { ReceiptIcon } from './icons.jsx';

/**
 * ZONE B, "Gastos y boletas": the receipt stack (expenses grouped by supplier), the receipts still waiting for a connection (deferred queue) and,
 * for rented tools, the return date with its one-tap "returned" switch and the hourglass when it falls due.
 */
export default function ExpensesBlock({ expenses, queued, receipts, onChange, open, onToggle }) {
  const { t } = useI18n();
  return (
    <Block icon={<ReceiptIcon size={32} />} label={t('ws.menu.expenses')} id="expenses" title={t('ws.expenses')} open={open} onToggle={onToggle} testId="ws-expenses">
      <QueueList rows={queued} onRetry={receipts?.retry} onDiscard={receipts?.discard} onAccept={receipts?.accept} />
      {expenses.length === 0 && queued.length === 0 && <p className="text-sm text-[#E0E0E0]/60">{t('ws.noExpenses')}</p>}
      <ReceiptStack expenses={expenses} onChange={onChange} />
    </Block>
  );
}
