// "Selector inteligente" of the project's crew: how the global directory of workers (workers.js) is filtered and ranked when a person is added
// to a job. Pure functions, no React.
//
// There are no coordinates in a worker's file (only a free-text "Dirección base"), so the distance is EMULATED by place names: the job's
// "Ciudad o Región" ("Valparaíso, Región Metropolitana": first part = city, the rest = region / province) is looked for in the worker's address.
//   local     the address names the job's CITY                      (the default: ~ the 70 km that keep the trip short and sustainable)
//   regional  the address names the city OR any other part of the place (region / province)
//   all       the whole directory, nearest first
// A worker with no address, or a job with no place, cannot be placed: they only show in "all" (and with no job place the range does not filter).

import { normalizeWorkers } from './workers.js';

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

/** 0 = local (names the city), 1 = regional (names another part of the place), 2 = elsewhere, 3 = cannot tell (no address / no job place). */
export function proximity(project, worker) {
  const { city, others } = projectPlaces(project);
  const address = norm(worker?.address);
  if (!city || !address) return 3;
  if (mentions(address, city)) return 0;
  // a region word that is part of a longer one ("Región Metropolitana") still counts when the address carries the distinctive word
  if (others.some((o) => mentions(address, o) || o.split(' ').filter((w) => w.length >= 5 && !GENERIC.has(w)).some((w) => mentions(address, w)))) return 1;
  return 2;
}

const matchesQuery = (worker, query) => {
  const words = norm(query).split(' ').filter(Boolean);
  const name = norm(worker.name);
  return words.every((w) => name.includes(w));
};

/**
 * The directory for this job: [{ worker, near }] filtered by the typed text, the trade chip (`specialty` id or '') and the range, and ordered
 * NEAREST first, then best rated, then by name. `placed` tells whether the range could be applied (the job has a place); `hidden` counts the workers
 * left out only because they have no address.
 */
export function rankWorkers(workers, { project, specialty = '', range = DEFAULT_RANGE, query = '' } = {}) {
  const placed = Boolean(projectPlaces(project).city);
  let hidden = 0;
  const rows = [];
  for (const worker of normalizeWorkers(workers)) {
    if (specialty && !worker.specialties.includes(specialty)) continue;
    if (query && !matchesQuery(worker, query)) continue;
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
