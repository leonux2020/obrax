// "Selector inteligente" of the project's crew: how the global directory of workers (workers.js) is filtered and ranked when a person is added
// to a job. Pure functions, no React.
//
// REAL DISTANCE (Haversine, computed on the device): when the job has a saved point (`project.location`, from the city autocomplete / GPS target) AND
// the worker has `lat` / `lon` (saved quietly when their town was picked in Ajustes), the range is decided by kilometres:
//   local <= 70 km, regional <= 250 km, beyond = elsewhere. A worker without coordinates is never made invisible: they fall back to the
//   place-name emulation below and, whatever it says, always show in "all". Nobody whose distance CANNOT be measured is hidden by "local" /
//   "regional": he is listed with `unknown: true` ("Distancia desconocida") and the human decides.
// FALLBACK (either side has no coordinates): the distance is EMULATED by place names: the job's "Ciudad o Región"
// ("Valparaíso, Región Metropolitana": first part = city, the rest = region / province) against the worker's own "Ciudad / Localidad" field
// (`city`), separate from the street address. Accents and case never matter ("Milán" = "milan").
//   local     the worker's CITY is the job's city (exact match after normalising)   (the default: ~ the 70 km that keep the trip short)
//   regional  the worker is in the city OR names another part of the place (region / province)
//   all       the whole directory, nearest first
// BACKWARDS COMPATIBILITY: an older file with no `city` falls back to the old way: the job's city is looked for inside the free-text address,
// so nobody vanishes from the list overnight. A worker with neither, or a job with no place, cannot be placed: they only show in "all".

import { hasHealthNotes, normalizeWorkers } from './workers.js';
import { haversineKm, toCoord } from './geoDistance.js';

export const CREW_RANGES = Object.freeze(['local', 'regional', 'all']);
export const DEFAULT_RANGE = 'local';
export const LOCAL_KM = 70; // the radius "local" stands for (shown on the chip)
export const REGIONAL_KM = 250; // the radius "regional" stands for

/** Lower case, no accents, only letters / digits separated by single spaces. */
export const norm = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const GENERIC = new Set(['region', 'provincia', 'province', 'state', 'estado', 'pais', 'country', 'chile', 'comuna', 'ciudad', 'city']);
const mentions = (haystack, needle) => ` ${haystack} `.includes(` ${needle} `);

/** The job's place as { city, others }: the parts of "Ciudad o Región" (and of the located label), the first one being the city. */
export function projectPlaces(project) {
  const parts = [project?.cityOrRegion, project?.location?.label]
    .flatMap((s) => String(s ?? '').split(/[,;/\n]+/))
    .map(norm)
    .filter((p) => p.length >= 3 && !GENERIC.has(p));
  const unique = [...new Set(parts)];
  return { city: unique[0] ?? '', others: unique.slice(1) };
}

/** The parts of a typed place ("Milán, MI" -> ['milan', 'mi']), normalised, without empty bits. */
const placeParts = (v) =>
  String(v ?? '')
    .split(/[,;/\n]+/)
    .map(norm)
    .filter(Boolean);

/** Does this point ({lat, lng|lon}) hold a usable place? Strings are cast; null / '' / garbage / 0,0 (an empty record read as numbers) are not a place. */
export function hasPoint(p) {
  const lat = toCoord(p?.lat);
  const lng = toCoord(p?.lng ?? p?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

const warned = new Set();
/** An internal warning, once per worker: a bad coordinate is worth knowing about, not worth flooding the console with. */
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  if (warned.size > 200) warned.clear();
  console.warn(message, key);
}

/**
 * Straight-line km (Haversine) between the job's saved point and the worker's `lat` / `lon`, or null when either side has no usable coordinates.
 * Reads the project as { location: { lat, lng } } and the worker as { lat, lon } (also tolerates `lng`).
 */
export function distanceKm(project, worker) {
  const loc = project?.location;
  if (!loc || !worker) return null;
  // every coordinate is cast with parseFloat BEFORE the formula (Nominatim and old backups carry strings); the comparison below is on numbers
  const from = { lat: toCoord(loc.lat), lng: toCoord(loc.lng ?? loc.lon) };
  const to = { lat: toCoord(worker.lat), lng: toCoord(worker.lon ?? worker.lng) };
  const nullIsland = (p) => p.lat === 0 && p.lng === 0; // an empty record read as 0,0: not a place
  const known = (p) => (Number.isFinite(p.lat) || Number.isFinite(p.lng)) && !nullIsland(p);
  if (!known(from) || !known(to)) return null; // one side simply has no point: not an error
  const km = haversineKm(from, to);
  if (Number.isFinite(km)) return km;
  warnOnce(`${worker.id ?? worker.name}`, 'crewMatch: the distance could not be computed (unusable coordinates); falling back to the city name');
  return null; // NaN / out-of-range: the worker is NOT dropped, proximity() falls back to the name of the city (legacy behaviour)
}

/** 0 = local (the city is the job's city), 1 = regional (names another part of the place), 2 = elsewhere, 3 = cannot tell (no city nor address / no job place). */
export function proximity(project, worker) {
  const km = distanceKm(project, worker);
  if (km !== null) return km <= LOCAL_KM ? 0 : km <= REGIONAL_KM ? 1 : 2; // real maths first
  const { city, others } = projectPlaces(project);
  const own = placeParts(worker?.city ?? worker?.ciudad);
  const address = norm(worker?.address);
  if (!city || (!own.length && !address)) return 3;
  const regionHit = (haystack) => others.some((o) => mentions(haystack, o) || o.split(' ').filter((w) => w.length >= 5 && !GENERIC.has(w)).some((w) => mentions(haystack, w)));

  if (own.length) {
    // the dedicated field decides: an EXACT city match (the street name of the address can no longer fake a "local")
    if (own.includes(city)) return 0;
    return regionHit(`${own.join(' ')} ${address}`) ? 1 : 2;
  }
  // older file, no city: look for the job's city inside the free-text address
  if (mentions(address, city)) return 0;
  // a region word that is part of a longer one ("Región Metropolitana") still counts when the address carries the distinctive word
  return regionHit(address) ? 1 : 2;
}

/**
 * OMNIBOX: ONE field, every typed word must be found (accents / case ignored, anywhere inside the word) in AT LEAST ONE of the `fields`
 * (first name, surname, trade...). "ele" finds "Elena" and "Juan" the Electricista; "juan ele" finds only that Juan. Nothing typed matches all.
 */
export const omniMatch = (query, fields) => {
  const words = norm(query).split(' ').filter(Boolean);
  const hay = fields.map(norm).filter(Boolean);
  return words.every((w) => hay.some((h) => h.includes(w)));
};

/** True when every typed word BEGINS a word of some field ("el" starts "Elena"; it does not start "Michele"): used to put those first. */
export const omniStarts = (query, fields) => {
  const words = norm(query).split(' ').filter(Boolean);
  const hay = fields.flatMap((f) => norm(f).split(' ')).filter(Boolean);
  return words.every((w) => hay.some((h) => h.startsWith(w)));
};

/** What the omnibox reads of a directory worker: first name + surname (`name`), the nickname (`apodo`) and the label of EVERY trade they have. `label` maps a trade id to its words. */
export const searchFields = (worker, label) => [worker.name, worker.apodo, ...(label ? (worker.specialties ?? []).map((id) => label(id)) : [])];
const matchesQuery = (worker, query, label) => omniMatch(query, searchFields(worker, label));

/**
 * The directory for this job: [{ worker, near }] filtered by the typed text (name, or trade when `label` is given), the trade chip (`specialty` id or '') and the range, and ordered
 * NEAREST first, then best rated, then by name. `placed` tells whether the range could be applied (the job has a place); `hidden` counts the workers
 * left out only because they have no city nor address.
 */
export function rankWorkers(workers, { project, specialty = '', range = DEFAULT_RANGE, query = '', label = null } = {}) {
  const placed = Boolean(projectPlaces(project).city) || hasPoint(project?.location);
  const hidden = 0; // kept for the callers: nobody is hidden any more (see `unknown`)
  const rows = [];
  for (const worker of normalizeWorkers(workers)) {
    if (specialty && !worker.specialties.includes(specialty)) continue;
    if (query && !matchesQuery(worker, query, label)) continue;
    const km = distanceKm(project, worker);
    const near = proximity(project, worker);
    const measured = km !== null;
    if (placed && range !== 'all') {
      const ok = range === 'local' ? near === 0 : near <= 1;
      // a MEASURED distance decides. A worker whose distance cannot be known (no coordinates, offline, bad data) is NEVER hidden: he stays in the
      // list, flagged `unknown`, and the human decides whether to call him (inclusive, not exclusive)
      if (!ok && measured) continue;
    }
    rows.push({ worker, near, km, unknown: placed && !measured && near >= 2, starts: query ? omniStarts(query, searchFields(worker, label)) : true });
  }
  // nearest first; at the same distance the ones whose words BEGIN with what is typed (one letter finds a lot: "e" puts Elena before Michele), then best rated
  const gap = (a, b) => (a.km === null || b.km === null ? 0 : a.km - b.km); // two measured workers: the closer one first
  rows.sort((a, b) => a.near - b.near || Number(b.starts) - Number(a.starts) || gap(a, b) || b.worker.rating - a.worker.rating || a.worker.name.localeCompare(b.worker.name));
  return { rows, placed, hidden };
}

/** The directory worker whose name is exactly `name` (accents / case ignored), or null. */
export const findByName = (workers, name) => {
  const n = norm(name);
  return n ? normalizeWorkers(workers).find((w) => norm(w.name) === n) ?? null : null;
};

/**
 * Does this person of the crew carry a SAFETY warning (a limiting condition or an allergy)? The file of the directory they were picked from is
 * read live, so an edit of the file shows up on the job. If that file was deleted, the warning recorded when they were added stays: a delete
 * never silences a risk. A person typed as plain text has no file and no warning.
 */
export function crewHealth(member, workers) {
  if (!member?.ref) return false;
  const file = normalizeWorkers(workers).find((w) => w.id === member.ref);
  return file ? hasHealthNotes(file) : member.health === true;
}
