// Geography helpers of the "Radar de Mercado": validate coordinates, great-circle distance (Haversine) and a quiet,
// never-throwing GPS read. Pure functions except getCurrentCoords (which only talks to the browser when it is asked to).

/** A supplier price saved within this distance of the project beats the AI and every supplier of another city. */
export const SUPPLIER_RADIUS_KM = 50;

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg) => (deg * Math.PI) / 180;
const round5 = (n) => Math.round(n * 1e5) / 1e5;

/** {lat, lng} with finite numbers inside the valid ranges, rounded to 5 decimals (~1 m), or null. */
export function normalizeCoords(obj) {
  if (!obj || typeof obj !== 'object' || obj.lat === null || obj.lng === null || obj.lat === '' || obj.lng === '') return null;
  const lat = Number(obj.lat);
  const lng = Number(obj.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: round5(lat), lng: round5(lng) };
}

/** Haversine distance in km between two {lat, lng} points; Infinity when either one is unusable. */
export function haversineKm(a, b) {
  const p = normalizeCoords(a);
  const q = normalizeCoords(b);
  if (!p || !q) return Infinity;
  const dLat = rad(q.lat - p.lat);
  const dLng = rad(q.lng - p.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p.lat)) * Math.cos(rad(q.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Is `point` within `radiusKm` (inclusive) of `center`? */
export const withinKm = (center, point, radiusKm = SUPPLIER_RADIUS_KM) => haversineKm(center, point) <= radiusKm;

/**
 * The device position, or null: no GPS, no permission (a denied permission is never asked again), timeout or any error.
 * It never throws and never waits longer than `timeoutMs`, so saving a price can never hang on it.
 */
export async function getCurrentCoords({ timeoutMs = 4000, geo = typeof navigator !== 'undefined' ? navigator.geolocation : null, permissions = typeof navigator !== 'undefined' ? navigator.permissions : null } = {}) {
  if (!geo || typeof geo.getCurrentPosition !== 'function') return null;
  try {
    if (permissions?.query) {
      const state = (await permissions.query({ name: 'geolocation' }).catch(() => null))?.state;
      if (state === 'denied') return null;
    }
  } catch {
    /* the Permissions API is optional */
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs + 500);
    const done = (v) => {
      clearTimeout(timer);
      resolve(v);
    };
    try {
      geo.getCurrentPosition((pos) => done(normalizeCoords({ lat: pos?.coords?.latitude, lng: pos?.coords?.longitude })), () => done(null), { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 });
    } catch {
      done(null);
    }
  });
}
