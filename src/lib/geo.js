// Device hints, all LOCAL: nothing here talks to any server.
//  - detectCurrentRegion(): the country the device is in RIGHT NOW, offline: its IANA time zone ("Europe/Rome" -> IT) first, the
//    browser language's country ("it-IT" -> IT) when the zone says nothing. New projects start with it, wherever the user
//    was the last time (a stored "Chile" must not follow a phone that landed in Italy).
//  - detectRegionCode(): the older language-first variant (kept for callers that want the language's country).
//  - languageFor(): the UI language the device asks for, unless the user locked one in the settings.
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
  'Europe/Vatican': 'IT',
  'Europe/San_Marino': 'IT',
  'Europe/Zurich': 'CH',
  'Europe/Luxembourg': 'LU',
  'Europe/Prague': 'CZ',
  'Europe/Copenhagen': 'DK',
  'Europe/Tallinn': 'EE',
  'Europe/Helsinki': 'FI',
  'Europe/Athens': 'GR',
  'Europe/Budapest': 'HU',
  'Atlantic/Reykjavik': 'IS',
  'Europe/Riga': 'LV',
  'Europe/Vilnius': 'LT',
  'Europe/Oslo': 'NO',
  'Europe/Warsaw': 'PL',
  'Europe/Bucharest': 'RO',
  'Europe/Bratislava': 'SK',
  'Europe/Ljubljana': 'SI',
  'Europe/Stockholm': 'SE',
  'Europe/Sofia': 'BG',
  'Europe/Zagreb': 'HR',
  'Europe/Kyiv': 'UA',
  'Europe/Kiev': 'UA',
  'Europe/Belfast': 'GB',
  'Europe/Jersey': 'GB',
  'Europe/Guernsey': 'GB',
  'Europe/Isle_of_Man': 'GB',
  'Atlantic/Canary': 'ES',
  'Africa/Ceuta': 'ES',
  'Atlantic/Madeira': 'PT',
  'Atlantic/Azores': 'PT',
  'America/Halifax': 'CA',
  'America/Edmonton': 'CA',
  'America/Winnipeg': 'CA',
  'America/Regina': 'CA',
  'America/St_Johns': 'CA',
  'America/Phoenix': 'US',
  'America/Anchorage': 'US',
  'America/Detroit': 'US',
  'America/Boise': 'US',
  'America/Indiana/Indianapolis': 'US',
  'America/Kentucky/Louisville': 'US',
  'Pacific/Honolulu': 'US',
  'America/Cancun': 'MX',
  'America/Merida': 'MX',
  'America/Tijuana': 'MX',
  'America/Chihuahua': 'MX',
  'America/Hermosillo': 'MX',
  'America/Mazatlan': 'MX',
  'America/Recife': 'BR',
  'America/Fortaleza': 'BR',
  'America/Bahia': 'BR',
  'America/Manaus': 'BR',
  'America/Belem': 'BR',
  'America/Cuiaba': 'BR',
  'America/Porto_Velho': 'BR',
  'America/Jamaica': 'JM',
  'America/Port_of_Spain': 'TT',
  'America/Cordoba': 'AR',
  'America/Mendoza': 'AR',
});

/** IANA zone -> country code (a key of REGIONS) or null. Whole families share a country (America/Argentina/*). */
export function regionFromTimeZone(zone) {
  if (typeof zone !== 'string' || !zone) return null;
  const code = ZONES[zone] || (zone.startsWith('America/Argentina/') ? 'AR' : null);
  return code && REGIONS[code] ? code : null;
}

/** The country of a language tag ("it-IT", "es_CL") when the app knows that market, else null. */
export function regionFromLanguage(tag) {
  const m = /^[a-z]{2,3}[-_](?:[A-Za-z]{4}[-_])?([A-Za-z]{2})\b/.exec(String(tag || ''));
  const code = m ? m[1].toUpperCase() : '';
  return code && REGIONS[code] ? code : null;
}

const deviceLanguages = () => (typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);
function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/**
 * The country this device is in right now, offline (no API): the time zone first ("Europe/Rome" -> IT; where the phone physically
 * is), then the country of the browser language ("it-IT" -> IT), else null. `languages` / `timeZone` can be injected (tests).
 */
export function detectCurrentRegion({ languages, timeZone } = {}) {
  const byZone = regionFromTimeZone(timeZone === undefined ? deviceTimeZone() : timeZone);
  if (byZone) return byZone;
  for (const l of languages ?? deviceLanguages()) {
    const code = regionFromLanguage(l);
    if (code) return code;
  }
  return null;
}

/** The UI language for these settings: the one the user locked in (`langLocked`), else the device's own when the app has it. */
export function languageFor(settings, { languages } = {}) {
  const current = LANGS.includes(settings?.lang) ? settings.lang : 'es';
  return settings?.langLocked === true ? current : detectLang(current, { languages });
}

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
