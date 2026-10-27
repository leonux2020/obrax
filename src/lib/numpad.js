// On-screen numeric pad state (pure). The app shows its OWN pad for prices instead of the OS keyboard: big keys under the
// thumb, no layout jump, no autocorrect, no decimal-comma surprises. The text is always machine format ("1234.5");
// the visible separator is applied by the component with the region's locale.

import { MAX_PRICE } from './pricing.js';

const MAX_INT_DIGITS = 10;

/** Start the pad on the current value. The first digit typed REPLACES it (`fresh`), like a calculator. */
export function padInit(value, decimals = 2) {
  const d = Math.max(0, Math.min(4, Math.round(decimals)));
  const text = typeof value === 'number' && Number.isFinite(value) && value > 0 ? String(Number(value.toFixed(d))) : '';
  return { text, decimals: d, fresh: text !== '' };
}

export function padReduce(state, action) {
  const { text, decimals } = state;
  const base = state.fresh && (action.type === 'digit' || action.type === 'dot') ? '' : text;
  switch (action.type) {
    case 'digit': {
      if (!/^\d$/.test(action.digit)) return state;
      const [int, frac] = base.split('.');
      if (frac !== undefined) return frac.length >= decimals ? { ...state, fresh: false } : { ...state, text: `${base}${action.digit}`, fresh: false };
      if (int === '0') return { ...state, text: action.digit, fresh: false }; // no leading zeros
      return int.length >= MAX_INT_DIGITS ? { ...state, fresh: false } : { ...state, text: `${base}${action.digit}`, fresh: false };
    }
    case 'dot':
      if (decimals === 0 || base.includes('.')) return { ...state, text: base, fresh: false };
      return { ...state, text: `${base || '0'}.`, fresh: false };
    case 'back':
      return { ...state, text: text.slice(0, -1), fresh: false };
    case 'clear':
      return { ...state, text: '', fresh: false };
    default:
      return state;
  }
}

/** The typed value, or null while it is empty / zero / out of range (nothing is applied in that case). */
export function padValue(state) {
  const n = Number(state.text);
  return Number.isFinite(n) && n > 0 && n <= MAX_PRICE ? n : null;
}

/** Text to show in the display, with the region's decimal separator and thousands grouping on the integer part. */
export function padDisplay(state, locale = 'en') {
  if (!state.text) return '0';
  const [int, frac] = state.text.split('.');
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
  const dec = parts.find((p) => p.type === 'decimal')?.value ?? '.';
  const shown = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(int || 0));
  return frac === undefined ? shown : `${shown}${dec}${frac}`;
}
