// Passive thermal prevention for the header of a project: the temperature at the work site, from open-meteo.com (free, no key).
// The city of the project is turned into coordinates with open-meteo's geocoding API (a saved GPS point wins and needs no lookup).
//
//  - Health rule: above 30 °C -> 'hot' (hydrate, rotate the crew); below 5 °C -> 'cold' (cover up). Anything else is 'ok' (grey, no alarm).
//  - Offline-first: every request has a short timeout; no signal / API down / garbage answer -> null and the indicator simply does not exist
//    (never an error message). The last good reading is cached in localStorage for 2 hours (and served without any request while fresh).
//  - Privacy: only a city name or rounded coordinates leave the device; no identifiers.

export const WEATHER_HOT = 30; // strictly above
export const WEATHER_COLD = 5; // strictly below
export const WEATHER_TTL_MS = 2 * 60 * 60 * 1000;
export const WEATHER_TIMEOUT_MS = 4000;
export const WEATHER_CACHE_KEY = 'cp.weather.v1';
export const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** 'hot' | 'cold' | 'ok' for a temperature in °C (null when it is not a believable number). */
export function weatherLevel(temp) {
  if (typeof temp !== 'number' || !Number.isFinite(temp) || temp < -90 || temp > 60) return null;
  if (temp > WEATHER_HOT) return 'hot';
  if (temp < WEATHER_COLD) return 'cold';
  return 'ok';
}

export const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * What to look up for a project: a saved GPS point ({ lat, lng }), else the city text ("Santiago, RM" -> "Santiago") with the country of
 * the market as a filter. null when there is nothing to look up (no place, no weather).
 */
export function weatherPlace(project, regionCode = '') {
  const loc = project?.location;
  if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
    const lat = round(loc.lat, 2);
    const lng = round(loc.lng, 2);
    return { key: `gps:${lat},${lng}`, lat, lng };
  }
  const name = String(project?.cityOrRegion || '')
    .split(',')[0]
    .trim()
    .slice(0, 80);
  if (name.length < 2) return null;
  const country = /^[A-Za-z]{2}$/.test(regionCode) ? regionCode.toUpperCase() : '';
  return { key: `city:${name.toLowerCase()}|${country}`, name, country };
}

function readCache(storage) {
  try {
    const v = JSON.parse(storage?.getItem(WEATHER_CACHE_KEY) || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

function writeCache(storage, entry) {
  try {
    storage?.setItem(WEATHER_CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* full or blocked storage: the reading is just not remembered */
  }
}

/** GET json with a hard timeout; null on ANY failure (offline, abort, non-2xx, not json). */
export async function getJson(fetchImpl, url, timeoutMs) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  try {
    const res = await Promise.race([
      fetchImpl(url, { signal: ctl?.signal, credentials: 'omit', referrerPolicy: 'no-referrer' }),
      new Promise((_, reject) => ctl?.signal?.addEventListener('abort', () => reject(new Error('timeout')))),
    ]);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The current weather at the project's place, or null (hide the indicator).
 * Resolves `{ temp, level, at, cached }`. Never throws.
 */
export async function fetchWeather(place, { fetchImpl = globalThis.fetch, storage = globalThis.localStorage, now = Date.now(), timeoutMs = WEATHER_TIMEOUT_MS, online = true } = {}) {
  try {
    if (!place) return null;
    const cache = readCache(storage);
    const same = cache && cache.key === place.key;
    if (same && Number.isFinite(cache.temp) && now - cache.at >= 0 && now - cache.at < WEATHER_TTL_MS) {
      return { temp: cache.temp, level: weatherLevel(cache.temp), at: cache.at, cached: true };
    }
    if (!online || typeof fetchImpl !== 'function') return null;

    let { lat, lng } = place;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      if (same && Number.isFinite(cache.lat) && Number.isFinite(cache.lng)) {
        ({ lat, lng } = cache); // the city was already resolved: skip the geocoding call
      } else {
        const q = new URLSearchParams({ name: place.name, count: '1', format: 'json' });
        if (place.country) q.set('countryCode', place.country);
        const geo = await getJson(fetchImpl, `${GEOCODE_URL}?${q}`, timeoutMs);
        const hit = Array.isArray(geo?.results) ? geo.results[0] : null;
        lat = hit?.latitude;
        lng = hit?.longitude;
        if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        lat = round(lat, 3);
        lng = round(lng, 3);
      }
    }

    const q = new URLSearchParams({ latitude: String(lat), longitude: String(lng), current: 'temperature_2m', timezone: 'auto' });
    const data = await getJson(fetchImpl, `${FORECAST_URL}?${q}`, timeoutMs);
    const temp = data?.current?.temperature_2m;
    if (weatherLevel(temp) === null) return null; // also rejects null / strings / out-of-range garbage
    writeCache(storage, { key: place.key, at: now, temp, lat, lng });
    return { temp, level: weatherLevel(temp), at: now, cached: false };
  } catch {
    return null;
  }
}
