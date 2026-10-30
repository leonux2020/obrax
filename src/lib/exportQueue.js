// Offline queue of Excel rendiciones ("Cerrar Rendición"). The Excel is NEVER downloaded to the phone: it is sent to Google Drive, and when
// that cannot happen right now (no connection, Drive refused or failed) the finished .xlsx is kept as a Blob in IndexedDB (store `export_queue`)
// until exportSync.js can upload it by itself. Same discipline as the receipt queue (receiptQueue.js):
//
//   status  'pending'  waiting for a connection / for its retry time (nextAt)
//           'sending'  a drain run has it in flight (reset to 'pending' if the page dies: see recover())
//           'failed'   gave up after too many attempts: kept (the user's work is never thrown away) so it can be retried
//
// `kind`: 'project' (Proyectos / <name> / Rendicion_<date>.xlsx) or 'global' (Rendiciones_Globales / Rendicion_Global_<date>.xlsx, the consolidated
// Excel of several projects: it belongs to no project, `projectId` is '').
//
// One row = one rendición file for one project (or the global one) and day (a second close of the same project the same day REPLACES the waiting row, exactly as the
// Drive file of that name is replaced). Rows hold the spreadsheet only.

import { STORE_EXPORTS, createRunner, hasIndexedDb } from './db.js';
import { isBlob } from './blobs.js';
import { newEntryId } from './ledger.js';

export const EXPORT_QUEUE_LIMITS = Object.freeze({ maxItems: 20, maxBlobBytes: 8_000_000, maxAttempts: 10 });
export const EXPORT_STATUSES = Object.freeze(['pending', 'sending', 'failed']);
export const EXPORT_KINDS = Object.freeze(['project', 'global']);

const ID_RE = /^[a-z0-9]{4,24}$/;
const PROJECT_RE = /^[a-z0-9]{6,24}$/;
const FILE_RE = /^[A-Za-z0-9._ -]{1,80}\.xlsx$/;
const num = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);

/** Validate an untrusted stored row. Returns a clean row or null (a row without a usable file is useless). */
export function normalizeExportRow(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.id !== 'string' || !ID_RE.test(obj.id)) return null;
  const kind = obj.kind === 'global' ? 'global' : 'project';
  if (kind === 'project' && (typeof obj.projectId !== 'string' || !PROJECT_RE.test(obj.projectId))) return null;
  if (typeof obj.fileName !== 'string' || !FILE_RE.test(obj.fileName)) return null;
  if (!isBlob(obj.blob) || obj.blob.size <= 0 || obj.blob.size > EXPORT_QUEUE_LIMITS.maxBlobBytes) return null;
  return {
    id: obj.id,
    kind,
    projectId: kind === 'global' ? '' : obj.projectId,
    title: typeof obj.title === 'string' ? obj.title.slice(0, 80) : '', // the project's name = its Drive folder
    fileName: obj.fileName,
    blob: obj.blob,
    status: EXPORT_STATUSES.includes(obj.status) ? obj.status : 'pending',
    createdAt: num(obj.createdAt),
    attempts: Math.max(0, Math.min(99, Math.round(num(obj.attempts)))),
    nextAt: num(obj.nextAt),
    lastError: typeof obj.lastError === 'string' ? obj.lastError.slice(0, 40) : '',
  };
}

export function memoryExportBackend() {
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
  };
}

export function idbExportBackend(factory) {
  const run = createRunner(factory);
  return {
    kind: 'indexeddb',
    getAll: () => run(STORE_EXPORTS, 'readonly', (s) => s.getAll()),
    put: (row) => run(STORE_EXPORTS, 'readwrite', (s) => s.put(row)),
    remove: (id) => run(STORE_EXPORTS, 'readwrite', (s) => s.delete(id)),
  };
}

export function createExportQueue(primary = null) {
  const fallback = memoryExportBackend();
  let backend = primary || fallback;
  const listeners = new Set();
  let snapshot = [];
  const guard = async (op, ...args) => {
    try {
      return await backend[op](...args);
    } catch {
      if (backend === fallback) throw new Error('export queue unavailable');
      backend = fallback; // IndexedDB failed: keep working in memory for this session
      return fallback[op](...args);
    }
  };
  const publish = (list) => {
    snapshot = list;
    listeners.forEach((fn) => fn(snapshot));
  };
  const reload = async () => {
    const rows = (await guard('getAll')).map(normalizeExportRow).filter(Boolean);
    rows.sort((a, b) => a.createdAt - b.createdAt);
    publish(rows);
    return rows;
  };

  return {
    get kind() {
      return backend.kind;
    },
    /** Current rows (oldest first). Never throws: an unreadable store is an empty queue. */
    async list() {
      try {
        return await reload();
      } catch {
        return [];
      }
    },
    /** Last list seen (synchronous, for React's useSyncExternalStore). */
    peek: () => snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /**
     * Park a finished rendición. `blob` is the .xlsx. A waiting row of the same project and file name is replaced (the newest figures win).
     * @returns the stored row; throws 'bad_file' / 'queue_full' so the caller can tell the user.
     */
    async enqueue({ kind = 'project', projectId = '', title = '', fileName, blob, now = Date.now() }) {
      const row = normalizeExportRow({ id: newEntryId(), kind, projectId, title, fileName, blob, status: 'pending', createdAt: now, attempts: 0, nextAt: 0 });
      if (!row) throw new Error('bad_file');
      const current = await this.list();
      const same = current.filter((r) => r.kind === row.kind && r.projectId === row.projectId && r.fileName === row.fileName && r.status !== 'sending');
      if (current.length - same.length >= EXPORT_QUEUE_LIMITS.maxItems) throw new Error('queue_full');
      for (const r of same) await guard('remove', r.id);
      await guard('put', row);
      await reload();
      return row;
    },
    /** Merge a change into a row (status, attempts, nextAt, lastError). No-op when the row is gone. */
    async update(id, patch) {
      const row = (await this.list()).find((r) => r.id === id);
      if (!row) return null;
      const next = normalizeExportRow({ ...row, ...patch, id: row.id, kind: row.kind, projectId: row.projectId, fileName: row.fileName, blob: row.blob });
      if (!next) return null;
      await guard('put', next);
      await reload();
      return next;
    },
    async remove(id) {
      await guard('remove', id);
      await reload();
    },
    /** Remove every row of a project (the project was deleted). */
    async removeProject(projectId) {
      for (const r of (await this.list()).filter((x) => x.kind === 'project' && x.projectId === projectId)) await guard('remove', r.id);
      await reload();
    },
    /** The page died mid-send: rows left in 'sending' go back to 'pending'. Call once at start-up. */
    async recover() {
      for (const r of (await this.list()).filter((x) => x.status === 'sending')) await this.update(r.id, { status: 'pending' });
    },
    /** The bytes of a row's spreadsheet. */
    bytesOf: async (row) => new Uint8Array(await row.blob.arrayBuffer()),
    /** Rows that are due now: pending and past their retry time. */
    due: (rows, now = Date.now()) => rows.filter((r) => r.status === 'pending' && r.nextAt <= now),
  };
}

export const exportQueue = createExportQueue(hasIndexedDb() ? idbExportBackend(indexedDB) : null);
