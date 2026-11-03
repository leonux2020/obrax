import { useI18n } from '../../lib/i18n.jsx';
import { profitability } from '../../lib/ledger.js';

/** A hairline progress track: `h-1 bg-neutral-800` with a coloured fill (the same kind of line as the 2 px one of the header, a little thicker). */
function Track({ pct, fill, label, testId }) {
  const value = Math.min(100, Math.max(0, pct));
  return (
    <div className="mt-1.5 h-1 bg-neutral-800" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} data-testid={testId}>
      <div className={`h-full ${fill}`} style={{ width: `${value}%` }} data-testid={testId ? `${testId}-fill` : undefined} />
    </div>
  );
}

/**
 * "Profitability x-ray" of a project (Audit mode): a passive, high-level read with nothing to tap or scroll.
 *   1. OPERATING MARGIN (collected minus expenses), big: green when it is a profit, soft orange when it is a loss (never red), grey at zero.
 *   2. COLLECTION EFFICIENCY: the share of the budget already collected.
 *   3. CAPITAL LEAKS: the 3 suppliers that took the most, each only as a share of the total spent, with a thin bar.
 * No receipts and no expense list here: that detail belongs to the tactical view.
 */
export default function ProfitabilityPanel({ project, budget = 0 }) {
  const { t, money } = useI18n();
  const x = profitability(project, budget, 3);
  const tone = x.margin > 0.005 ? 'text-brand-500' : x.margin < -0.005 ? 'text-orange-400' : 'text-neutral-400';
  const state = x.margin > 0.005 ? 'profit' : x.margin < -0.005 ? 'loss' : 'even';
  const pct = (v) => Math.round(v);
  return (
    <section data-testid="audit-health" aria-label={t('aud.health')} className="space-y-6 px-3 pt-6">
      <div data-testid="audit-margin" data-state={state}>
        <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">{t('aud.margin')}</p>
        <p data-testid="audit-margin-value" className={`mt-1 text-5xl font-medium leading-none tracking-tight tabular-nums ${tone}`}>
          {money(x.margin)}
        </p>
        <p className="mt-2 text-xs text-neutral-400">{t('aud.marginFormula')}</p>
      </div>

      <div data-testid="audit-efficiency">
        <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">{t('aud.efficiency')}</p>
        {x.efficiency === null ? (
          <p data-testid="audit-efficiency-empty" className="mt-1 text-sm text-neutral-400">
            {t('aud.noBudget')}
          </p>
        ) : (
          <>
            <p data-testid="audit-efficiency-value" className="mt-1 text-sm tabular-nums text-neutral-200">
              {t('aud.efficiencyOf', { pct: pct(x.efficiency) })}
            </p>
            <Track pct={x.efficiency} fill="bg-brand-500" label={t('aud.efficiency')} testId="audit-efficiency-bar" />
          </>
        )}
      </div>

      <div data-testid="audit-leaks">
        <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">{t('aud.leaks')}</p>
        {x.suppliers.length === 0 ? (
          <p data-testid="audit-leaks-empty" className="mt-1 text-sm text-neutral-400">
            {t('aud.noSpend')}
          </p>
        ) : (
          <ul className="mt-2 space-y-4">
            {x.suppliers.map((s, i) => (
              <li key={s.key} data-testid={`audit-leak-${i}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span data-testid="audit-leak-name" className="min-w-0 flex-1 truncate text-sm text-neutral-200">
                    {s.name || t('exp.noSupplier')}
                  </span>
                  <span data-testid="audit-leak-share" className="shrink-0 text-sm font-medium tabular-nums text-neutral-200">
                    {pct(s.share)}%
                  </span>
                </div>
                <Track pct={s.share} fill="bg-orange-400" label={s.name || t('exp.noSupplier')} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
