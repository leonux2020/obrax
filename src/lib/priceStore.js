// Last known price book per region: IndexedDB store `prices` (keyPath `region`), memory fallback when IndexedDB is
// unavailable. This is the "último valor registrado" the quote falls back to when the price service cannot be reached.

import { STORE_PRICES, createRunner, hasIndexedDb } from './db.js';
import { normalizeBook } from './priceBook.js';

export function memoryPriceBackend() {
  const map = new Map();
  return {
    kind: 'memory',
    async get(region) {
      return map.get(region) ?? null;
    },
    async put(row) {
      map.set(row.region, row);
    },
    async clear() {
      map.clear();
    },
  };
}

export function idbPriceBackend(factory) {
  const run = createRunner(factory);
  return {
    kind: 'indexeddb',
    get: (region) => run(STORE_PRICES, 'readonly', (s) => s.get(region)),
    put: (row) => run(STORE_PRICES, 'readwrite', (s) => s.put(row)),
    clear: () => run(STORE_PRICES, 'readwrite', (s) => s.clear()),
  };
}

export function createPriceStore(primary = null) {
  const fallback = memoryPriceBackend();
  let backend = primary || fallback;
  const guard = async (op, ...args) => {
    try {
      return await backend[op](...args);
    } catch {
      if (backend === fallback) throw new Error('price store unavailable');
      backend = fallback;
      return fallback[op](...args);
    }
  };
  return {
    get kind() {
      return backend.kind;
    },
    /** The stored book of a region, validated, or null. Never throws. */
    async load(regionCode) {
      try {
        return normalizeBook(await guard('get', regionCode), regionCode);
      } catch {
        return null;
      }
    },
    async save(book) {
      const clean = normalizeBook(book, book?.region);
      if (!clean) throw new Error('invalid price book');
      await guard('put', clean);
      return clean;
    },
    clear: () => guard('clear'),
  };
}

export const priceStore = createPriceStore(hasIndexedDb() ? idbPriceBackend(indexedDB) : null);
