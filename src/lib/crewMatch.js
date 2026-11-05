// "Selector inteligente" of the project's crew: how the global directory of workers (workers.js) is filtered and ranked when a person is added
// to a job. Pure functions, no React.
//
// There are no coordinates in a worker's file, so the distance is EMULATED by place names: the job's "Ciudad o Región"
// ("Valparaíso, Región Metropolitana": first part = city, the rest = region / province) against the worker's own "Ciudad / Localidad" field
// (`city`), separate from the street address. Accents and case never matter ("Milán" = "milan").
//   local     the worker's CITY is the job's city (exact match after normalising)   (the default: ~ the 70 km that keep the trip short)
//   regional  the worker is in the city OR names another part of the place (region / province)
//   all       the whole directory, nearest first
// BACKWARDS COMPATIBILITY: an older file with no `city` falls back to the old way: the job's city is looked for inside the free-text address,
// so nobody vanishes from the list overnight. A worker with neither, or a job with no place, cannot be placed: they only show in "all".

import { hasHealthNotes, normalizeWorkers } from './workers.js';

export const CREW_RANGES = Object.freeze(['local', 'regional', 'all']);
export const DEFAULT_RANGE = 'local';
export const LOCAL_KM = 70; // the radius "local" stands for (shown on the chip)

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

/** 0 = local (the city is the job's city), 1 = regional (names another part of the place), 2 = elsewhere, 3 = cannot tell (no city nor address / no job place). */
export function proximity(project, worker) {
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

/** The directory worker against the omnibox: their name (first name + surname) and the label of EVERY trade they have. `label` maps a trade id to its words. */
const matchesQuery = (worker, query, label) => omniMatch(query, [worker.name, ...(label ? worker.specialties.map((id) => label(id)) : [])]);

/**
 * The directory for this job: [{ worker, near }] filtered by the typed text (name, or trade when `label` is given), the trade chip (`specialty` id or '') and the range, and ordered
 * NEAREST first, then best rated, then by name. `placed` tells whether the range could be applied (the job has a place); `hidden` counts the workers
 * left out only because they have no city nor address.
 */
export function rankWorkers(workers, { project, specialty = '', range = DEFAULT_RANGE, query = '', label = null } = {}) {
  const placed = Boolean(projectPlaces(project).city);
  let hidden = 0;
  const rows = [];
  for (const worker of normalizeWorkers(workers)) {
    if (specialty && !worker.specialties.includes(specialty)) continue;
    if (query && !matchesQuery(worker, query, label)) continue;
    const near = proximity(project, worker);
    if (placed && range !== 'all') {
      const ok = range === 'local' ? near === 0 : near <= 1;
      if (!ok) {
        if (near === 3) hidden += 1;
        continue;
      }
    }
    rows.push({ worker, near });
  }
  rows.sort((a, b) => a.near - b.near || b.worker.rating - a.worker.rating || a.worker.name.localeCompare(b.worker.name));
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
