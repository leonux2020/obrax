// Local price service client ("motor de precios locales").
//
//   1. ask OUR proxy (/api/extract-invoice, kind 'prices') for fresh material prices and machine rentals of the region
//      (an AI estimate: the proxy has no live shop feed; every value is validated against a sanity band);
//   2. whatever the answer contains replaces the stored value; whatever it LACKS (product not found / out of band)
//      keeps its last known value, which lives in IndexedDB (priceStore.js);
//   3. if the service cannot be reached at all (offline, no key, rate limit, timeout...) the last known book is used;
//      with no book at all the quote falls back to the built-in simulated reference prices.
// The quote engine reads the result from priceRegistry.js; a signed / frozen quote keeps its own copy (priceBook.js).

import { INVOICE_ENDPOINT } from './invoice.js';
import { BOOK_TTL_MS, mergeBooks, normalizeBook } from './priceBook.js';
import { currentBook, currentStatus, publish } from './priceRegistry.js';
import { priceStore } from './priceStore.js';

export const PRICES_TIMEOUT_MS = 20_000;

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
      if (book) publish(regionCode, { book, state: 'cached' });
    }
    if (book && !force && now - book.at < BOOK_TTL_MS) {
      publish(regionCode, { state: 'fresh', at: book.at }); // fetched recently (maybe in a previous session): do not ask again
      return 'fresh';
    }
    const fallback = (reason) => {
      const state = book ? 'cached' : 'sim';
      publish(regionCode, { state, at: book?.at ?? 0, reason });
      return state;
    };
    if (!online()) return fallback('offline');
    publish(regionCode, { state: 'loading', at: book?.at ?? 0 });
    try {
      const fresh = await requestPriceBook(regionCode, { fetchImpl, now });
      const merged = mergeBooks(book, fresh);
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
