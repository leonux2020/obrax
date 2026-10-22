// Company logo persistence: base64 in IndexedDB (store `company`, key "logo"), memory fallback when
// IndexedDB is unavailable. The text fields of the profile stay in localStorage (see draft.js).

import { STORE_COMPANY, createRunner, hasIndexedDb } from './db.js';
import { normalizeLogo } from './logo.js';

const KEY = 'logo';

export function memoryLogoBackend() {
  let row = null;
  return {
    kind: 'memory',
    async get() {
      return row;
    },
    async set(r) {
      row = r;
    },
    async clear() {
      row = null;
    },
  };
}

export function idbLogoBackend(factory) {
  const run = createRunner(factory);
  return {
    kind: 'indexeddb',
    get: () => run(STORE_COMPANY, 'readonly', (s) => s.get(KEY)),
    set: (row) => run(STORE_COMPANY, 'readwrite', (s) => s.put(row)),
    clear: () => run(STORE_COMPANY, 'readwrite', (s) => s.delete(KEY)),
  };
}

export function createLogoStore(primary = null) {
  const fallback = memoryLogoBackend();
  let backend = primary || fallback;
  const guard = async (op, ...args) => {
    try {
      return await backend[op](...args);
    } catch {
      if (backend === fallback) throw new Error('logo store unavailable');
      backend = fallback;
      return fallback[op](...args);
    }
  };
  return {
    get kind() {
      return backend.kind;
    },
    /** Stored logo data URL, or '' (never trusts stored data). */
    async load() {
      const row = await guard('get');
      return normalizeLogo(row?.dataUrl);
    },
    async save(dataUrl) {
      const clean = normalizeLogo(dataUrl);
      if (!clean) throw new Error('invalid logo');
      await guard('set', { key: KEY, dataUrl: clean, at: Date.now() });
      return clean;
    },
    clear: () => guard('clear'),
  };
}

export const logoStore = createLogoStore(hasIndexedDb() ? idbLogoBackend(indexedDB) : null);
