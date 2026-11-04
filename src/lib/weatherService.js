// Environmental awareness of the Dashboard: temperature, sky and a CONDITIONAL wind warning for every project card.
//
// Passive by design (the same rules as lib/weather.js, which feeds the thermal chip of the project header):
//  - open-meteo.com, free, no key. The place is the saved GPS point or the city text (geocoded once, the coordinates are cached).
//  - NOTHING here is awaited by the UI: the card renders first; a fresh reading is read synchronously from the cache, otherwise the fetch
//    runs in the background (2 at a time, so a Dashboard of 30 jobs never opens 30 sockets) and the badge fades in when it lands.
//  - Offline / API down / garbage / timeout -> null: the badge simply does not exist. Never an error, never a spinner.
//  - Readings live in ONE map in localStorage (a city appears on many cards), 2 hours each, at most 40 places.
//  - Privacy: only a city name or coordinates rounded to ~1 km leave the device.

import { FORECAST_URL, GEOCODE_URL, WEATHER_TIMEOUT_MS, WEATHER_TTL_MS, getJson, round, weatherLevel } from './weather.js';

export const WIND_ALERT_KMH = 30; // strictly above: a danger for work at height and for structures (scaffolds, formwork, crane loads)
export const CARD_WEATHER_KEY = 'cp.wxcards.v1';
export const CARD_WEATHER_MAX = 40;
const MPH_REGIONS = new Set(['US', 'GB']); // the only markets that read wind in mph
const KMH_PER_MPH = 1.609344;

/** WMO weather code -> one of 'clear' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm' (null for an unknown code). */
export function skyOf(code) {
  if (typeof code !== 'number' || !Number.isFinite(code)) return null;
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  return null;
}

/** Is this wind (km/h) a risk worth showing? Only a believable number above the threshold. */
export const windAlert = (kmh) => typeof kmh === 'number' && Number.isFinite(kmh) && kmh <= 400 && kmh > WIND_ALERT_KMH;

/** The wind as the market reads it: { value, unit } in km/h, or mph for the US and the UK. */
export function windDisplay(kmh, regionCode = '') {
  const mph = MPH_REGIONS.has(String(regionCode).toUpperCase());
  return mph ? { value: Math.round(kmh / KMH_PER_MPH), unit: 'mph' } : { value: Math.round(kmh), unit: 'km/h' };
}

const believable = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;

/** A stored / fetched reading -> the shape the card uses, or null when it is not a believable one. */
function shape(raw, at, cached) {
  if (!raw || weatherLevel(raw.temp) === null) return null;
  const wind = believable(raw.wind, 0, 400) ? raw.wind : null;
  return { temp: raw.temp, sky: skyOf(raw.code), night: raw.day === 0, wind, windAlert: windAlert(wind), at, cached };
}

// ---- cache ------------------------------------------------------------------------------------------------------------------------------
function readMap(storage) {
  try {
    const v = JSON.parse(storage?.getItem(CARD_WEATHER_KEY) || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function writeEntry(storage, key, entry) {
  try {
    const map = readMap(storage);
    map[key] = entry;
    const keys = Object.keys(map);
    if (keys.length > CARD_WEATHER_MAX) for (const k of keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0)).slice(0, keys.length - CARD_WEATHER_MAX)) delete map[k];
    storage?.setItem(CARD_WEATHER_KEY, JSON.stringify(map));
  } catch {
    /* full or blocked storage: the reading is just not remembered */
  }
}

/** The FRESH reading of a place from the cache (synchronous, no network), or null. */
export function readCardWeather(place, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  if (!place) return null;
  const e = readMap(storage)[place.key];
  if (!e || !Number.isFinite(e.at) || now - e.at < 0 || now - e.at >= WEATHER_TTL_MS) return null;
  return shape(e, e.at, true);
}

// ---- background fetching ---------------------------------------------------------------------------------------------------------------
const MAX_PARALLEL = 2;
let running = 0;
const waiting = [];
const inflight = new Map();

function pump() {
  while (running < MAX_PARALLEL && waiting.length) {
    const job = waiting.shift();
    running += 1;
    job().finally(() => {
      running -= 1;
      pump();
    });
  }
}
const queued = (fn) =>
  new Promise((resolve) => {
    waiting.push(() => fn().then(resolve, () => resolve(null)));
    pump();
  });

async function load(place, { fetchImpl, storage, now, timeoutMs }) {
  const e = readMap(storage)[place.key];
  let { lat, lng } = place;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (e && Number.isFinite(e.lat) && Number.isFinite(e.lng)) ({ lat, lng } = e); // the city was already resolved: skip the geocoding call
    else {
      const q = new URLSearchParams({ name: place.name, count: '1', format: 'json' });
      if (place.country) q.set('countryCode', place.country);
      const geo = await getJson(fetchImpl, `${GEOCODE_URL}?${q}`, timeoutMs);
      const hit = Array.isArray(geo?.results) ? geo.results[0] : null;
      lat = hit?.latitude;
      lng = hit?.longitude;
      if (!believable(lat, -90, 90) || !believable(lng, -180, 180)) return null;
      lat = round(lat, 2);
      lng = round(lng, 2);
    }
  }
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: 'temperature_2m,weather_code,wind_speed_10m,is_day',
    wind_speed_unit: 'kmh',
    timezone: 'auto',
  });
  const cur = (await getJson(fetchImpl, `${FORECAST_URL}?${q}`, timeoutMs))?.current;
  const reading = { temp: cur?.temperature_2m, code: cur?.weather_code, wind: cur?.wind_speed_10m, day: cur?.is_day };
  const out = shape(reading, now, false);
  if (!out) return null; // garbage answer: nothing is cached, nothing is shown
  writeEntry(storage, place.key, { ...reading, at: now, lat, lng });
  return out;
}

/**
 * The current conditions at a place: `{ temp, sky, night, wind, windAlert, at, cached }` or null (hide the badge). Never throws, never
 * waits for the caller: use it from an effect. A fresh cached reading answers without any request; the same place asked by many cards
 * shares ONE request.
 */
export function fetchCardWeather(place, { fetchImpl = globalThis.fetch, storage = globalThis.localStorage, now = Date.now(), timeoutMs = WEATHER_TIMEOUT_MS, online = true } = {}) {
  try {
    if (!place) return Promise.resolve(null);
    const hit = readCardWeather(place, { storage, now });
    if (hit) return Promise.resolve(hit);
    if (!online || typeof fetchImpl !== 'function') return Promise.resolve(null);
    if (inflight.has(place.key)) return inflight.get(place.key);
    const job = queued(() => load(place, { fetchImpl, storage, now, timeoutMs })).finally(() => inflight.delete(place.key));
    inflight.set(place.key, job);
    return job;
  } catch {
    return Promise.resolve(null);
  }
}
