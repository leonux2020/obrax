import { useI18n } from '../lib/i18n.jsx';
import { TASKS, runCalculation } from '../lib/tasks.js';
import { fieldLabel } from '../lib/reports.js';
import { NumberField, Segmented } from './ui.jsx';

/**
 * The headline figures of a partida (its area or volume...) computed live from the typed measures: no "calculate" button, the result is simply there.
 * Pure: returns [] until every required measure is valid (never NaN, never a half result).
 */
export function headlineMetrics(taskId, validation) {
  const task = TASKS[taskId];
  if (!task || !validation?.valid) return [];
  try {
    const { metrics } = runCalculation(taskId, validation.values);
    return (task.headline || []).map((key) => metrics.find((m) => m.key === key)).filter((m) => m && Number.isFinite(m.value));
  } catch {
    return [];
  }
}

/**
 * Measurement fields + closed options of one partida. Pure form: parent owns the data.
 * The numbers sit three to a row (Largo | Ancho | Alto) as quiet underlined lines (no boxes), with air between them, and the result appears right under them as they are typed.
 */
export default function DimsForm({ partida, validation, showErrors, onChange }) {
  const { t, num, unit } = useI18n();
  const task = TASKS[partida.task];
  const errors = validation?.errors ?? {};
  const results = headlineMetrics(partida.task, validation);

  const errorFor = (f) => {
    const e = errors[f.key];
    if (!e) return '';
    if (e === 'required') return showErrors ? t('err.required') : '';
    if (e === 'openings') return t('err.openings');
    return t('err.range', { min: num(f.min), max: num(f.max) });
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-x-5 gap-y-4" data-testid="dims-grid">
        {task.fields.map((f) => (
          <NumberField
            key={`${partida.id}-${partida.task}-${f.key}`}
            compact
            underline
            className="flex flex-col justify-end"
            label={fieldLabel(t, partida.task, f.key)}
            placeholder={f.required ? undefined : t('common.optional')}
            unit={unit(f.unit)}
            decimals={f.decimals}
            value={partida.dims[f.key]}
            onChange={(v) => onChange({ [f.key]: v })}
            error={errorFor(f)}
            hint={`${num(f.min)} – ${num(f.max)} ${unit(f.unit)}`}
          />
        ))}
      </div>

      {results.length > 0 && (
        <p data-testid="dims-result" aria-live="polite" className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1 text-sm font-light text-neutral-400">
          {results.map((m) => (
            <span key={m.key} data-testid={`dims-result-${m.key}`}>
              {t(`metric.${m.key}`)}{' '}
              <span className="text-base font-normal tabular-nums text-[#e8c35f]/90">
                {num(m.value, 2)} {unit(m.unit)}
              </span>
            </span>
          ))}
        </p>
      )}

      {task.options.map((o) => (
        <Segmented
          key={o.key}
          label={t(`opt.${partida.task}.${o.key}`)}
          value={partida.dims[o.key]}
          onChange={(v) => onChange({ [o.key]: v })}
          options={o.values.map((v) => ({ value: v, label: t(`opt.${partida.task}.${o.key}.${v}`) }))}
        />
      ))}
    </div>
  );
}
