// One IndexedDB database ("obrax") shared by photos, projects and the company logo.
//
// v1 had a single store, `photos` (keyPath: slot) holding the photos of the one and only project.
// v2 keeps that store untouched (so its rows can be migrated) and adds:
//   project_photos  keyPath `key` = "<projectId>:<slot>"   photos scoped per project
//   projects        keyPath `id`                           one record per client job
//   company         keyPath `key`                          company logo (base64)
// v3 adds:
//   prices          keyPath `region`                       last known price book of each region (priceStore.js)

export const DB_NAME = 'obrax';
export const DB_VERSION = 3;
export const STORE_LEGACY_PHOTOS = 'photos';
export const STORE_PHOTOS = 'project_photos';
export const STORE_PROJECTS = 'projects';
export const STORE_COMPANY = 'company';
export const STORE_PRICES = 'prices';

export function openDb(factory) {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const has = (n) => db.objectStoreNames.contains(n);
      if (!has(STORE_PHOTOS)) db.createObjectStore(STORE_PHOTOS, { keyPath: 'key' });
      if (!has(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      if (!has(STORE_COMPANY)) db.createObjectStore(STORE_COMPANY, { keyPath: 'key' });
      if (!has(STORE_PRICES)) db.createObjectStore(STORE_PRICES, { keyPath: 'region' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close(); // never block an upgrade from another tab
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

/** Small promise wrapper: run(storeName, mode, (store) => request | void) -> request result. */
export function createRunner(factory) {
  let dbPromise;
  const open = () => (dbPromise ??= openDb(factory));
  return async function run(storeName, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
}

export const hasIndexedDb = () => typeof indexedDB !== 'undefined' && Boolean(indexedDB);
