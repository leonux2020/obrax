import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';

/**
 * The shared pieces of the "edit mode" (Zero Stress): a floating pencil that replaces the x of a sheet's header, and the discreet row
 * delete that only exists while the mode is on. Icons carry NO box of their own (no border, fill, ring or shadow): they float on the
 * black ground, `text-neutral-400 hover:text-white` (tests/visualRules.test.js keeps every pencil button clean).
 */

export const PencilIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-outline-icon="true" data-icon="pencil">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

export const CheckIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-outline-icon="true" data-icon="check">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const TrashIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-outline-icon="true" data-icon="trash">
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
  </svg>
);

/** The header action that REPLACES the classic close x: a pencil, or a check while the edit mode is on. The sheet then closes the native way. */
export function EditToggle({ active, onToggle, disabled = false, label, doneLabel, testId = 'edit-toggle' }) {
  const text = active ? doneLabel : label;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={active}
      aria-label={text}
      title={text}
      data-testid={testId}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition disabled:opacity-30 ${active ? 'text-brand' : 'text-neutral-400 hover:text-white'}`}
    >
      {active ? <CheckIcon /> : <PencilIcon />}
    </button>
  );
}

/**
 * The delete of one row, visible ONLY in edit mode and in two steps: the first tap turns the trash into a red "Eliminar", the second one
 * deletes (it disarms by itself after a few seconds). A thumb on a muddy site can never remove a person with a single stray tap.
 */
export function RowDelete({ name, onConfirm, testId }) {
  const { t } = useI18n();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  if (armed) {
    return (
      <button type="button" onClick={onConfirm} data-testid={`${testId}-confirm`} aria-label={`${t('common.delete')}: ${name}`} className="min-h-[44px] shrink-0 px-2 text-sm font-semibold text-red-400 hover:text-red-300">
        {t('common.delete')}
      </button>
    );
  }
  return (
    <button type="button" onClick={() => setArmed(true)} data-testid={testId} aria-label={`${t('common.delete')}: ${name}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-red-400/80 transition hover:text-red-400">
      <TrashIcon />
    </button>
  );
}
