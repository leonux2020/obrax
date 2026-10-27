// Supplier prices of the "Radar de Mercado": IndexedDB store `supplier_prices` (keyPath `id`), memory fallback when
// IndexedDB is unavailable. Entries are validated on every read (see suppliers.js normalizeSupplierEntry).

import { STORE_SUPPLIERS, createRunner, hasIndexedDb } from './db.js';
import { MAX_SUPPLIER_ENTRIES, normalizeSupplierEntry } from './suppliers.js';

export function memorySupplierBackend() {
  const map = new Map();
  return {
    kind: 'memory',
    async getAll() {
      return [...map.values()];
    },
    async put(row) {
      map.set(row.id, row);
    },
    async remove(id) {
      map.delete(id);
    },
    async clear() {
      map.clear();
    },
  };
}

export function idbSupplierBackend(factory) {
  const run = createRunner(factory);
  return {
    kind: 'indexeddb',
    getAll: () => run(STORE_SUPPLIERS, 'readonly', (s) => s.getAll()),
    put: (row) => run(STORE_SUPPLIERS, 'readwrite', (s) => s.put(row)),
    remove: (id) => run(STORE_SUPPLIERS, 'readwrite', (s) => s.delete(id)),
    clear: () => run(STORE_SUPPLIERS, 'readwrite', (s) => s.clear()),
  };
}

export function createSupplierStore(primary = null) {
  const fallback = memorySupplierBackend();
  let backend = primary || fallback;
  const guard = async (op, ...args) => {
    try {
      return await backend[op](...args);
    } catch {
      if (backend === fallback) throw new Error('supplier store unavailable');
      backend = fallback;
      return fallback[op](...args);
    }
  };
  return {
    get kind() {
      return backend.kind;
    },
    /** Every valid entry of a region (newest first, bounded). Never throws. */
    async load(regionCode) {
      try {
        const rows = await guard('getAll');
        return (rows || []).map(normalizeSupplierEntry).filter((e) => e && e.region === regionCode).sort((a, b) => b.at - a.at).slice(0, MAX_SUPPLIER_ENTRIES);
      } catch {
        return [];
      }
    },
    async save(entry) {
      const clean = normalizeSupplierEntry(entry);
      if (!clean) throw new Error('invalid supplier entry');
      await guard('put', clean);
      return clean;
    },
    remove: (id) => guard('remove', id),
    clear: () => guard('clear'),
  };
}

export const supplierStore = createSupplierStore(hasIndexedDb() ? idbSupplierBackend(indexedDB) : null);
