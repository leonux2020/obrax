// BASE CATALOG: the offline price floor. A tiny data module (src/data/baseCatalog.js, ~2 KB) bundled INSIDE the app, so it is
// there with no network, no IndexedDB and no first-run download. Price priority for a material, strictly:
//
//   1. USER      the price typed by the user (this project's override or the saved "Libro Maestro" value)
//   2. LIVE AI   the last market answer of the price service (fresh or cached in IndexedDB)
//   3. BASE      this catalog, scaled to the region (fx x price index): always available, never throws
//   4. none      only for an id that is not in the catalog at all (the UI says "sin precio", it does not crash)
//
// Layers 1-2 are resolved by pricing.js / priceBook.js; this module is layer 3 and the combined lookup used by the UI.

import raw from '../data/baseCatalog.js'; // a .js module on purpose: native Node ESM (Vercel functions) rejects JSON imports without an attribute
import { CATALOG } from './catalog.js';
import { getRegion } from './regions.js';
import { liveMaterial, savedMaterial } from './priceBook.js';

const clean = (obj) => {
  const out = {};
  for (const [id, it] of Object.entries(obj && typeof obj === 'object' ? obj : {})) {
    const usd = Number(it?.usd);
    if (Number.isFinite(usd) && usd > 0 && usd < 1e6) out[id] = Object.freeze({ sale: String(it.sale || ''), size: Number(it.size) > 0 ? Number(it.size) : 1, usd });
  }
  return Object.freeze(out);
};

export const BASE_CATALOG = clean(raw?.items);
export const BASE_CATALOG_VERSION = Number(raw?.version) || 0;

/** Reference USD price of one sale unit. `fallback` (the in-code catalog) covers an id the JSON does not list. */
export const baseUsd = (id, fallback) => BASE_CATALOG[id]?.usd ?? fallback;

/** Regional base price of one sale unit (region currency, neutral chain), or null when the id is unknown. Offline-safe. */
export function basePrice(id, regionCode) {
  const region = getRegion(regionCode);
  const usd = baseUsd(id, CATALOG[id]?.usd);
  if (!region || !(usd > 0)) return null;
  const f = 10 ** region.digits;
  const v = Math.round(usd * region.fx * region.priceFactor * f) / f;
  return v > 0 ? v : 10 ** -region.digits;
}

/**
 * The price of ONE material with the layer it came from, with no network involved.
 * @returns {{price:number, source:'user'|'ai'|'base'}|{price:null, source:'none'}}
 */
export function lookupPrice(id, regionCode, { book = null, override = null } = {}) {
  if (typeof override === 'number' && override > 0) return { price: override, source: 'user' };
  const saved = savedMaterial(book, regionCode, id);
  if (saved > 0) return { price: saved, source: 'user' };
  const live = liveMaterial(book, regionCode, id);
  if (live > 0) return { price: live, source: 'ai' };
  const base = basePrice(id, regionCode);
  return base ? { price: base, source: 'base' } : { price: null, source: 'none' };
}
