// Project persistence: IndexedDB store `projects` (one record per client job, company snapshot and
// draft included), memory fallback when IndexedDB is unavailable.

import { STORE_PROJECTS, createRunner, hasIndexedDb } from './db.js';
import { normalizeProject, normalizeProjects } from './projects.js';

export function memoryProjectBackend() {
  const map = new Map();
  return {
    kind: 'memory',
    async getAll() {
      return [...map.values()];
    },
    async put(p) {
      map.set(p.id, p);
    },
    async remove(id) {
      map.delete(id);
    },
  };
}

export function idbProjectBackend(factory) {
  const run = createRunner(factory);
  return {
    kind: 'indexeddb',
    getAll: () => run(STORE_PROJECTS, 'readonly', (s) => s.getAll()),
    put: (p) => run(STORE_PROJECTS, 'readwrite', (s) => s.put(p)),
    remove: (id) => run(STORE_PROJECTS, 'readwrite', (s) => s.delete(id)),
  };
}

export function createProjectStore(primary = null) {
  const fallback = memoryProjectBackend();
  let backend = primary || fallback;
  const guard = async (op, ...args) => {
    try {
      return await backend[op](...args);
    } catch {
      if (backend === fallback) throw new Error('project store unavailable');
      backend = fallback;
      return fallback[op](...args);
    }
  };
  return {
    get kind() {
      return backend.kind;
    },
    /** All stored projects, validated, newest first (display order is decided by the dashboard). */
    async load() {
      const list = normalizeProjects(await guard('getAll'));
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async save(project) {
      const clean = normalizeProject(project);
      if (!clean) throw new Error('invalid project');
      await guard('put', clean);
      return clean;
    },
    remove: (id) => guard('remove', id),
  };
}

export const projectStore = createProjectStore(hasIndexedDb() ? idbProjectBackend(indexedDB) : null);
