import { useI18n } from '../lib/i18n.jsx';
import { expenseDayLabel, supplierTotals } from '../lib/ledger.js';

/** The name an expense goes by in lists / aria labels: the shop first, then what was bought, then a plain "Gasto". */
export const expenseTitle = (e, t) => e.supplier || e.description || t('exp.fallback');

/**
 * Top summary of the expenses tab: how much went to each shop, as a horizontal strip of compact chips (OLED black, scrolls sideways,
 * no visible scrollbar). Renders nothing when there are no expenses.
 */
export function SupplierTotals({ expenses }) {
  const { t, money, num, region } = useI18n();
  const groups = supplierTotals(expenses);
  if (groups.length === 0) return null;
  return (
    <ul
      role="list"
      aria-label={t('exp.byVendor')}
      data-testid="supplier-totals"
      className="-mx-1 mb-3 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {groups.map((g, i) => (
        <li key={g.key} data-testid={`supplier-total-${i}`} className="flex min-h-[40px] shrink-0 snap-start items-center gap-2 rounded-full border border-white/10 bg-black px-3.5 py-1.5 text-sm">
          <span className={`max-w-[9rem] truncate font-semibold ${g.name ? 'text-neutral-100' : 'text-neutral-400'}`} data-testid="supplier-total-name">
            {g.name || t('exp.noSupplier')}
          </span>
          <span className="font-extrabold tabular-nums text-brand" data-testid="supplier-total-amount">
            {g.currency && g.currency !== region?.currency ? `${num(g.total)} ${g.currency}` : money(g.total)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Left side of an expense card: the SHOP is the headline (falls back to the description, then "Gasto"); under it, clean subtitles with
 * the receipt's printed date and the category; the purchased line shows underneath when the shop already took the headline.
 */
export function ExpenseHead({ e, titleClass = 'text-sm', subClass = 'text-xs text-neutral-400' }) {
  const { t, locale } = useI18n();
  const title = expenseTitle(e, t);
  const sub = [expenseDayLabel(e.date, locale), t(`exp.cat.${e.category}`)].filter(Boolean).join(' · ');
  const detail = e.supplier && e.description ? e.description : '';
  return (
    <span className="min-w-0 flex-1">
      <span className={`block truncate font-bold ${titleClass}`} data-testid="expense-title">
        {title}
      </span>
      <span className={`block truncate ${subClass}`} data-testid="expense-sub">
        {sub}
      </span>
      {detail && (
        <span className={`block truncate ${subClass} opacity-80`} data-testid="expense-detail">
          {detail}
        </span>
      )}
    </span>
  );
}
