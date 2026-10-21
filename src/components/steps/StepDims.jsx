import { useI18n } from '../../lib/i18n.jsx';
import { TASKS } from '../../lib/tasks.js';
import { NumberField, Segmented } from '../ui.jsx';

export default function StepDims({ draft, setDraft, result, showErrors }) {
  const { t, num, unit } = useI18n();
  const task = TASKS[draft.task];
  const errors = result.validation.errors;

  const errorFor = (f) => {
    const e = errors[f.key];
    if (!e) return '';
    if (e === 'required') return showErrors ? t('err.required') : '';
    if (e === 'openings') return t('err.openings');
    return t('err.range', { min: num(f.min), max: num(f.max) });
  };

  const setDim = (key, value) => setDraft((d) => ({ ...d, dims: { ...d.dims, [key]: value } }));

  return (
    <section aria-labelledby="dims-title" className="space-y-5">
      <div>
        <h2 id="dims-title" className="text-2xl font-bold">
          {t('dims.title')} · {t(`task.${draft.task}`)}
        </h2>
        <p className="text-neutral-300">{t('dims.hint')}</p>
      </div>

      <div className="card grid gap-4 sm:grid-cols-2">
        {task.fields.map((f) => (
          <NumberField
            key={`${draft.task}-${f.key}`}
            label={t(`field.${f.key}`)}
            optional={f.required ? undefined : t('common.optional')}
            unit={unit(f.unit)}
            decimals={f.decimals}
            value={draft.dims[f.key]}
            onChange={(v) => setDim(f.key, v)}
            error={errorFor(f)}
            hint={`${num(f.min)} – ${num(f.max)} ${unit(f.unit)}`}
          />
        ))}
        {task.options?.includes('faces') && (
          <div className="sm:col-span-2">
            <Segmented
              label={t('field.faces')}
              value={draft.dims.faces}
              onChange={(v) => setDim('faces', v)}
              options={[
                { value: 1, label: t('faces.1') },
                { value: 2, label: t('faces.2') },
              ]}
            />
          </div>
        )}
      </div>

      {result.valid && (
        <div className="card border-brand/50" aria-live="polite">
          <h3 className="mb-3 text-lg font-bold text-brand">{t('dims.preview')}</h3>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {result.calc.metrics.map((m) => (
              <div key={m.key}>
                <dt className="text-sm text-neutral-300">{t(`metric.${m.key}`)}</dt>
                <dd className="text-2xl font-extrabold tabular-nums">
                  {num(m.value, 3)} <span className="text-base font-semibold text-neutral-300">{unit(m.unit)}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
