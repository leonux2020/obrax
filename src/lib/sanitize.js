// Strict input sanitization. Everything coming from a text box, localStorage, or a token
// goes through here before it reaches the calculation engine or the DOM.

const MAX_NUMERIC_CHARS = 12;

/**
 * Keep only digits and a single decimal separator. Accepts "," or "." as decimal mark.
 * NFKC normalisation turns full-width / exotic digits into ASCII before filtering.
 */
export function sanitizeNumericText(raw, decimals = 2) {
  let s = String(raw ?? '').normalize('NFKC').replace(/,/g, '.');
  s = s.replace(/[^0-9.]/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    const intPart = s.slice(0, firstDot);
    const frac = s.slice(firstDot + 1).replace(/\./g, '');
    s = decimals > 0 ? `${intPart}.${frac.slice(0, decimals)}` : intPart;
  }
  return s.slice(0, MAX_NUMERIC_CHARS);
}

/** Parse sanitized text; returns null for empty / incomplete / non-finite input. */
export function parseDecimal(text) {
  const s = String(text ?? '');
  if (s === '' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Coerce any unknown value into a finite number within [min,max] or return fallback. */
export function coerceNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER, decimals = 2, fallback = null } = {}) {
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string') n = parseDecimal(sanitizeNumericText(value, decimals));
  else n = null;
  if (n === null || !Number.isFinite(n) || n < min || n > max) return fallback;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Free text (project / client names). Strips markup, control chars and collapses whitespace. */
export function sanitizeText(raw, maxLen = 80) {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g, ' ')
    .replace(/[<>`\\{}[\]$|^~]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, maxLen);
}

export function sanitizeEmail(raw) {
  const s = String(raw ?? '').normalize('NFKC').trim().toLowerCase().slice(0, 120);
  return /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,63}\.[a-z]{2,24}$/.test(s) ? s : '';
}

/** Only https images hosted by Google are allowed as avatar. */
export function sanitizeAvatarUrl(raw) {
  try {
    const u = new URL(String(raw ?? ''));
    if (u.protocol === 'https:' && /(^|\.)googleusercontent\.com$/.test(u.hostname)) return u.href;
  } catch {
    /* ignore */
  }
  return '';
}

export function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}
