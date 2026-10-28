// The consolidated CUBRAX backup: ONE JSON document with everything the device keeps (projects, their photos, the
// company profile + logo + signature, settings, backup preference). It is uploaded to Drive (see drive.js /
// driveSync.js) and read back on a new device or after signing out.
//
// Everything that comes back is UNTRUSTED: it is validated with the same normalizers used for local storage.
// Restoring never destroys anything: projects are merged (the newest `updatedAt` of each id wins) and the
// profile / settings only fill in an empty device.

import { normalizeCompany, normalizeProfileMeta, normalizeSettings, isCompanyEmpty } from './draft.js';
import { normalizeLogo } from './logo.js';
import { MAX_PROJECTS, normalizeProjects } from './projects.js';
import { normalizePhoto, normalizePhotos } from './photos.js';
import { writeNotePhotos } from './notePhotos.js';

export const BACKUP_APP = 'cubrax';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_CHARS = 60_000_000;
const ID_RE = /^[a-z0-9]{1,16}$/;

/**
 * Snapshot of the device. `loadPhotos(projectId)` returns that project's stored photos; `loadNotePhotos(project)` the photos of
 * its logbook notes as { [noteId]: { dataUrl, width, height, at } } (Blobs on the device, base64 only inside this payload).
 * @returns {Promise<object>} plain JSON-able object
 */
export async function collectBackup({ settings, company, meta, logo, projects, loadPhotos = async () => [], loadNotePhotos = async () => ({}), now = Date.now() }) {
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
 * Pure merge of the local state with a backup.
 *  - projects: union by id; the newest `updatedAt` wins (ties keep the local one)
 *  - profile (company, logo, settings, meta): taken from the backup ONLY when this device has no profile yet
 * @returns {{projects, company, logo, settings, meta, wonProjects: string[], profileRestored: boolean}}
 */
export function mergeBackup(local, backup) {
  const byId = new Map((local.projects || []).map((p) => [p.id, p]));
  const won = [];
  for (const p of backup.projects) {
    const mine = byId.get(p.id);
    if (!mine || p.updatedAt > mine.updatedAt) {
      byId.set(p.id, p);
      won.push(p.id);
    }
  }
  const projects = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PROJECTS);
  const profileRestored = isCompanyEmpty(local.company) && !local.meta?.onboarded && (!isCompanyEmpty(backup.company) || backup.meta.onboarded);
  return {
    projects,
    company: profileRestored ? backup.company : local.company,
    logo: profileRestored ? backup.logo || local.logo || '' : local.logo || '',
    settings: profileRestored || !local.settings?.region ? backup.settings : local.settings,
    meta: profileRestored ? { ...backup.meta, drive: true } : local.meta,
    wonProjects: won.filter((id) => projects.some((p) => p.id === id)),
    profileRestored,
  };
}

/**
 * Merge `backup` into the device and write what changed to IndexedDB through the given stores.
 * @param stores {projectStore, photoStoreFor(id), notePhotosFor(id), logoStore}
 * @returns the merged state (the caller then updates React state / localStorage with it)
 */
export async function restoreBackup(local, backup, { projectStore, photoStoreFor, notePhotosFor = null, logoStore }) {
  const merged = mergeBackup(local, backup);
  for (const id of merged.wonProjects) {
    const project = merged.projects.find((p) => p.id === id);
    await projectStore.save(project);
    const store = photoStoreFor(id);
    for (const photo of backup.photos[id] || []) await store.save(photo);
    // the photos of its notes go back to IndexedDB as Blobs BEFORE the screen shows the project (the `photo: true` links keep working)
    if (notePhotosFor && backup.notePhotos?.[id]) await writeNotePhotos(notePhotosFor(id), backup.notePhotos[id]);
  }
  // projects kept from this device (newer) that lost the Blob of a note photo: fill only what is missing
  if (notePhotosFor) {
    for (const p of merged.projects) {
      if (!merged.wonProjects.includes(p.id) && backup.notePhotos?.[p.id]) {
        const wanted = Object.fromEntries(Object.entries(backup.notePhotos[p.id]).filter(([noteId]) => p.logbook.some((e) => e.id === noteId && e.photo === true)));
        await writeNotePhotos(notePhotosFor(p.id), wanted, { overwrite: false });
      }
    }
  }
  if (merged.profileRestored && merged.logo) await logoStore.save(merged.logo);
  return merged;
}
