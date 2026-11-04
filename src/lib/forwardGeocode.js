// "Colonia" -> the places called that, anywhere in the world: forward geocoding from Nominatim (OpenStreetMap), the sister of reverseGeocode.js.
// It feeds the autocomplete of the city field. Passive and silent: a short timeout, offline / any failure = an empty list (never an error the UI
// has to survive), a small in-memory cache so the same text is never asked twice, and the caller debounces (see useCitySearch).
//
// The COUNTRY comes from the ISO code of the answer (`address.country_code`), never from the words: the same city is found whatever the
// language of the interface, and picking "Colonia, Uruguay" sets Uruguay even when the app is in German.
// Only the typed text and the interface language leave the device. (Nominatim asks for an identifying Referer: the browser's default one is sent.)

import { placeName } from './reverseGeocode.js';

export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
export const SEARCH_TIMEOUT_MS = 6000;
export const SEARCH_MIN_CHARS = 3; // more than 2 letters
export const SEARCH_LIMIT = 6;
const CACHE_MAX = 30;
const cache = new Map();

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 80) : '');
const believable = (n, max) => Number.isFinite(n) && Math.abs(n) <= max;

/** Nominatim answer -> [{ id, name, label, country, countryCode, lat, lng }]. Pure, tolerant to garbage. */
export function parsePlaces(data) {
  if (!Array.isArray(data)) return [];
  const rows = [];
  for (const item of data) {
    const lat = Number(item?.lat);
    const lng = Number(item?.lon);
    if (!believable(lat, 90) || !believable(lng, 180)) continue;
    const a = item.address && typeof item.address === 'object' ? item.address : {};
    const name = placeName(a) || clean(item.name) || clean(String(item.display_name || '').split(',')[0]);
    if (!name) continue;
    const code = String(a.country_code || '').toUpperCase();
    rows.push({
      id: String(item.place_id ?? `${lat},${lng}`),
      name,
      state: clean(a.state || a.region || ''),
      country: clean(a.country),
      countryCode: /^[A-Z]{2}$/.test(code) ? code : '',
      lat: Math.round(lat * 1e4) / 1e4,
      lng: Math.round(lng * 1e4) / 1e4,
    });
  }
  // "Colonia, Alemania": the label is the name and the country; only when two answers would read the same does the state tell them apart
  const seen = new Map();
  for (const r of rows) seen.set(`${r.name}|${r.country}`, (seen.get(`${r.name}|${r.country}`) || 0) + 1);
  const out = [];
  const used = new Set();
  for (const r of rows) {
    const dup = seen.get(`${r.name}|${r.country}`) > 1;
    const label = [r.name, dup && r.state && r.state !== r.name ? r.state : '', r.country].filter(Boolean).join(', ');
    if (used.has(label)) continue;
    used.add(label);
    out.push({ id: r.id, name: r.name, label, country: r.country, countryCode: r.countryCode, lat: r.lat, lng: r.lng });
  }
  return out;
}

/** The places that match `query` (>= 3 letters). Resolves [] on ANY failure. `signal` cancels it (a newer keystroke). */
export async function searchPlaces(query, { fetchImpl = globalThis.fetch, lang = '', signal, timeoutMs = SEARCH_TIMEOUT_MS } = {}) {
  const text = clean(query);
  if (text.length < SEARCH_MIN_CHARS || typeof fetchImpl !== 'function') return [];
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return [];
  const key = `${/^[a-z]{2}$/i.test(lang) ? lang.toLowerCase() : ''}|${text.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);
  const q = new URLSearchParams({ format: 'json', q: text, addressdetails: '1', limit: String(SEARCH_LIMIT), featuretype: 'settlement', dedupe: '1' });
  if (/^[a-z]{2}$/i.test(lang)) q.set('accept-language', lang.toLowerCase());
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const onAbort = () => ctl?.abort();
  signal?.addEventListener?.('abort', onAbort);
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  try {
    const res = await Promise.race([
      fetchImpl(`${NOMINATIM_SEARCH_URL}?${q}`, { signal: ctl?.signal, credentials: 'omit', headers: { Accept: 'application/json' } }),
      new Promise((_, reject) => ctl?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    ]);
    if (!res || !res.ok) return [];
    const places = parsePlaces(await res.json());
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, places);
    return places;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

export const clearPlaceCache = () => cache.clear();
