// Price service client of the "Libro Maestro Híbrido". Where a price comes from, in strict order of priority:
//
//   1. USER      the last value the user typed on this device (priceBook `user` layer, saved to IndexedDB by
//                saveUserPrice below). It is never overwritten by the service and needs no network at all;
//   2. LIVE AI   our proxy (/api/extract-invoice, kind 'prices') searches current retail prices of the region.
//                It is asked for every product, but its answer is only used where the user has no price of their own;
//                whatever it LACKS (product not found / out of band) keeps its last known value;
//   3. SIMULATION  if the service cannot be reached at all (offline, no key, rate limit, timeout...) and nothing is
//                stored, the quote falls back to the built-in simulated reference prices.
// The quote engine reads the result from priceRegistry.js; a signed / frozen quote keeps its own copy (priceBook.js).

import { INVOICE_ENDPOINT } from './invoice.js';
import { BOOK_TTL_MS, hasAiPrices, mergeBooks, normalizeBook, withUserPrice } from './priceBook.js';
import { currentBook, currentStatus, publish } from './priceRegistry.js';
import { priceStore } from './priceStore.js';

export const PRICES_TIMEOUT_MS = 55_000; // a grounded (web search) answer takes longer than a plain estimate

// The automatic refresh is off in the test runner (no unexpected network); tests that need it switch it on.
let enabled = import.meta.env.MODE !== 'test';
export const setPriceFeedEnabled = (on) => {
  enabled = Boolean(on);
};
export const priceFeedEnabled = () => enabled;

/** One request to the proxy. Resolves to a validated book or throws (the caller decides the fallback). */
export async function requestPriceBook(regionCode, { fetchImpl = globalThis.fetch, endpoint = INVOICE_ENDPOINT, timeoutMs = PRICES_TIMEOUT_MS, now = Date.now() } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'prices', region: regionCode }),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctl.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.ok !== true) throw new Error(`prices:${body?.error || res.status}`);
    const book = normalizeBook({ ...body.book, region: regionCode, at: now }, regionCode);
    if (!book) throw new Error('prices:empty');
    return book;
  } finally {
    clearTimeout(timer);
  }
}

/** Short diagnostic code of a failed request ('not_configured' = the proxy has no AI key, 'timeout', 'upstream', 'network'...). */
export function failureReason(err) {
  const m = /^prices:(.+)$/.exec(err?.message || '');
  if (m) return /^\d+$/.test(m[1]) ? `http_${m[1]}` : m[1];
  return err?.name === 'AbortError' ? 'timeout' : 'network';
}

const inflight = new Map();

/**
 * Make the registry hold the best available book of a region.
 * @returns {Promise<'fresh'|'cached'|'sim'|'idle'>} the resulting state (also published for the UI)
 */
export function refreshPrices(regionCode, opts = {}) {
  const { force = false, fetchImpl, store = priceStore, now = Date.now(), online = () => typeof navigator === 'undefined' || navigator.onLine !== false } = opts;
  if (!regionCode) return Promise.resolve('idle');
  if (!enabled && !fetchImpl) return Promise.resolve(currentStatus(regionCode).state);
  if (inflight.has(regionCode)) return inflight.get(regionCode);

  const job = (async () => {
    let book = currentBook(regionCode);
    if (!book) {
      book = await store.load(regionCode); // last value recorded on this device
      if (book) publish(regionCode, { book, state: hasAiPrices(book) ? 'cached' : 'sim' });
    }
    if (hasAiPrices(book) && !force && now - book.at < BOOK_TTL_MS) {
      publish(regionCode, { state: 'fresh', at: book.at }); // fetched recently (maybe in a previous session): do not ask again
      return 'fresh';
    }
    const fallback = (reason) => {
      const state = hasAiPrices(book) ? 'cached' : 'sim'; // only the user's own prices stored = still no market data
      publish(regionCode, { state, at: book?.at ?? 0, reason });
      return state;
    };
    if (!online()) return fallback('offline');
    publish(regionCode, { state: 'loading', at: book?.at ?? 0 });
    try {
      const fresh = await requestPriceBook(regionCode, { fetchImpl, now });
      // merge into the book as it is NOW: the user may have typed a price while the request was in flight
      const merged = mergeBooks(currentBook(regionCode) ?? book, fresh);
      try {
        await store.save(merged);
      } catch {
        /* no storage: the book still serves this session */
      }
      publish(regionCode, { book: merged, state: 'fresh', at: merged.at });
      return 'fresh';
    } catch (err) {
      return fallback(failureReason(err));
    }
  })().finally(() => inflight.delete(regionCode));
  inflight.set(regionCode, job);
  return job;
}

// ---- the user's own prices (Priority 1) -------------------------------------------------------------------------
const pending = new Map(); // regionCode -> { timer, waiters[] }

async function persist(regionCode, store) {
  const book = currentBook(regionCode);
  try {
    if (book) await store.save(book);
    else await store.remove(regionCode);
    return true;
  } catch {
    return false; // no storage at all: the price still serves this session from memory
  }
}

/**
 * The user typed a price: `kind` 'materials' (per SALE unit) or 'rent' (per day); `price` > 0 saves it, null / 0 forgets it.
 * The registry changes IMMEDIATELY (the quote recalculates in real time) and the book is written to IndexedDB a moment
 * later (typing is coalesced into one write per region). From then on this value is the user's standard price on this
 * device: it beats the AI answer and the simulation, survives restarts and works offline.
 * @returns {Promise<boolean>} resolves once the value has been persisted (false when there is no storage)
 */
export async function saveUserPrice(regionCode, kind, id, price, { store = priceStore, now = Date.now(), debounceMs = 400 } = {}) {
  if (!regionCode) return false;
  let base = currentBook(regionCode);
  if (!base) base = await store.load(regionCode); // typed before the stored book was loaded: do not lose the AI layer
  const n = typeof price === 'number' && Number.isFinite(price) ? price : null;
  const next = withUserPrice(base, regionCode, kind, id, n, now);
  publish(regionCode, { book: next }); // null removes it (nothing left); the state line of the price screen is untouched

  return new Promise((resolve) => {
    const entry = pending.get(regionCode) || { timer: null, waiters: [] };
    clearTimeout(entry.timer);
    entry.waiters.push(resolve);
    entry.timer = setTimeout(async () => {
      pending.delete(regionCode);
      const ok = await persist(regionCode, store);
      entry.waiters.forEach((w) => w(ok));
    }, debounceMs);
    pending.set(regionCode, entry);
  });
}

/** Write any price typed in the last moments right now (e.g. when the screen closes). */
export async function flushUserPrices(store = priceStore) {
  const regions = [...pending.keys()];
  await Promise.all(
    regions.map(async (region) => {
      const entry = pending.get(region);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(region);
      const ok = await persist(region, store);
      entry.waiters.forEach((w) => w(ok));
    }),
  );
}

// Closing / hiding the app within the debounce window must not lose the last typed price.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const flushNow = () => {
    if (document.visibilityState === 'hidden' || document.visibilityState === undefined) flushUserPrices();
  };
  document.addEventListener('visibilitychange', flushNow);
  window.addEventListener('pagehide', () => flushUserPrices());
}
