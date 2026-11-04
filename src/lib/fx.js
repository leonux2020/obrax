// FX snapshot: the "immutable base currency" of a project.
//
// A project works in ONE base currency (the one of its market). Every total (budget, "Monto da incassare", expenses, liquidity) is computed in it
// and ONLY in it. A receipt printed in another currency (an EUR ticket inside a CLP job) is converted ONCE, when it enters the project, with the
// rate of that moment, and the expense record freezes what happened:
//
//   amountOriginal    what the paper says                      (50.00)
//   currencyOriginal  its currency                             ('EUR')
//   exchangeRate      base units per 1 original unit           (1052.3)
//   amountBase        the value in the base currency, frozen   (52615)   <- the number every sum uses
//   (amount === amountBase: the plain `amount` field IS the base value, so nothing that adds `amount` can ever mix currencies)
//   fxSource / fxAt   where the rate came from ('api' | 'cache' | 'static' | 'manual') and when
//
// The rate comes from a light free API in the background (open.er-api.com, no key); with no network the last known rate is used, then the table of
// reference rates every market of the app already carries, and the user can always type the rate by hand. A later change of the market never
// rewrites a stored expense: the snapshot is the truth.

import { REGIONS } from './regions.js';

export const FX_URL = 'https://open.er-api.com/v6/latest/';
export const FX_SOURCES = Object.freeze(['api', 'cache', 'static', 'manual']);
export const FX_TIMEOUT_MS = 6000;
export const FX_FRESH_MS = 6 * 3_600_000; // a rate this young is reused (one lookup per currency pair per few hours)
export const FX_STALE_MS = 45 * 86_400_000; // the last known rate is still better than a table after this long
export const FX_CACHE_KEY = 'cp.fx.v1';
const MAX_CACHE = 40;

const ISO = /^[A-Za-z]{3}$/;
export const isoOf = (v) => (typeof v === 'string' && ISO.test(v.trim()) ? v.trim().toUpperCase() : '');

/** The value every total uses for a record: the frozen base amount when it has one, else its plain amount. Never NaN. */
export const baseOf = (x) => {
  const raw = x && x.amountBase !== undefined && x.amountBase !== null ? x.amountBase : x?.amount;
  const n = typeof raw === 'string' ? Number(raw.trim().replace(',', '.')) : Number(raw);
  if (Number.isFinite(n)) return n;
  const f = typeof raw === 'string' ? parseFloat(raw.replace(',', '.')) : NaN; // "12abc" still counts as 12 (like toAmount)
  return Number.isFinite(f) ? f : 0;
};

// ---- reference table (local units per USD, from the markets' own data) ------------------------------------------------------------------
const perUsd = new Map();
const digitsOfCurrency = new Map();
for (const r of Object.values(REGIONS)) {
  if (!perUsd.has(r.currency)) perUsd.set(r.currency, r.fx);
  if (!digitsOfCurrency.has(r.currency)) digitsOfCurrency.set(r.currency, r.digits);
}

/** Decimals of a currency (CLP 0, EUR 2). */
export const digitsFor = (currency) => digitsOfCurrency.get(isoOf(currency)) ?? 2;

/** Approximate rate from the reference table: base units per 1 `from`, or null for a currency the app does not know. */
export function staticRate(from, to) {
  const a = perUsd.get(isoOf(from));
  const b = perUsd.get(isoOf(to));
  return a > 0 && b > 0 ? b / a : null;
}

const cleanRate = (v) => {
  const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
  return Number.isFinite(n) && n > 0 && n <= 1e9 ? Math.round(n * 1e8) / 1e8 : null;
};
export const normalizeRate = cleanRate;

// ---- cache --------------------------------------------------------------------------------------------------------------------------------
function defaultStore() {
  const ls = typeof globalThis !== 'undefined' ? globalThis.localStorage : null;
  return {
    read() {
      try {
        const raw = ls?.getItem(FX_CACHE_KEY);
        const obj = raw && raw.length < 20_000 ? JSON.parse(raw) : null;
        return obj && typeof obj === 'object' ? obj : {};
      } catch {
        return {};
      }
    },
    write(obj) {
      try {
        ls?.setItem(FX_CACHE_KEY, JSON.stringify(obj));
      } catch {
        /* storage full / blocked: the rate still serves this session */
      }
    },
  };
}

function remember(store, from, to, rate, at) {
  const all = store.read();
  all[`${from}>${to}`] = { rate, at };
  const keep = Object.entries(all).sort((x, y) => (y[1]?.at || 0) - (x[1]?.at || 0)).slice(0, MAX_CACHE);
  store.write(Object.fromEntries(keep));
}

// ---- the rate ----------------------------------------------------------------------------------------------------------------------------
/** Ask the service for 1 `from` in `to` (one lookup answers every currency of that base). Throws on any failure. */
export async function fetchRate(from, to, { fetchImpl = globalThis.fetch, timeoutMs = FX_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('no_fetch');
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${FX_URL}${from}`, { signal: ctl?.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res || !res.ok) throw new Error('http');
    const body = await res.json();
    if (body && body.result && body.result !== 'success') throw new Error('service');
    const rate = cleanRate(body?.rates?.[to]);
    if (rate === null) throw new Error('no_rate');
    return rate;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The rate to freeze for 1 `from` in `to`: { rate, source, at } or null (unknown currency and no rate at all).
 * Order: a fresh cached rate -> the service (background, with a short timeout) -> the last known rate -> the reference table.
 * `source` 'api' / 'cache' are real market rates; 'static' is an approximation the user should be able to correct.
 */
export async function resolveRate(from, to, { fetchImpl = globalThis.fetch, now = Date.now(), store = defaultStore(), online = typeof navigator === 'undefined' || navigator.onLine !== false, timeoutMs = FX_TIMEOUT_MS } = {}) {
  const a = isoOf(from);
  const b = isoOf(to);
  if (!a || !b) return null;
  if (a === b) return { rate: 1, source: 'cache', at: now };
  const hit = store.read()[`${a}>${b}`];
  const cached = hit && cleanRate(hit.rate) !== null ? { rate: cleanRate(hit.rate), at: Number(hit.at) || 0 } : null;
  if (cached && now - cached.at < FX_FRESH_MS) return { rate: cached.rate, source: 'cache', at: cached.at };
  if (online && typeof fetchImpl === 'function') {
    try {
      const rate = await fetchRate(a, b, { fetchImpl, timeoutMs });
      remember(store, a, b, rate, now);
      return { rate, source: 'api', at: now };
    } catch {
      /* offline / blocked / the service is down: the next sources */
    }
  }
  if (cached && now - cached.at < FX_STALE_MS) return { rate: cached.rate, source: 'cache', at: cached.at };
  const approx = staticRate(a, b);
  return approx === null ? null : { rate: cleanRate(approx), source: 'static', at: now };
}

// ---- freezing ---------------------------------------------------------------------------------------------------------------------------
const roundTo = (n, digits) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Does this expense still need converting to `base`? (printed in another currency, not frozen yet) */
export const needsFx = (e, base) => {
  const cur = isoOf(e?.currency);
  return Boolean(cur) && Boolean(isoOf(base)) && cur !== isoOf(base) && !e.currencyOriginal;
};

/** Freeze ONE expense: its amount (and the net / tax / unit price of the line) become base-currency values, the original stays beside them. */
export function freezeExpense(e, { base, digits = digitsFor(base), rate, source = 'manual', at = Date.now() }) {
  const r = cleanRate(rate);
  const original = Number(e.amount);
  if (r === null || !Number.isFinite(original) || original === 0) return e;
  const conv = (v) => roundTo(Number(v) * r, digits);
  // a non-zero amount never rounds to nothing (it would be dropped as "not an amount")
  const amountBase = conv(original) === 0 ? Math.sign(original) * 10 ** -digits : conv(original);
  const out = {
    ...e,
    currency: isoOf(base),
    currencyOriginal: isoOf(e.currency),
    amountOriginal: original,
    exchangeRate: r,
    amountBase,
    amount: amountBase,
    fxSource: FX_SOURCES.includes(source) ? source : 'manual',
    fxAt: Number.isFinite(Number(at)) && Number(at) > 0 ? Number(at) : Date.now(),
  };
  for (const k of ['unitPrice', 'netAmount', 'taxAmount']) if (typeof e[k] === 'number') out[k] = conv(e[k]);
  return out;
}

/**
 * Freeze every foreign expense with the rates given ({ EUR: { rate, source, at } }). Expenses with no rate for their currency come back
 * untouched and their currency is listed in `missing`.
 */
export function applyRates(expenses, { base, digits = digitsFor(base), rates = {}, now = Date.now() }) {
  const missing = new Set();
  const out = (Array.isArray(expenses) ? expenses : []).map((e) => {
    if (!needsFx(e, base)) return e;
    const cur = isoOf(e.currency);
    const r = rates[cur];
    if (!r || cleanRate(r.rate) === null) {
      missing.add(cur);
      return e;
    }
    return freezeExpense(e, { base, digits, rate: r.rate, source: r.source, at: r.at ?? now });
  });
  return { expenses: out, missing: [...missing] };
}

/** The foreign currencies of a list of expenses (printed in another currency than `base`, not frozen yet). */
export const foreignCurrencies = (expenses, base) => [...new Set((Array.isArray(expenses) ? expenses : []).filter((e) => needsFx(e, base)).map((e) => isoOf(e.currency)))];

/**
 * Resolve the rate of every foreign currency of the list and freeze the expenses (the background path: no user in front).
 * @returns {{ expenses, missing: string[], approximate: string[] }} `approximate`: currencies that only got the reference-table rate.
 */
export async function convertToBase(expenses, { base, digits = digitsFor(base), resolve = resolveRate, now = Date.now(), ...opts } = {}) {
  const rates = {};
  for (const cur of foreignCurrencies(expenses, base)) {
    const r = await resolve(cur, base, { now, ...opts });
    if (r) rates[cur] = r;
  }
  const { expenses: converted, missing } = applyRates(expenses, { base, digits, rates, now });
  return { expenses: converted, missing, approximate: Object.entries(rates).filter(([, r]) => r.source === 'static').map(([c]) => c) };
}
