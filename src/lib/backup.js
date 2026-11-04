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
import { canon, canonById, mergePhotoSlots, mergeProjectLists } from './merge.js';
import { recalculateProjectTotals } from './projectTotals.js';
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

/** True when the backup still carries a photo that a deletion of ours (photoTomb) already killed: the backup has to be rewritten without it. */
function hasPhotoGap(photoTomb, remote) {
  if (!photoTomb || !Array.isArray(remote)) return false;
  return remote.some((p) => p && Number(photoTomb[p.slot]) > 0 && Number(p.at || 0) <= Number(photoTomb[p.slot]));
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
  // the middleware: each merged project is recalculated (capsule sealed, totals rewritten) BEFORE it is compared and saved
  const { projects, removed } = mergeProjectLists(local.projects || [], backup.projects, tombs.projects, 200, recalculateProjectTotals);
  const mine = new Map((local.projects || []).map((p) => [p.id, p]));
  const theirs = new Map(backup.projects.map((p) => [p.id, p]));
  const won = [];
  const remoteWon = [];
  let needsPush = canon(tombs) !== canon(normalizeTombs(backup.tombs));
  for (const p of projects) {
    const before = mine.get(p.id);
    const remote = theirs.get(p.id);
    // "changed" is judged against what this device would hold for the project after its own recalculation (a copy that only lacks the derived cache is the same data)
    if (!before || canon(recalculateProjectTotals(before)) !== canon(recalculateProjectTotals(p))) won.push(p.id);
    if (remote && (!before || remote.updatedAt > before.updatedAt)) remoteWon.push(p.id);
    if (!remote || canon(recalculateProjectTotals(remote)) !== canon(recalculateProjectTotals(p))) needsPush = true;
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
    // the photos of its notes go back to IndexedDB as Blobs BEFORE the screen shows the project (the `photo: true` links keep working)
    if (notePhotosFor && backup.notePhotos?.[id]) await writeNotePhotos(notePhotosFor(id), backup.notePhotos[id], { overwrite: remoteWon.has(id) });
  }
  // CAMERA PHOTOS: reconciled slot by slot for EVERY project that exists on both sides, not only for the ones whose record changed. The photos
  // do not live inside the project, so a phone that took two more pictures leaves the project record identical: judging by the project alone
  // made a tablet keep its old pair AND upload it over the phone's four. Now the union is kept, the newest capture of a slot wins and deleted
  // slots (`photoTomb`) stay deleted; whatever this device holds that Drive lacks makes the merged whole go back up.
  const photosChanged = [];
  let photosAhead = false;
  for (const project of merged.projects) {
    const remote = backup.photos?.[project.id];
    const hasTomb = project.photoTomb && Object.keys(project.photoTomb).length > 0;
    if (!remote?.length && !hasTomb) continue; // nothing to reconcile (local-only photos are uploaded by the normal dirty flag)
    const store = photoStoreFor(project.id);
    const mine = normalizePhotos(await Promise.resolve(store.load?.()).catch(() => []));
    const result = mergePhotoSlots(mine, normalizePhotos(remote), project.photoTomb);
    for (const slot of result.dropLocal) await Promise.resolve(store.remove(slot)).catch(() => {});
    for (const photo of result.fromRemote) await store.save(photo);
    if (result.dropLocal.length || result.fromRemote.length) photosChanged.push(project.id);
    if (result.localAhead || result.dropLocal.length || hasPhotoGap(project.photoTomb, remote)) photosAhead = true;
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
  return { ...merged, workers, workersChanged, photosChanged, needsPush: merged.needsPush || workersAhead || photosAhead };
}
