// The PRICE BOOK: the latest known market price of every catalog material (per SALE unit) and of the daily rental of
// every machine, for ONE region, in that region's currency. It comes from the price service (AI estimate through the
// server proxy, see priceFeed.js), is kept in IndexedDB as the last known value, and is what the quote engine uses
// instead of the built-in simulation whenever it has a value. Pure functions only (shared with the server proxy).

import { CATALOG } from './catalog.js';
import { MACHINES, MACHINE_IDS } from './machines.js';
import { getRegion } from './regions.js';

/** A value must stay within this band around the built-in reference, otherwise it is a model slip and is ignored. */
export const PRICE_BAND = Object.freeze({ min: 0.3, max: 3.5 });
/** How long a fetched book is considered fresh (the proxy is not asked again before this). */
export const BOOK_TTL_MS = 6 * 60 * 60 * 1000;

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

/**
 * Validate an untrusted book (server answer, IndexedDB row, a frozen quote). Unknown ids, non-positive numbers and
 * out-of-band prices are dropped one by one. Returns { region, at, materials, rent } or null when nothing usable remains.
 * `materials` / `rent` may be plain maps or arrays of {id, price}.
 */
export function normalizeBook(raw, regionCode) {
  if (!raw || typeof raw !== 'object') return null;
  const region = getRegion(regionCode);
  if (!region) return null;
  if (raw.region && raw.region !== region.code) return null;
  const materials = cleanMap(raw.materials, region, (id) => Object.prototype.hasOwnProperty.call(CATALOG, id), materialBand);
  const rent = cleanMap(raw.rent, region, (id) => MACHINE_IDS.includes(id), rentBand);
  if (!Object.keys(materials).length && !Object.keys(rent).length) return null;
  const at = Number(raw.at);
  return { region: region.code, at: Number.isFinite(at) && at > 0 ? at : 0, materials, rent };
}

/** New values win; whatever the new answer does not contain keeps the LAST KNOWN value ("product not found"). */
export function mergeBooks(prev, next) {
  if (!next) return prev || null;
  if (!prev || prev.region !== next.region) return next;
  return { region: next.region, at: next.at || prev.at, materials: { ...prev.materials, ...next.materials }, rent: { ...prev.rent, ...next.rent } };
}

/** Live price of one material (per sale unit, neutral chain) or undefined. */
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
