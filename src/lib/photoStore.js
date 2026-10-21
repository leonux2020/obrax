// Local persistence of project photos. IndexedDB is the primary store (binary-friendly, large quota,
// does not bloat localStorage); if it is unavailable (private mode, old WebView) photos live in memory
// for the session so the feature degrades instead of breaking.

import { normalizePhoto, normalizePhotos } from './photos.js';

const DB_NAME = 'obrax';
const STORE = 'photos';

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

function idbBackend(factory) {
  let dbPromise;
  const open = () =>
    (dbPromise ??= new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'slot' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    kind: 'indexeddb',
    getAll: () => run('readonly', (s) => s.getAll()),
    put: (photo) => run('readwrite', (s) => s.put(photo)),
    remove: (slot) => run('readwrite', (s) => s.delete(slot)),
    clear: () => run('readwrite', (s) => s.clear()),
  };
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

export const photoStore = createPhotoStore(
  typeof indexedDB !== 'undefined' && indexedDB ? idbBackend(indexedDB) : null
);
