import { useI18n } from '../../lib/i18n.jsx';
import { FINANCE_LIMITS } from '../../lib/draft.js';
import { Slider } from '../ui.jsx';

export default function StepFinance({ draft, setDraft, result }) {
  const { t, money } = useI18n();
  const set = (key) => (value) => setDraft((d) => ({ ...d, finance: { ...d.finance, [key]: value } }));

  return (
    <section aria-labelledby="fin-title" className="space-y-4">
      <h2 id="fin-title" className="text-2xl font-bold">
        {t('fin.title')}
      </h2>

      {['labor', 'transport', 'waste'].map((k) => (
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

      {result.valid && (
        <div className="card border-brand/50" aria-live="polite">
          <h3 className="mb-3 text-lg font-bold text-brand">{t('fin.summary')}</h3>
          <dl className="space-y-2 text-lg">
            {[
              ['fin.materials', result.quote.materials],
              ['fin.laborLine', result.quote.labor],
              ['fin.transportLine', result.quote.transport],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-neutral-300">{t(k)}</dt>
                <dd className="font-bold tabular-nums">{money(v)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-neutral-700 pt-2">
              <dt className="text-neutral-300">{t('fin.subtotal')}</dt>
              <dd className="font-bold tabular-nums">{money(result.quote.subtotal)}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
