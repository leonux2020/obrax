// "Where am I?" in words: coordinates -> the name of the city / town / village, from Nominatim (OpenStreetMap). Global, no key, no cookies.
// Passive and silent: it only runs when the user taps the target button of the city field; a short timeout and ANY failure end as null /
// an Error with a `code`, never as an exception the UI has to survive. Only the (rounded) coordinates and the interface language leave the
// device. (Nominatim asks for an identifying Referer: the browser's default one is sent on purpose, unlike the weather calls.)

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
export const REVERSE_TIMEOUT_MS = 8000;

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 80) : '');

/** The place name of a Nominatim `address`: city, else town, else village (then the smaller / wider names some countries use). '' when none. */
export function placeName(address) {
  if (!address || typeof address !== 'object') return '';
  for (const key of ['city', 'town', 'village', 'municipality', 'hamlet', 'suburb', 'county']) {
    const v = clean(address[key]);
    if (v) return v;
  }
  return '';
}

/**
 * Name of the place at { lat, lng }. Resolves a string, or rejects with an Error whose `code` is 'offline' | 'notfound' | 'failed'.
 */
export async function reverseCity({ lat, lng }, { fetchImpl = globalThis.fetch, lang = '', timeoutMs = REVERSE_TIMEOUT_MS } = {}) {
  const fail = (code) => Object.assign(new Error(`reverse:${code}`), { code });
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw fail('failed');
  if (typeof fetchImpl !== 'function') throw fail('failed');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw fail('offline');
  const q = new URLSearchParams({ format: 'json', lat: String(Math.round(lat * 1e4) / 1e4), lon: String(Math.round(lng * 1e4) / 1e4), addressdetails: '1', zoom: '14' });
  if (/^[a-z]{2}$/i.test(lang)) q.set('accept-language', lang.toLowerCase());
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  let data;
  try {
    const res = await Promise.race([
      fetchImpl(`${NOMINATIM_URL}?${q}`, { signal: ctl?.signal, credentials: 'omit', headers: { Accept: 'application/json' } }),
      new Promise((_, reject) => ctl?.signal?.addEventListener('abort', () => reject(new Error('timeout')))),
    ]);
    if (!res || !res.ok) throw fail('failed');
    data = await res.json();
  } catch (err) {
    throw err?.code ? err : fail('failed');
  } finally {
    clearTimeout(timer);
  }
  const name = placeName(data?.address);
  if (!name) throw fail('notfound');
  return name;
}
