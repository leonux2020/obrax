import { useI18n } from '../lib/i18n.jsx';
import BottomSheet from './BottomSheet.jsx';

const AMBER = 'text-[#e8c35f]';

function Row({ sign, label, value, strong = false, warn = false, testid }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? 'border-t border-white/10 pt-2.5' : ''}`}>
      <dt className={`min-w-0 flex-1 text-sm ${strong ? 'font-semibold text-neutral-200' : 'text-neutral-400'}`}>
        <span aria-hidden="true" className="mr-1.5 inline-block w-4 text-center text-neutral-500">
          {sign}
        </span>
        {label}
      </dt>
      <dd
        data-testid={testid}
        className={`shrink-0 whitespace-nowrap text-right tabular-nums ${strong ? 'text-lg font-semibold' : 'text-sm font-semibold'} ${warn ? AMBER : 'text-neutral-200'}`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * "Dettaglio Finanziario": an ultra-compact sum per currency, nothing else. Income - expenses - advances = liquid balance.
 * (No tax formulas and no per-project receivables here: those belong to each project.) One block per currency, never mixed.
 */
export default function GlobalBreakdownSheet({ breakdown, moneyOf, onClose }) {
  const { t } = useI18n();
  const many = breakdown.length > 1;

  return (
    <BottomSheet title={t('acc.sheet.title')} onClose={onClose} swipeToClose>
      <div className="space-y-4" data-testid="acc-sheet">
        {breakdown.map((l) => {
          const money = moneyOf(l.regionCode);
          return (
            <div key={l.currency} data-testid={`acc-sheet-avail-${l.currency}`}>
              {many && <p className="mb-0.5 text-xs font-medium text-neutral-400 tabular-nums">{l.currency}</p>}
              <dl>
                <Row sign="+" label={t('acc.sheet.in')} value={money(l.received)} testid={`acc-sheet-in-${l.currency}`} />
                <Row sign="−" label={t('acc.sheet.exp')} value={money(l.spent)} testid={`acc-sheet-exp-${l.currency}`} />
                <Row sign="−" label={t('acc.sheet.adv')} value={money(l.advanced)} testid={`acc-sheet-adv-${l.currency}`} />
                <Row sign="=" strong warn={l.liquid < 0} label={t('acc.sheet.liquid')} value={money(l.liquid)} testid={`acc-sheet-liquid-${l.currency}`} />
              </dl>
            </div>
          );
        })}
      </div>
    </BottomSheet>
  );
}
