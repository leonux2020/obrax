import { useId, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { sanitizeText } from '../lib/sanitize.js';
import { TASKS, WASTE_PRESETS as PRESET_VALUES, defaultDims, effectiveWaste, validateDims } from '../lib/tasks.js';
import { TextField } from './ui.jsx';
import TaskPicker from './TaskPicker.jsx';
import DimsForm from './DimsForm.jsx';
import Collapsible from './workspace/Collapsible.jsx';
import LockedZone from './workspace/LockedZone.jsx';
import { TrashIcon } from './EditControls.jsx';

export const FORM_MODES = ['create', 'edit'];

/** The three waste presets (values live in tasks.js: Minimum is a real 5 %, never the 0 % floor of the model). */
const WASTE_PRESETS = [
  { id: 'min', value: PRESET_VALUES.min },
  { id: 'normal', value: PRESET_VALUES.normal },
  { id: 'critical', value: PRESET_VALUES.critical },
];

/** Pill of the waste group: a quiet translucent fill; the active one turns brand-tinted (the colour is the only signal, no box shadow). */
const wastePill = (active) => `relative flex min-h-[40px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm transition active:scale-95 active:opacity-70 before:absolute before:-inset-y-0.5 before:inset-x-0 before:content-[""] ${active ? 'bg-brand/20 font-normal text-brand' : 'bg-white/5 font-light text-neutral-400'}`;

/** The preset a stored waste belongs to: the exact one, or the nearest for legacy / per-task defaults (read only: nothing is rewritten until the user taps). */
const activePreset = (waste) => {
  if (!Number.isFinite(waste)) return null;
  return WASTE_PRESETS.reduce((best, x) => (Math.abs(x.value - waste) < Math.abs(best.value - waste) ? x : best)).id;
};

/** Whatever arrives (a new faena, a stored one from an old version, junk) as the values the form edits. Nothing stored is rewritten or dropped: only missing pieces are filled in. */
const seed = (values) => {
  const task = TASKS[values?.task] ? values.task : 'slab';
  const dims = values?.dims && typeof values.dims === 'object' ? values.dims : defaultDims(task);
  return { name: typeof values?.name === 'string' ? values.name : '', task, dims, waste: values?.waste };
};

/**
 * THE faena form: the same screen to CREATE a job's partida (a new project / a new line) and to EDIT it (a saved project). One component, one look.
 *   Always in sight:  the name, the carousel of trades and the measures (underlined lines, the result appears as you type).
 *   Behind "Ajustes avanzados" (closed): the waste, and whatever the parent passes in `advanced` (materials with their prices, safety guide, machinery).
 * It edits a copy: `initialValues` ({ id?, name, task, dims, waste }) seeds it, every change is reported by `onChange(nextValues)` and a CHANGE OF THE
 * OUTSIDE (the parent loads another quote, an undo...) is picked up again, so the screen never shows stale numbers.
 * @param mode        'create' | 'edit' (anything else = create). In create the required-field hints wait for the first interaction (a blank form is not an error)
 * @param validation  optional: the engine's verdict on the measures; without it the form validates them itself
 * @param onRemove    optional: shows the trash icon of the faena
 * @param locked      the quote is frozen / signed: what moves the numbers is read-only and every tap answers `onBlocked`
 */
export default function ProjectForm({ mode = 'create', initialValues = null, onChange, validation = null, showErrors, onRemove = null, locked = false, onBlocked, index = 0, advanced = null }) {
  const { t } = useI18n();
  const kind = mode === 'edit' ? 'edit' : 'create';
  const typeLabel = useId();
  const incoming = JSON.stringify(initialValues ?? null);
  const [seen, setSeen] = useState(incoming);
  const [values, setValues] = useState(() => seed(initialValues));
  const [touched, setTouched] = useState(false);
  if (incoming !== seen) {
    // the parent changed the values behind our back: adopt them (the standard "derive state from props" pattern)
    setSeen(incoming);
    setValues(seed(initialValues));
  }

  const emit = (next) => {
    setValues(next);
    setTouched(true);
    onChange?.(next);
  };
  const waste = effectiveWaste(values.waste, values.task); // the figure the quote really uses: a missing / NaN waste is the task's default, never a silent 0
  const verdict = validation ?? validateDims(values.task, values.dims);
  const hints = showErrors ?? (kind === 'edit' || touched);

  return (
    <div data-testid={`project-form-${index}`} data-mode={kind} className="space-y-6">
      <LockedZone locked={locked} onBlocked={onBlocked} className="relative space-y-6">
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            data-testid={`partida-remove-${index}`}
            aria-label={t('part.delete')}
            title={t('part.delete')}
            className="absolute right-0 top-0 z-[1] flex h-11 w-11 items-center justify-center rounded-full text-neutral-500 transition active:scale-95 active:text-red-400/90"
          >
            <TrashIcon size={20} />
          </button>
        )}
        <div className={onRemove ? 'pr-12' : ''}>
          <TextField underline label={t('part.name')} optional={t('common.optional')} placeholder={t('part.namePh')} maxLength={60} value={values.name} sanitize={(v) => sanitizeText(v, 60)} onChange={(name) => emit({ ...values, name })} />
        </div>
        <div>
          <p id={typeLabel} className="label">
            {t('part.type')}
          </p>
          <TaskPicker
            value={values.task}
            onChange={(task) => (task === values.task ? undefined : emit({ ...values, task, dims: defaultDims(task, values.dims), waste: TASKS[task].defaultWaste }))}
            labelledBy={typeLabel}
          />
        </div>
        <div>
          <p className="label">{t('ws.measures')}</p>
          <DimsForm partida={{ id: initialValues?.id ?? index, task: values.task, dims: values.dims }} validation={verdict} showErrors={hints} onChange={(patch) => emit({ ...values, dims: { ...values.dims, ...patch } })} />
        </div>
      </LockedZone>

      {/* progressive disclosure: the waste and the logistics (materials, safety guide, machinery) stay out of sight until the user wants the technical side */}
      <Collapsible title={t('form.advanced')} chips={[`${t(`fin.waste_${activePreset(waste) ?? 'normal'}`)} ${waste}%`]} showCount={false} testId={`advanced-${index}`}>
        <div className="space-y-6">
          <LockedZone locked={locked} onBlocked={onBlocked} className="space-y-6">
            <div data-testid={`waste-${index}`}>
              <p className="label">
                {t('fin.waste')}
                <span data-testid={`waste-${index}-value`} className="ml-2 font-light tabular-nums text-neutral-400">
                  {waste}%
                </span>
              </p>
              <div role="radiogroup" aria-label={t('fin.waste')} className="flex flex-row gap-2">
                {WASTE_PRESETS.map(({ id, value }) => {
                  const active = activePreset(waste) === id;
                  return (
                    <button key={id} type="button" role="radio" aria-checked={active} onClick={() => emit({ ...values, waste: value })} data-testid={`waste-${index}-${id}`} data-value={value} className={wastePill(active)}>
                      {t(`fin.waste_${id}`)}
                      <span className="text-xs font-light tabular-nums opacity-70">{value}%</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </LockedZone>
          {advanced}
        </div>
      </Collapsible>
    </div>
  );
}
