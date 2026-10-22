// Local persistence of project photos. IndexedDB is the primary store (binary-friendly, large quota,
// does not bloat localStorage); if it is unavailable (private mode, old WebView) photos live in memory
// for the session so the feature degrades instead of breaking.

import { normalizePhoto, normalizePhotos } from './photos.js';
import { STORE_LEGACY_PHOTOS, STORE_PHOTOS, createRunner, hasIndexedDb, openDb } from './db.js';

export function memoryBackend() {
  const map = new Map();
  return {
    kind: 'memory',
    async getAll() {
      return [...map.values()];
    },
    async put(photo) {
      map.set(photo.slot, photo);
    },
    async remove(slot) {
      map.delete(slot);
    },
    async clear() {
      map.clear();
    },
  };
}

/**
 * IndexedDB backend scoped to ONE project: rows are keyed "<projectId>:<slot>", so two projects can
 * never see (or overwrite) each other's photos. Without an id it uses the neutral scope "_".
 */
export function idbBackend(factory, projectId = '_') {
  const run = createRunner(factory);
  const mine = (row) => row && row.projectId === projectId;
  return {
    kind: 'indexeddb',
    async getAll() {
      return (await run(STORE_PHOTOS, 'readonly', (s) => s.getAll())).filter(mine);
    },
    put: (photo) => run(STORE_PHOTOS, 'readwrite', (s) => s.put({ ...photo, projectId, key: `${projectId}:${photo.slot}` })),
    remove: (slot) => run(STORE_PHOTOS, 'readwrite', (s) => s.delete(`${projectId}:${slot}`)),
    clear: () =>
      run(STORE_PHOTOS, 'readwrite', (s) => {
        const all = s.getAll();
        all.onsuccess = () => all.result.filter(mine).forEach((row) => s.delete(row.key));
        return all;
      }),
  };
}

/**
 * One-off migration: photos saved by the single-project versions (legacy `photos` store) become the
 * photos of `projectId`, then the legacy rows are removed. Safe to call repeatedly.
 */
export async function migrateLegacyPhotos(factory, projectId) {
  const db = await openDb(factory);
  if (!db.objectStoreNames.contains(STORE_LEGACY_PHOTOS)) return 0;
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_LEGACY_PHOTOS, STORE_PHOTOS], 'readwrite');
    const legacy = tx.objectStore(STORE_LEGACY_PHOTOS);
    const target = tx.objectStore(STORE_PHOTOS);
    let moved = 0;
    const all = legacy.getAll();
    all.onsuccess = () => {
      for (const row of all.result) {
        const clean = normalizePhoto(row);
        if (!clean) continue;
        target.put({ ...clean, projectId, key: `${projectId}:${clean.slot}` });
        moved += 1;
      }
      legacy.clear();
    };
    tx.oncomplete = () => resolve(moved);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Store with graceful fallback to memory if the primary backend fails at any point. */
export function createPhotoStore(primary = null) {
  const fallback = memoryBackend();
  let backend = primary || fallback;
  const guard = async (op, ...args) => {
    try {
      return await backend[op](...args);
    } catch {
      if (backend === fallback) throw new Error('photo store unavailable');
      backend = fallback;
      return fallback[op](...args);
    }
  };
  return {
    get kind() {
      return backend.kind;
    },
    async load() {
      const list = await guard('getAll');
      return normalizePhotos(list); // never trust stored data
    },
    async save(photo) {
      const clean = normalizePhoto(photo);
      if (!clean) throw new Error('invalid photo');
      await guard('put', clean);
      return clean;
    },
    remove: (slot) => guard('remove', slot),
    clear: () => guard('clear'),
  };
}

const cache = new Map();

/** Photo store of one project (cached): IndexedDB when available, memory fallback otherwise. */
export function photoStoreFor(projectId) {
  if (!cache.has(projectId)) {
    cache.set(projectId, createPhotoStore(hasIndexedDb() ? idbBackend(indexedDB, projectId) : null));
  }
  return cache.get(projectId);
}
