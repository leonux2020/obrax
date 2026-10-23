import { useI18n } from '../../lib/i18n.jsx';
import { FINANCE_LIMITS, TAX_LIMITS } from '../../lib/draft.js';
import { WASTE_LIMITS } from '../../lib/tasks.js';
import { partidaTitle } from '../../lib/reports.js';
import { useState } from 'react';
import { NumberField, Slider } from '../ui.jsx';
import ScheduleSheet from '../ScheduleSheet.jsx';
import MachineryCard from '../MachineryCard.jsx';

export default function StepFinance({ draft, setDraft, result }) {
  const { t, money, num, region } = useI18n();
  const set = (key) => (value) => setDraft((d) => ({ ...d, finance: { ...d.finance, [key]: value } }));
  const setWaste = (id) => (waste) =>
    setDraft((d) => ({ ...d, partidas: d.partidas.map((p) => (p.id === id ? { ...p, waste } : p)) }));
  const officialPct = num(region.taxRate * 100);
  const many = draft.partidas.length > 1;
  const [planning, setPlanning] = useState(false);
  const sched = result.schedule; // only present once every partida is valid

  return (
    <section aria-labelledby="fin-title" className="space-y-4">
      <h2 id="fin-title" className="text-2xl font-bold">
        {t('fin.title')}
      </h2>

      {['labor', 'transport', 'contingency', 'profit'].map((k) => (
        <Slider
          key={k}
          label={t(`fin.${k}`)}
          description={t(`fin.${k}.desc`)}
          value={draft.finance[k]}
          min={FINANCE_LIMITS[k].min}
          max={FINANCE_LIMITS[k].max}
          step={FINANCE_LIMITS[k].step}
          onChange={set(k)}
        />
      ))}

      {draft.partidas.map((p, i) => (
        <Slider
          key={p.id}
          label={many ? t('fin.wasteFor', { title: `${i + 1}. ${partidaTitle(p, t)}` }) : t('fin.waste')}
          description={t('fin.waste.desc')}
          value={p.waste}
          min={WASTE_LIMITS.min}
          max={WASTE_LIMITS.max}
          step={WASTE_LIMITS.step}
          onChange={setWaste(p.id)}
        />
      ))}

      {result.valid && sched.totals.hh > 0 && (
        <button
          type="button"
          data-testid="schedule-open"
          onClick={() => setPlanning(true)}
          className="card flex min-h-[64px] w-full items-center gap-3 text-left transition hover:border-brand active:scale-[0.99]"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-bold">{t('sched.open')}</span>
            <span className="block text-sm text-neutral-300">
              {t('sched.summary', { days: num(sched.totals.totalDays, 1), hh: num(sched.totals.hh, 1), n: sched.crew })}
            </span>
          </span>
          <span aria-hidden="true" className="text-2xl text-brand">
            ›
          </span>
        </button>
      )}

      {result.valid && <MachineryCard draft={draft} setDraft={setDraft} result={result} />}
      {planning && <ScheduleSheet draft={draft} setDraft={setDraft} result={result} onClose={() => setPlanning(false)} />}

      <div className="card">
        {region.taxEditable ? (
          <NumberField
            label={t('fin.tax', { name: region.taxName })}
            unit="%"
            decimals={TAX_LIMITS.decimals}
            placeholder={officialPct}
            value={draft.finance.tax}
            onChange={set('tax')}
            hint={t('fin.tax.desc', { name: region.taxName, rate: officialPct })}
          />
        ) : (
          <p className="text-lg">
            <span aria-hidden="true">{region.flag} </span>
            {t('fin.taxOfficial', { name: region.taxName, rate: officialPct })}
          </p>
        )}
      </div>

      {result.valid && (
        <div className="card border-brand/50" aria-live="polite">
          <h3 className="mb-3 text-lg font-bold text-brand">{t('fin.summary')}</h3>
          <dl className="space-y-2 text-lg">
            {[
              [t('fin.materials'), result.quote.materials],
              [t('fin.laborLine'), result.quote.labor],
              [t('fin.transportLine'), result.quote.transport],
              ...(result.quote.machinery > 0 ? [[t('mach.total'), result.quote.machinery]] : []),
              ...(result.quote.contingency > 0 ? [[t('fin.contingencyLine'), result.quote.contingency]] : []),
              ...(result.quote.profit > 0 ? [[t('fin.profitLine'), result.quote.profit]] : []),
            ].map(([label, v]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-neutral-300">{label}</dt>
                <dd className="font-bold tabular-nums">{money(v)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-neutral-700 pt-2">
              <dt className="text-neutral-300">{t('com.subtotalNet')}</dt>
              <dd className="font-bold tabular-nums">{money(result.quote.subtotal)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-300">
                {t('fin.taxLine', { name: region.taxName, rate: num(result.quote.taxRate * 100) })}
              </dt>
              <dd className="font-bold tabular-nums">{money(result.quote.tax)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-neutral-700 pt-2 text-xl">
              <dt className="font-bold">{t('fin.totalWithTax')}</dt>
              <dd className="font-extrabold tabular-nums text-brand">{money(result.quote.total)}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
