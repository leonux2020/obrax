import { useI18n } from '../lib/i18n.jsx';
import BottomSheet from './BottomSheet.jsx';

const AMBER = 'text-[#e8c35f]';

function Row({ sign, label, value, strong = false, warn = false, testid }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? 'border-t border-white/10 pt-2.5' : ''}`}>
      <dt className={`min-w-0 flex-1 text-sm ${strong ? 'font-bold text-[#E0E0E0]' : 'text-[#E0E0E0]/70'}`}>
        <span aria-hidden="true" className="mr-1.5 inline-block w-4 text-center text-[#E0E0E0]/50">
          {sign}
        </span>
        {label}
      </dt>
      <dd
        data-testid={testid}
        className={`shrink-0 whitespace-nowrap text-right tabular-nums ${strong ? 'text-lg font-extrabold' : 'text-sm font-semibold'} ${warn ? AMBER : 'text-[#E0E0E0]'}`}
      >
        {value}
      </dd>
    </div>
  );
}

const Heading = ({ children }) => <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/50">{children}</h3>;

/**
 * "Desglose Financiero Global": what the HUD adds up, in plain words. Available cash (in - spent - advanced), the tax to set aside
 * and the active jobs still owing money (late ones in orange). One block per currency, never mixed.
 */
export default function GlobalBreakdownSheet({ breakdown, receivables, taxLabel, titleOf, moneyOf, onClose }) {
  const { t } = useI18n();
  const many = breakdown.length > 1;
  const currencyTag = (l) => (many ? <p className="mb-0.5 mt-2 text-xs font-bold text-[#E0E0E0]/70">{l.currency}</p> : null);

  return (
    <BottomSheet title={t('acc.sheet.title')} onClose={onClose} swipeToClose backClose>
      <div className="space-y-6" data-testid="acc-sheet">
        <section data-testid="acc-sheet-avail">
          <Heading>{t('acc.sheet.avail')}</Heading>
          {breakdown.map((l) => {
            const money = moneyOf(l.regionCode);
            return (
              <div key={l.currency} data-testid={`acc-sheet-avail-${l.currency}`}>
                {currencyTag(l)}
                <dl>
                  <Row sign="+" label={t('acc.sheet.in')} value={money(l.received)} testid={`acc-sheet-in-${l.currency}`} />
                  <Row sign="−" label={t('acc.sheet.exp')} value={money(l.spent)} testid={`acc-sheet-exp-${l.currency}`} />
                  <Row sign="−" label={t('acc.sheet.adv')} value={money(l.advanced)} testid={`acc-sheet-adv-${l.currency}`} />
                  <Row sign="=" strong warn={l.liquid < 0} label={t('acc.sheet.liquid')} value={money(l.liquid)} testid={`acc-sheet-liquid-${l.currency}`} />
                </dl>
              </div>
            );
          })}
          <p className="mt-1 text-xs text-[#E0E0E0]/50">{t('acc.sheet.liquid.hint')}</p>
        </section>

        <section data-testid="acc-sheet-tax">
          <Heading>{t('acc.sheet.tax', { tax: taxLabel || t('acc.hud.tax') })}</Heading>
          {breakdown.map((l) => (
            <div key={l.currency} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="text-sm text-[#E0E0E0]/70">{many ? l.currency : taxLabel || t('acc.hud.tax')}</span>
              <span data-testid={`acc-sheet-taxamt-${l.currency}`} className="whitespace-nowrap text-right text-lg font-extrabold tabular-nums text-[#E0E0E0]">
                {moneyOf(l.regionCode)(l.tax)}
              </span>
            </div>
          ))}
          <p className="mt-1 text-sm text-[#E0E0E0]/70">{t('acc.hud.tax.hint')}</p>
          <p className="mt-0.5 text-xs text-[#E0E0E0]/50">{t('acc.sheet.tax.formula')}</p>
        </section>

        <section data-testid="acc-sheet-rec">
          <Heading>{t('acc.sheet.rec')}</Heading>
          {receivables.length === 0 ? (
            <p className="py-1.5 text-sm text-[#E0E0E0]/50">{t('acc.sheet.rec.none')}</p>
          ) : (
            <ul className="divide-y divide-white/10">
              {receivables.map((r) => (
                <li key={r.id} data-testid={`acc-sheet-rec-${r.id}`} className="flex min-h-[44px] items-center justify-between gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[#E0E0E0]">{titleOf(r.id)}</span>
                    {r.late > 0 && (
                      <span
                        data-testid={`acc-sheet-late-${r.id}`}
                        className="mt-0.5 inline-block rounded-full border border-orange-400/50 px-1.5 text-[10px] font-semibold text-orange-400"
                      >
                        {t('acc.sheet.rec.late', { n: r.late })}
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 whitespace-nowrap text-right text-sm font-extrabold tabular-nums ${r.late > 0 ? 'text-orange-400' : 'text-[#E0E0E0]'}`}
                  >
                    {moneyOf(r.regionCode)(r.pending)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </BottomSheet>
  );
}
