// "Radar de Mercado": prices the user saved WITH a supplier and a place. Pure functions (no storage, no React).
//
// One entry = one price of one material (per sale unit) or machine (per day) at one supplier near one point:
//   { id, region, kind: 'materials'|'rent', itemId, price, supplierName, lat, lng, at }
// For a project located at P the quote reads, per item, in this order:
//   project override  >  the NEAREST entry within 50 km of P (this file)  >  the user's last typed price of the device
//   >  live AI  >  bundled base catalog.
// A supplier of another city (further than the radius) never prices this project. The AI is not even asked for what a
// nearby entry already covers (see coveredIds / priceFeed.js).

import { CATALOG } from './catalog.js';
import { MACHINE_IDS } from './machines.js';
import { getRegion } from './regions.js';
import { SUPPLIER_RADIUS_KM, haversineKm, normalizeCoords } from './geoDistance.js';
import { MAX_USER_PRICE } from './priceBook.js';
import { sanitizeText } from './sanitize.js';

export const MAX_SUPPLIER_ENTRIES = 600; // per region: the oldest go first
export const SUPPLIER_KINDS = Object.freeze(['materials', 'rent']);

const knownItem = (kind, id) => (kind === 'materials' ? Object.prototype.hasOwnProperty.call(CATALOG, id) : kind === 'rent' && MACHINE_IDS.includes(id));
const slug = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export const cleanSupplierName = (name) => sanitizeText(name, 60).trim();

/** Stable id: the same supplier in the same ~10 km cell updates its price instead of piling up copies. */
export function supplierEntryId({ region, kind, itemId, supplierName = '', lat = null, lng = null }) {
  const c = normalizeCoords({ lat, lng });
  return [region, kind, itemId, slug(supplierName) || '_', c ? `${c.lat.toFixed(1)},${c.lng.toFixed(1)}` : 'x'].join('|');
}

/** Validate an untrusted stored entry. Returns a clean entry or null. */
export function normalizeSupplierEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const region = getRegion(raw.region);
  if (!region || !SUPPLIER_KINDS.includes(raw.kind) || !knownItem(raw.kind, raw.itemId)) return null;
  const price = Number(raw.price);
  if (!Number.isFinite(price) || price <= 0 || price > MAX_USER_PRICE) return null;
  const c = normalizeCoords(raw);
  const at = Number(raw.at);
  const entry = { region: region.code, kind: raw.kind, itemId: raw.itemId, price, supplierName: cleanSupplierName(raw.supplierName), lat: c ? c.lat : null, lng: c ? c.lng : null, at: Number.isFinite(at) && at > 0 ? at : 0 };
  return { id: supplierEntryId(entry), ...entry };
}

/** Add or replace an entry (same id), keep the list bounded (newest kept). Pure. */
export function upsertEntry(entries, entry) {
  const next = [...entries.filter((e) => e.id !== entry.id), entry];
  return next.length > MAX_SUPPLIER_ENTRIES ? next.sort((a, b) => b.at - a.at).slice(0, MAX_SUPPLIER_ENTRIES) : next;
}

/**
 * The entry that prices every item of every kind: among those within `radiusKm` (inclusive) the MOST RECENT one (the
 * user's latest decision: a price typed today beats one from last month), the nearer one on a tie. Entries without
 * coordinates never match.
 * @returns {{materials: Record<string, object>, rent: Record<string, object>}} entry + `distanceKm`
 */
export function nearbyLayer(entries, location, radiusKm = SUPPLIER_RADIUS_KM) {
  const out = { materials: {}, rent: {} };
  const here = normalizeCoords(location);
  if (!here) return out;
  for (const e of entries || []) {
    if (e.lat === null || e.lng === null) continue;
    const km = haversineKm(here, e);
    if (km > radiusKm) continue;
    const best = out[e.kind][e.itemId];
    if (!best || e.at > best.at || (e.at === best.at && km < best.distanceKm)) out[e.kind][e.itemId] = { ...e, distanceKm: km };
  }
  return out;
}

/**
 * The book a PROJECT is priced with: the region's book where the nearby entries take the place of the user layer
 * (priority 1), each with its supplier meta (`nearby: true`, `distanceKm`). The AI layer is untouched (it is simply
 * outranked). A user price tied to a supplier OUTSIDE the radius is left out (the AI / base prices it instead). Returns the SAME book object when nothing is nearby, so memoised quotes stay memoised.
 */
export function applyNearby(book, regionCode, entries, location, radiusKm = SUPPLIER_RADIUS_KM) {
  const here = normalizeCoords(location);
  if (!here) return book ?? null;
  const layer = nearbyLayer((entries || []).filter((e) => e.region === regionCode), here, radiusKm);
  const base = book && book.region === regionCode ? book : { region: regionCode, at: 0, materials: {}, rent: {} };
  const user = { materials: { ...(base.user?.materials || {}) }, rent: { ...(base.user?.rent || {}) }, meta: { materials: { ...(base.user?.meta?.materials || {}) }, rent: { ...(base.user?.meta?.rent || {}) } }, at: base.user?.at || 0 };
  let changed = false;
  for (const kind of SUPPLIER_KINDS) {
    // a price the user saved at a supplier of ANOTHER city (outside the radius) is that city's, not this project's
    for (const [id, m] of Object.entries(user.meta[kind])) {
      if (layer[kind][id] || m.lat === undefined || m.lng === undefined || haversineKm(here, m) <= radiusKm) continue;
      delete user[kind][id];
      delete user.meta[kind][id];
      changed = true;
    }
    for (const [id, e] of Object.entries(layer[kind])) {
      user[kind][id] = e.price;
      user.meta[kind][id] = { supplierName: e.supplierName, lat: e.lat, lng: e.lng, distanceKm: Math.round(e.distanceKm * 10) / 10, nearby: true };
      changed = true;
    }
  }
  return changed ? { ...base, user } : book ?? null;
}

/**
 * Ids the AI does NOT need to look up: those that EVERY given project location already has a nearby supplier price for
 * and for which the book still holds a last known AI value to fall back on (another project elsewhere is never left
 * without a market price). A project with no location can never benefit, so one of them empties the result.
 */
export function coveredIds(entries, locations, book, radiusKm = SUPPLIER_RADIUS_KM) {
  const locs = (locations || []).map(normalizeCoords);
  if (!locs.length || locs.some((l) => !l)) return { materials: [], rent: [] };
  const layers = locs.map((l) => nearbyLayer(entries, l, radiusKm));
  const pick = (kind) => Object.keys(layers[0][kind]).filter((id) => layers.every((l) => l[kind][id]) && Number(book?.[kind]?.[id]) > 0);
  return { materials: pick('materials'), rent: pick('rent') };
}

/** Quick supplier labels for the numpad bar: the ones used before (newest first), then the region's retailers. */
export function suggestSuppliers({ regionCode, entries = [], limit = 8 }) {
  const region = getRegion(regionCode);
  const seen = new Set();
  const out = [];
  const add = (name) => {
    const clean = cleanSupplierName(name);
    const key = slug(clean);
    if (!clean || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };
  [...entries].filter((e) => e.region === regionCode && e.supplierName).sort((a, b) => b.at - a.at).forEach((e) => add(e.supplierName));
  (region?.chains || []).forEach((c) => add(c.name));
  return out.slice(0, limit);
}

/** The retailer the live AI estimate is attributed to on screen ("Estimación IA (Sodimac)"): the region's first chain. */
export const aiRetailer = (regionCode) => getRegion(regionCode)?.chains?.[0]?.name ?? '';
