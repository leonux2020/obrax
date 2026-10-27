import { useReducer } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { padDisplay, padInit, padReduce, padValue } from '../../lib/numpad.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'dot', '0', 'back'];

/**
 * The app's own numeric pad (the OS keyboard never opens): prices, daily rental rates, crew size, days, advances.
 * Every keystroke that makes a valid number calls `onChange(n)` at once, so the quote recalculates while the user types;
 * an empty / zero value applies nothing. `max` refuses a digit that would go over it. Big keys, bottom of the screen,
 * reachable with the thumb.
 *
 *   title / unit   header line and the small "per m³" caption     foot   the line under the display (where the number goes)
 *   decimals       0 hides the decimal key                          onReset  optional "Restablecer" button
 */
export default function NumberPad({ title, unit = '', value, decimals = 2, max = null, foot = '', onChange, onReset = null, onClose, testId = 'price-numpad' }) {
  const { t, locale } = useI18n();
  const [state, dispatch] = useReducer(padReduce, undefined, () => padInit(value, decimals));
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';

  const press = (action) => {
    const next = padReduce(state, action);
    if (next === state) return;
    const v = padValue(next);
    if (max !== null && v !== null && v > max) return; // that digit would go over the limit: ignored
    dispatch(action);
    if (v !== null) onChange(v);
  };

  const key = (k) => {
    const label = k === 'dot' ? decimal : k === 'back' ? '⌫' : k;
    const action = k === 'dot' ? { type: 'dot' } : k === 'back' ? { type: 'back' } : { type: 'digit', digit: k };
    return (
      <button
        key={k}
        type="button"
        onClick={() => press(action)}
        disabled={k === 'dot' && decimals === 0}
        aria-label={k === 'back' ? t('ws.pad.backspace') : label}
        data-testid={`pad-${k}`}
        className="flex min-h-[60px] items-center justify-center rounded-xl border border-white/15 text-2xl font-bold text-[#E0E0E0] transition active:scale-95 active:border-white/50 disabled:opacity-30"
      >
        {label}
      </button>
    );
  };

  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center" data-testid={testId}>
      <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 cursor-default bg-black/60" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative w-full max-w-lg rounded-t-3xl border border-b-0 border-white/10 bg-black px-4 pt-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 flex-1 truncate text-sm font-bold text-[#E0E0E0]/80">{title}</p>
          <p className="text-xs text-[#E0E0E0]/60">{unit}</p>
        </div>
        <p data-testid="pad-display" data-value={state.text} className="my-2 truncate text-right text-5xl font-black tabular-nums text-[#E0E0E0]" aria-live="polite">
          {padDisplay(state, locale)}
        </p>
        <p className="mb-3 min-h-[1rem] text-right text-xs text-[#E0E0E0]/60">{foot}</p>
        <div className="grid grid-cols-3 gap-2">{KEYS.map(key)}</div>
        <div className={`mt-2 grid gap-2 ${onReset ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {onReset && (
            <button type="button" onClick={onReset} data-testid="pad-reset" className="min-h-[52px] rounded-xl border border-white/15 px-3 text-sm font-bold text-[#E0E0E0]/80 active:border-white/50">
              {t('ws.pad.reset')}
            </button>
          )}
          <button type="button" onClick={onClose} data-testid="pad-done" className="min-h-[52px] rounded-xl border-2 border-brand px-3 text-base font-extrabold text-brand active:scale-[0.98]">
            {t('ws.pad.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
