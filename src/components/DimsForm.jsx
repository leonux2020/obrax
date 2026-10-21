import { useI18n } from '../lib/i18n.jsx';
import { TASKS } from '../lib/tasks.js';
import { fieldLabel } from '../lib/reports.js';
import { NumberField, Segmented } from './ui.jsx';

/** Measurement fields + closed options of one partida. Pure form: parent owns the data. */
export default function DimsForm({ partida, validation, showErrors, onChange }) {
  const { t, num, unit } = useI18n();
  const task = TASKS[partida.task];
  const errors = validation?.errors ?? {};

  const errorFor = (f) => {
    const e = errors[f.key];
    if (!e) return '';
    if (e === 'required') return showErrors ? t('err.required') : '';
    if (e === 'openings') return t('err.openings');
    return t('err.range', { min: num(f.min), max: num(f.max) });
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {task.fields.map((f) => (
        <NumberField
          key={`${partida.id}-${partida.task}-${f.key}`}
          label={fieldLabel(t, partida.task, f.key)}
          optional={f.required ? undefined : t('common.optional')}
          unit={unit(f.unit)}
          decimals={f.decimals}
          value={partida.dims[f.key]}
          onChange={(v) => onChange({ [f.key]: v })}
          error={errorFor(f)}
          hint={`${num(f.min)} – ${num(f.max)} ${unit(f.unit)}`}
        />
      ))}
      {task.options.map((o) => (
        <div key={o.key} className={o.values.length > 2 ? 'sm:col-span-2' : ''}>
          <Segmented
            label={t(`opt.${partida.task}.${o.key}`)}
            value={partida.dims[o.key]}
            onChange={(v) => onChange({ [o.key]: v })}
            options={o.values.map((v) => ({ value: v, label: t(`opt.${partida.task}.${o.key}.${v}`) }))}
          />
        </div>
      ))}
    </div>
  );
}
