// Device hints, all LOCAL: nothing here talks to any server.
//  - detectRegionCode(): the user's country from the browser's language ("es-CL") or time zone, so the
//    first-run setup never has to ask for it.
//  - currentPosition(): "ubicación actual" of the phone (the browser asks the user for permission itself).

import { LANGS, REGIONS } from './regions.js';

// IANA zone -> country, for people whose browser language carries no country ("es", "en").
const ZONES = Object.freeze({
  'America/Santiago': 'CL',
  'America/Punta_Arenas': 'CL',
  'America/Lima': 'PE',
  'America/Bogota': 'CO',
  'America/Mexico_City': 'MX',
  'America/Monterrey': 'MX',
  'America/Argentina/Buenos_Aires': 'AR',
  'America/Buenos_Aires': 'AR',
  'America/Montevideo': 'UY',
  'America/Asuncion': 'PY',
  'America/La_Paz': 'BO',
  'America/Guayaquil': 'EC',
  'America/Caracas': 'VE',
  'America/Panama': 'PA',
  'America/Costa_Rica': 'CR',
  'America/Guatemala': 'GT',
  'America/El_Salvador': 'SV',
  'America/Tegucigalpa': 'HN',
  'America/Managua': 'NI',
  'America/Santo_Domingo': 'DO',
  'America/Sao_Paulo': 'BR',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'Europe/Madrid': 'ES',
  'Europe/Lisbon': 'PT',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Rome': 'IT',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Vienna': 'AT',
  'Europe/Brussels': 'BE',
  'Europe/Amsterdam': 'NL',
});

/** The country code (a key of REGIONS) this device most likely belongs to, or null when it cannot tell. */
export function detectRegionCode({ languages, timeZone } = {}) {
  const langs = languages ?? (typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);
  for (const l of langs) {
    const m = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(String(l || ''));
    const code = m ? m[1].toUpperCase() : '';
    if (code && REGIONS[code]) return code;
  }
  let zone = timeZone;
  if (zone === undefined) {
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      zone = '';
    }
  }
  const byZone = ZONES[zone];
  return byZone && REGIONS[byZone] ? byZone : null;
}

/**
 * Current position as { lat, lng } (high accuracy first, a cached fix is fine). Rejects with an Error whose
 * `code` is 'unsupported' | 'denied' | 'unavailable' | 'timeout'.
 */
export function currentPosition({ geolocation = typeof navigator === 'undefined' ? null : navigator.geolocation, timeoutMs = 12_000 } = {}) {
  return new Promise((resolve, reject) => {
    const fail = (code) => reject(Object.assign(new Error(`geo:${code}`), { code }));
    if (!geolocation) return fail('unsupported');
    return geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => fail(err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'unavailable'),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 }
    );
  });
}

/** The interface language: the browser's own when the app has it, else `fallback` (normally the country's language). */
export function detectLang(fallback = 'es', { languages } = {}) {
  const langs = languages ?? (typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);
  for (const l of langs) {
    const base = String(l || '').slice(0, 2).toLowerCase();
    if (LANGS.includes(base)) return base;
  }
  return fallback;
}
