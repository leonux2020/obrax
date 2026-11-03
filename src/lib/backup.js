// The consolidated CUBRAX backup: ONE JSON document with everything the device keeps (projects, their photos, the
// company profile + logo + signature, settings, backup preference). It is uploaded to Drive (see drive.js /
// driveSync.js) and read back on a new device or after signing out.
//
// Everything that comes back is UNTRUSTED: it is validated with the same normalizers used for local storage.
// Restoring never destroys anything: everything is MERGED record by record (merge.js: projects, and inside them payments, advances,
// expenses, crew and logbook by id, the newest `updatedAt` wins, tombstones keep deleted things deleted) and the profile / settings
// only fill in an empty device.

import { normalizeCompany, normalizeProfileMeta, normalizeSettings, isCompanyEmpty } from './draft.js';
import { normalizeLogo } from './logo.js';
import { normalizeProjects } from './projects.js';
import { canon, canonById, mergeProjectLists } from './merge.js';
import { hasTombs, loadTombs, mergeTombs, normalizeTombs, saveTombs } from './tombstones.js';
import { normalizePhoto, normalizePhotos } from './photos.js';
import { writeNotePhotos } from './notePhotos.js';
import { loadWorkers, mergeWorkers, normalizeWorkers, saveWorkers } from './workers.js';

export const BACKUP_APP = 'cubrax';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_CHARS = 60_000_000;
const ID_RE = /^[a-z0-9]{1,16}$/;

/**
 * Snapshot of the device. `loadPhotos(projectId)` returns that project's stored photos; `loadNotePhotos(project)` the photos of
 * its logbook notes as { [noteId]: { dataUrl, width, height, at } } (Blobs on the device, base64 only inside this payload).
 * @returns {Promise<object>} plain JSON-able object
 */
export async function collectBackup({ settings, company, meta, logo, projects, workers = loadWorkers(), tombs = loadTombs(), loadPhotos = async () => [], loadNotePhotos = async () => ({}), now = Date.now() }) {
  const photos = {};
  const notePhotos = {};
  for (const p of projects || []) {
    const list = ((await loadPhotos(p.id)) || []).filter(Boolean); // the stores return fixed slots with nulls
    if (list.length) photos[p.id] = list;
    const notes = (await loadNotePhotos(p)) || {};
    if (Object.keys(notes).length) notePhotos[p.id] = notes;
  }
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    createdAt: now,
    settings: normalizeSettings(settings),
    company: normalizeCompany(company),
    meta: normalizeProfileMeta(meta),
    logo: normalizeLogo(logo) || '',
    projects: projects || [],
    photos,
    notePhotos,
    ...(workers?.length ? { workers: normalizeWorkers(workers) } : {}), // the "Squadra" directory (health data included); absent when empty
    ...(hasTombs(tombs) ? { tombs: normalizeTombs(tombs) } : {}), // what was deleted (so other devices do not bring it back)
  };
}

export const serializeBackup = (backup) => JSON.stringify(backup);

/** Validate a downloaded file. Returns the clean backup, or null when it is not a usable CUBRAX backup. */
export function parseBackup(text) {
  if (typeof text !== 'string' || !text || text.length > MAX_BACKUP_CHARS) return null;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || raw.app !== BACKUP_APP) return null;
  const version = Number(raw.version);
  if (!Number.isInteger(version) || version < 1 || version > BACKUP_VERSION) return null;
  const projects = normalizeProjects(raw.projects);
  const photos = {};
  if (raw.photos && typeof raw.photos === 'object') {
    for (const p of projects) {
      if (!ID_RE.test(p.id)) continue;
      const list = normalizePhotos(raw.photos[p.id]).filter(Boolean);
      if (list.length) photos[p.id] = list;
    }
  }
  // photos of logbook notes: only for notes that exist in that project and say `photo: true`; each one is validated like any photo
  const notePhotos = {};
  if (raw.notePhotos && typeof raw.notePhotos === 'object') {
    for (const p of projects) {
      const source = ID_RE.test(p.id) ? raw.notePhotos[p.id] : null;
      if (!source || typeof source !== 'object') continue;
      const clean = {};
      for (const note of p.logbook) {
        if (note.photo !== true) continue;
        const item = Object.prototype.hasOwnProperty.call(source, note.id) ? normalizePhoto({ ...source[note.id], slot: 0 }) : null;
        if (item) clean[note.id] = { dataUrl: item.dataUrl, width: item.width, height: item.height, at: item.at };
      }
      if (Object.keys(clean).length) notePhotos[p.id] = clean;
    }
  }
  const workers = normalizeWorkers(raw.workers);
  const tombs = normalizeTombs(raw.tombs);
  return {
    app: BACKUP_APP,
    version,
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : 0,
    settings: normalizeSettings(raw.settings),
    company: normalizeCompany(raw.company),
    meta: normalizeProfileMeta(raw.meta),
    logo: normalizeLogo(raw.logo) || '',
    projects,
    photos,
    notePhotos,
    ...(workers.length ? { workers } : {}),
    ...(hasTombs(tombs) ? { tombs } : {}),
  };
}

/**
 * "Substantially empty" for the one-click restore offer: the local database is loaded and holds no projects (a fresh install, or a
 * device whose work is gone). While the projects are still loading (null) it is NOT empty: nothing is offered on a guess.
 */
export const hasNoProjects = ({ projects }) => Array.isArray(projects) && projects.length === 0;

/** A device with nothing of its own yet: no projects, no company profile, never onboarded. */
export const isDeviceEmpty = ({ projects, company, meta }) => !(projects || []).length && isCompanyEmpty(company) && !meta?.onboarded;

/**
 * Pure merge of the local state with a backup (see merge.js: granular and symmetric).
 *  - projects: union by id; inside a project payments / advances / expenses / crew / logbook are merged by id (newest `updatedAt` wins);
 *    a project or record deleted AFTER its last change (tombstone) stays deleted
 *  - workers (the Squadra directory) are merged apart in restoreBackup: union by id, newest `updatedAt` wins
 *  - profile (company, logo, settings, meta): taken from the backup ONLY when this device has no profile yet
 * @returns {{projects, company, logo, settings, meta, wonProjects: string[], remoteWon: string[], removedProjects: string[], tombs, needsPush: boolean, profileRestored: boolean}}
 *   `wonProjects`: the projects whose content changed on this device (new, or with something from the backup);
 *   `remoteWon`: those where the backup's version of the project itself is the newer one;
 *   `needsPush`: this device holds something the backup lacks, so the merged state should go back up.
 */
export function mergeBackup(local, backup) {
  const tombs = mergeTombs(local.tombs, backup.tombs);
  const { projects, removed } = mergeProjectLists(local.projects || [], backup.projects, tombs.projects);
  const mine = new Map((local.projects || []).map((p) => [p.id, p]));
  const theirs = new Map(backup.projects.map((p) => [p.id, p]));
  const won = [];
  const remoteWon = [];
  let needsPush = canon(tombs) !== canon(normalizeTombs(backup.tombs));
  for (const p of projects) {
    const before = mine.get(p.id);
    const remote = theirs.get(p.id);
    if (!before || canon(before) !== canon(p)) won.push(p.id);
    if (remote && (!before || remote.updatedAt > before.updatedAt)) remoteWon.push(p.id);
    if (!remote || canon(remote) !== canon(p)) needsPush = true;
  }
  const profileRestored = isCompanyEmpty(local.company) && !local.meta?.onboarded && (!isCompanyEmpty(backup.company) || backup.meta.onboarded);
  return {
    projects,
    company: profileRestored ? backup.company : local.company,
    logo: profileRestored ? backup.logo || local.logo || '' : local.logo || '',
    settings: profileRestored || !local.settings?.region ? backup.settings : local.settings,
    meta: profileRestored ? { ...backup.meta, drive: true } : local.meta,
    wonProjects: won,
    remoteWon,
    removedProjects: removed,
    tombs,
    needsPush,
    profileRestored,
  };
}

/**
 * Merge `backup` into the device and write what changed to IndexedDB through the given stores.
 * @param stores {projectStore, photoStoreFor(id), notePhotosFor(id), logoStore}
 * @returns the merged state (the caller then updates React state / localStorage with it)
 */
export async function restoreBackup(local, backup, { projectStore, photoStoreFor, notePhotosFor = null, logoStore }) {
  const merged = mergeBackup({ ...local, tombs: local.tombs ?? loadTombs() }, backup);
  const remoteWon = new Set(merged.remoteWon);
  for (const id of merged.removedProjects) {
    // deleted on another device after its last change here: it goes away here too
    await projectStore.remove(id).catch(() => {});
    await Promise.resolve(photoStoreFor(id).clear?.()).catch(() => {});
    await Promise.resolve(notePhotosFor?.(id).clear?.()).catch(() => {});
  }
  for (const id of merged.wonProjects) {
    const project = merged.projects.find((p) => p.id === id);
    if (!project) continue;
    await projectStore.save(project);
    const store = photoStoreFor(id);
    if (remoteWon.has(id)) {
      for (const photo of backup.photos[id] || []) await store.save(photo);
    } else if (backup.photos[id]?.length) {
      // this device's project is the newer one: its own camera photos stay; only the slots it lacks are filled from the backup
      const have = new Set(((await store.load().catch(() => [])) || []).filter(Boolean).map((ph) => ph.slot));
      for (const photo of backup.photos[id]) if (!have.has(photo.slot)) await store.save(photo);
    }
    // the photos of its notes go back to IndexedDB as Blobs BEFORE the screen shows the project (the `photo: true` links keep working)
    if (notePhotosFor && backup.notePhotos?.[id]) await writeNotePhotos(notePhotosFor(id), backup.notePhotos[id], { overwrite: remoteWon.has(id) });
  }
  // projects kept as they were (nothing new in them) that lost the Blob of a note photo: fill only what is missing
  if (notePhotosFor) {
    for (const p of merged.projects) {
      if (!merged.wonProjects.includes(p.id) && backup.notePhotos?.[p.id]) {
        const wanted = Object.fromEntries(Object.entries(backup.notePhotos[p.id]).filter(([noteId]) => p.logbook.some((e) => e.id === noteId && e.photo === true)));
        await writeNotePhotos(notePhotosFor(p.id), wanted, { overwrite: false });
      }
    }
  }
  // the Squadra directory: union by id, newest wins, deletions respected
  const mineWorkers = loadWorkers();
  const workers = mergeWorkers(mineWorkers, backup.workers || [], merged.tombs.workers);
  const workersChanged = canonById(workers) !== canonById(mineWorkers);
  if (workersChanged) saveWorkers(workers);
  const workersAhead = canonById(workers) !== canonById(backup.workers || []);
  saveTombs(merged.tombs);
  if (merged.profileRestored && merged.logo) await logoStore.save(merged.logo);
  return { ...merged, workers, workersChanged, needsPush: merged.needsPush || workersAhead };
}
