// Photos attached to a logbook note ("Material dañado"). Hard rule: they are stored ONLY as Blobs in IndexedDB (the same
// `project_photos` store as the Cámara de Obra, DB v5, no schema change) and never as base64 / localStorage. The note itself
// (inside the project) only carries `photo: true`; the bytes live here, keyed "<projectId>:note:<noteId>".
//
// Rows are scoped with `projectId = "<id>#notes"` so the Cámara de Obra (which reads the rows of "<id>") never loads them.
// If IndexedDB is unavailable the photos live in memory for the session (the feature degrades, it does not break).

import { PHOTO_LIMITS, PhotoError, compressImage } from './photos.js';
import { STORE_PHOTOS, createRunner, hasIndexedDb } from './db.js';
import { blobToDataUrl, dataUrlToBlob, hasBlob, isBlob } from './blobs.js';

const scope = (projectId) => `${projectId}#notes`;
const keyOf = (projectId, noteId) => `${projectId}:note:${noteId}`;

/** A clean { blob, width, height, at } or null. Accepts what the compressor returns ({ dataUrl, width, height }) or a Blob row. */
export function normalizeNotePhoto(input) {
  if (!input || typeof input !== 'object') return null;
  const blob = isBlob(input.blob) ? input.blob : dataUrlToBlob(input.dataUrl);
  if (!blob || !/^image\//.test(blob.type) || blob.size <= 0 || blob.size > PHOTO_LIMITS.maxStoredBytes) return null;
  const width = Math.round(Number(input.width));
  const height = Math.round(Number(input.height));
  if (!(width > 0 && width <= PHOTO_LIMITS.maxSide && height > 0 && height <= PHOTO_LIMITS.maxSide)) return null;
  const at = Number(input.at);
  return { blob, width, height, bytes: blob.size, at: Number.isFinite(at) ? at : 0 };
}

export function memoryNoteBackend() {
  const map = new Map();
  return {
    kind: 'memory',
    async get(noteId) {
      return map.get(noteId) ?? null;
    },
    async put(noteId, photo) {
      map.set(noteId, photo);
    },
    async remove(noteId) {
      map.delete(noteId);
    },
    async clear() {
      map.clear();
    },
  };
}

/** IndexedDB backend of ONE project's note photos. */
export function idbNoteBackend(factory, projectId) {
  const run = createRunner(factory);
  const mine = (row) => row && row.projectId === scope(projectId);
  return {
    kind: 'indexeddb',
    async get(noteId) {
      const row = await run(STORE_PHOTOS, 'readonly', (s) => s.get(keyOf(projectId, noteId)));
      return mine(row) ? row : null;
    },
    put: (noteId, photo) => run(STORE_PHOTOS, 'readwrite', (s) => s.put({ ...photo, key: keyOf(projectId, noteId), projectId: scope(projectId), noteId })),
    remove: (noteId) => run(STORE_PHOTOS, 'readwrite', (s) => s.delete(keyOf(projectId, noteId))),
    clear: () =>
      run(STORE_PHOTOS, 'readwrite', (s) => {
        const all = s.getAll();
        all.onsuccess = () => all.result.filter(mine).forEach((row) => s.delete(row.key));
        return all;
      }),
  };
}

/** Store of the note photos of one project, with graceful fallback to memory (same pattern as photoStore.js). */
export function createNotePhotoStore(primary = null) {
  const fallback = memoryNoteBackend();
  let backend = primary || fallback;
  const pending = new Map(); // written to the screen at once, to disk a moment later: reads never miss it
  const guard = async (op, ...args) => {
    try {
      return await backend[op](...args);
    } catch {
      if (backend === fallback) throw new Error('note photo store unavailable');
      backend = fallback;
      return fallback[op](...args);
    }
  };
  return {
    get kind() {
      return backend.kind;
    },
    /** Saves the photo of a note. Rejects when the picture is not a valid image Blob. */
    async put(noteId, photo) {
      const clean = normalizeNotePhoto(photo);
      if (!clean) throw new Error('invalid note photo');
      pending.set(noteId, clean);
      try {
        await guard('put', noteId, clean);
      } finally {
        pending.delete(noteId);
      }
      return clean;
    },
    /** { blob, width, height } or null. */
    async get(noteId) {
      if (pending.has(noteId)) return pending.get(noteId);
      const row = await guard('get', noteId);
      return row ? normalizeNotePhoto(row) : null;
    },
    remove: (noteId) => guard('remove', noteId),
    clear: () => guard('clear'),
  };
}

const cache = new Map();

/** Note photos of one project (cached): IndexedDB when available, memory otherwise. */
export function notePhotosFor(projectId) {
  if (!cache.has(projectId)) cache.set(projectId, createNotePhotoStore(hasIndexedDb() && hasBlob() ? idbNoteBackend(indexedDB, projectId) : null));
  return cache.get(projectId);
}

/** A file from the camera / gallery -> compressed (JPEG ~150 KB, longest side 1200 px) -> a Blob ready for the store. */
export async function prepareNotePhoto(file) {
  const clean = normalizeNotePhoto(await compressImage(file));
  if (!clean) throw new PhotoError('decode');
  return clean;
}

/** Temporary URL to show a Blob (no base64 in memory). Call revokeBlobUrl when done. */
export const blobUrl = (blob) => (typeof URL !== 'undefined' && URL.createObjectURL && isBlob(blob) ? URL.createObjectURL(blob) : '');
export const revokeBlobUrl = (url) => {
  if (url && typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(url);
};

// ---- Drive backup <-> IndexedDB ------------------------------------------------------------------------------------------------
// The Blobs are turned into base64 ONLY to build the backup JSON (the payload that goes to Drive) and back into Blobs when a
// backup is restored; on the device they always stay Blobs. One photo at a time, yielding to the main thread in between.
const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The photos of the notes of a project as { [noteId]: { dataUrl, width, height, at } } for the backup payload.
 * Only notes flagged `photo: true` are read; a photo that cannot be read is skipped (it never breaks the backup).
 */
export async function readNotePhotos(store, logbook = []) {
  const out = {};
  for (const note of logbook) {
    if (note?.photo !== true || typeof note.id !== 'string') continue;
    try {
      const photo = await store.get(note.id);
      if (!photo) continue;
      const dataUrl = await blobToDataUrl(photo.blob);
      if (dataUrl) out[note.id] = { dataUrl, width: photo.width, height: photo.height, at: photo.at };
    } catch {
      /* skipped */
    }
    await yieldToMain();
  }
  return out;
}

/**
 * Writes backup photos ({ [noteId]: { dataUrl, width, height, at } }) into the store as Blobs.
 * `overwrite: false` only fills the notes that have no local Blob. Returns how many were written.
 */
export async function writeNotePhotos(store, photos = {}, { overwrite = true } = {}) {
  let written = 0;
  for (const [noteId, photo] of Object.entries(photos)) {
    try {
      if (!overwrite && (await store.get(noteId))) continue;
      await store.put(noteId, photo); // data URL -> Blob -> IndexedDB
      written += 1;
    } catch {
      /* one bad photo never stops the restore */
    }
    await yieldToMain();
  }
  return written;
}
