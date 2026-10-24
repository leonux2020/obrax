// The PRICE BOOK ("Libro Maestro Híbrido"): the prices known for ONE region, in that region's currency, in two layers.
//   user layer  `user`      the last value the USER typed on this device for a material (per SALE unit) or a machine
//                           (per day). It is the user's own truth: it always wins and nothing overwrites it.
//   AI layer    `materials` / `rent`   the latest estimate of the price service (AI through the server proxy, see
//                           priceFeed.js), validated against a sanity band. Used when the user has no price of their own.
// With neither layer the quote falls back to the built-in simulation. The whole book lives in IndexedDB (last known
// value) and a signed / frozen quote keeps a copy of it. Pure functions only (shared with the server proxy).

import { CATALOG } from './catalog.js';
import { MACHINES, MACHINE_IDS } from './machines.js';
import { getRegion } from './regions.js';

/** A value must stay within this band around the built-in reference, otherwise it is a model slip and is ignored. */
export const PRICE_BAND = Object.freeze({ min: 0.3, max: 3.5 });
/** How long a fetched book is considered fresh (the proxy is not asked again before this). */
export const BOOK_TTL_MS = 6 * 60 * 60 * 1000;

/** Upper bound of a price typed by the user (same as the manual per-project overrides). */
export const MAX_USER_PRICE = 1_000_000_000;

const neutral = (usd, region) => usd * region.fx * region.priceFactor;
const round = (n, region) => {
  const f = 10 ** region.digits;
  const v = Math.round(n * f) / f;
  return v > 0 ? v : 10 ** -region.digits;
};

/** Built-in reference ranges (sale unit / day) used for the sanity band. */
export const materialBand = (id, region) => {
  const ref = neutral(CATALOG[id].usd, region);
  return { min: ref * PRICE_BAND.min, max: ref * PRICE_BAND.max };
};
export const rentBand = (id, region) => {
  const ref = neutral(MACHINES[id].usd, region);
  return { min: ref * PRICE_BAND.min, max: ref * PRICE_BAND.max };
};

function cleanMap(src, region, has, bandOf) {
  const pairs = Array.isArray(src) ? src.map((e) => [e?.id, e?.price]) : src && typeof src === 'object' ? Object.entries(src) : [];
  const out = {};
  for (const [id, raw] of pairs) {
    if (typeof id !== 'string' || !has(id)) continue;
    const price = Number(raw);
    if (!Number.isFinite(price) || price <= 0) continue;
    const { min, max } = bandOf(id, region);
    if (price < min || price > max) continue; // outside the sanity band: dropped, the previous / simulated value stays
    out[id] = round(price, region);
  }
  return out;
}

/** The user layer: any positive number up to MAX_USER_PRICE for a known id (no sanity band: it is the user's decision). */
function cleanUser(raw, region) {
  const one = (src, has) => {
    const out = {};
    if (!src || typeof src !== 'object') return out;
    for (const [id, v] of Object.entries(src)) {
      const price = Number(v);
      if (!has(id) || !Number.isFinite(price) || price <= 0 || price > MAX_USER_PRICE) continue;
      out[id] = round(price, region);
    }
    return out;
  };
  const materials = one(raw?.materials, (id) => Object.prototype.hasOwnProperty.call(CATALOG, id));
  const rent = one(raw?.rent, (id) => MACHINE_IDS.includes(id));
  if (!Object.keys(materials).length && !Object.keys(rent).length) return null;
  const at = Number(raw?.at);
  return { materials, rent, at: Number.isFinite(at) && at > 0 ? at : 0 };
}

/**
 * Validate an untrusted book (server answer, IndexedDB row, a frozen quote). Unknown ids, non-positive numbers and
 * out-of-band prices are dropped one by one. Returns { region, at, materials, rent } or null when nothing usable remains.
 * `materials` / `rent` may be plain maps or arrays of {id, price}. The optional `user` layer is validated separately
 * (and survives alone: a device that only has the user's own prices still has a book).
 */
export function normalizeBook(raw, regionCode) {
  if (!raw || typeof raw !== 'object') return null;
  const region = getRegion(regionCode);
  if (!region) return null;
  if (raw.region && raw.region !== region.code) return null;
  const materials = cleanMap(raw.materials, region, (id) => Object.prototype.hasOwnProperty.call(CATALOG, id), materialBand);
  const rent = cleanMap(raw.rent, region, (id) => MACHINE_IDS.includes(id), rentBand);
  const user = cleanUser(raw.user, region);
  if (!Object.keys(materials).length && !Object.keys(rent).length && !user) return null;
  const at = Number(raw.at);
  return { region: region.code, at: Number.isFinite(at) && at > 0 ? at : 0, materials, rent, ...(user ? { user } : {}) };
}

/** Does the book hold any AI-estimated price (as opposed to only the user's own prices)? */
export const hasAiPrices = (book) => Boolean(book && (Object.keys(book.materials || {}).length || Object.keys(book.rent || {}).length));

/**
 * The same book with ONE user price set (price > 0) or removed (null / 0). `kind` is 'materials' | 'rent'.
 * Pure: returns a new book, or null when nothing is left (no AI prices, no user prices). Never touches the AI layer.
 */
export function withUserPrice(book, regionCode, kind, id, price, now = Date.now()) {
  const region = getRegion(regionCode);
  if (!region || (kind !== 'materials' && kind !== 'rent')) return book || null;
  const base = book && book.region === region.code ? book : { region: region.code, at: 0, materials: {}, rent: {} };
  const user = { materials: { ...(base.user?.materials || {}) }, rent: { ...(base.user?.rent || {}) }, at: now };
  if (typeof price === 'number' && price > 0) user[kind][id] = price;
  else delete user[kind][id];
  return normalizeBook({ ...base, user }, region.code);
}

/** New values win; whatever the new answer does not contain keeps the LAST KNOWN value ("product not found"). */
export function mergeBooks(prev, next) {
  if (!next) return prev || null;
  if (!prev || prev.region !== next.region) return next;
  const user = prev.user || next.user ? { materials: { ...prev.user?.materials, ...next.user?.materials }, rent: { ...prev.user?.rent, ...next.user?.rent }, at: Math.max(prev.user?.at || 0, next.user?.at || 0) } : null;
  return { region: next.region, at: next.at || prev.at, materials: { ...prev.materials, ...next.materials }, rent: { ...prev.rent, ...next.rent }, ...(user ? { user } : {}) };
}

/** The price the USER saved on this device for a material (per sale unit) or undefined. Priority 1. */
export const savedMaterial = (book, regionCode, id) => (book && book.region === regionCode ? book.user?.materials?.[id] : undefined);
/** The daily rental the USER saved for a machine or undefined. Priority 1. */
export const savedRent = (book, regionCode, id) => (book && book.region === regionCode ? book.user?.rent?.[id] : undefined);

/** Live (AI) price of one material (per sale unit, neutral chain) or undefined. Priority 2. */
export const liveMaterial = (book, regionCode, id) => (book && book.region === regionCode ? book.materials?.[id] : undefined);
/** Live daily rental of one machine or undefined. */
export const liveRent = (book, regionCode, id) => (book && book.region === regionCode ? book.rent?.[id] : undefined);

/**
 * Which book prices a draft? A SIGNED or FROZEN quote keeps the book it was frozen with (or none, for quotes frozen
 * before live prices existed: those stay on the simulation they were agreed on); every other quote follows the live book.
 */
export function effectiveBook(draft, live) {
  const lock = draft?.signature || draft?.frozen;
  return lock ? lock.book ?? null : live ?? null;
}
