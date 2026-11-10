// Offline queue of rendiciones ("Cerrar Rendición"). The rendición is NEVER downloaded to the phone: it becomes a Google Sheet in the user's Drive, and
// when that cannot happen right now (no connection, Google refused or failed) its DATA (tabs of pure values: strings and numbers, see sheetData.js) is
// kept in IndexedDB (store `export_queue`) until exportSync.js can create / refresh the Sheet by itself. (A row parked by an older version holds a
// finished .xlsx Blob instead: it is still read and uploaded, once.) Same discipline as the receipt queue (receiptQueue.js):
//
//   status  'pending'  waiting for a connection / for its retry time (nextAt)
//           'sending'  a drain run has it in flight (reset to 'pending' if the page dies: see recover())
//           'failed'   gave up after too many attempts: kept (the user's work is never thrown away) so it can be retried
//
// `kind`: 'project' (Proyectos / <name> / <the Sheet>) or 'global' (Rendiciones_Globales / <the Sheet>, the consolidated
// rendición of several projects: it belongs to no project, `projectId` is ''). `fileName` is the TITLE of the Spreadsheet.
//
// One row = one Spreadsheet for one project (or the global one): a second close of the same project REPLACES the waiting row (the newest figures win),
// exactly as the Sheet in Drive is refreshed in place.

import { STORE_EXPORTS, createRunner, hasIndexedDb } from './db.js';
import { isBlob } from './blobs.js';
import { newEntryId } from './ledger.js';
import { sheetsSize, toValueSheets } from './sheetData.js';

export const EXPORT_QUEUE_LIMITS = Object.freeze({ maxItems: 20, maxBlobBytes: 8_000_000, maxSheetChars: 4_000_000, maxAttempts: 10 });
export const EXPORT_STATUSES = Object.freeze(['pending', 'sending', 'failed']);
export const EXPORT_KINDS = Object.freeze(['project', 'global']);

const ID_RE = /^[a-z0-9]{4,24}$/;
const PROJECT_RE = /^[a-z0-9]{6,24}$/;
const FILE_RE = /^[A-Za-z0-9._ -]{1,80}$/; // the Sheet's title (a legacy row also ends in .xlsx)
const num = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);

/** Validate an untrusted stored row. Returns a clean row or null (a row without a usable file is useless). */
export function normalizeExportRow(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.id !== 'string' || !ID_RE.test(obj.id)) return null;
  const kind = obj.kind === 'global' ? 'global' : 'project';
  if (kind === 'project' && (typeof obj.projectId !== 'string' || !PROJECT_RE.test(obj.projectId))) return null;
  if (typeof obj.fileName !== 'string' || !FILE_RE.test(obj.fileName)) return null;
  // the payload: the tabs of values (preferred) or, on a row of an older version, the finished .xlsx
  const sheets = toValueSheets(obj.sheets);
  const hasSheets = sheets.length > 0 && sheetsSize(sheets) <= EXPORT_QUEUE_LIMITS.maxSheetChars;
  const hasBlob = !hasSheets && isBlob(obj.blob) && obj.blob.size > 0 && obj.blob.size <= EXPORT_QUEUE_LIMITS.maxBlobBytes;
  if (!hasSheets && !hasBlob) return null;
  return {
    id: obj.id,
    kind,
    projectId: kind === 'global' ? '' : obj.projectId,
    title: typeof obj.title === 'string' ? obj.title.slice(0, 80) : '', // the project's name = its Drive folder
    fileName: obj.fileName,
    ...(hasSheets ? { sheets } : { blob: obj.blob }),
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
     * Park a finished rendición. `sheets` = the tabs of pure values. A waiting row of the same project and file name is replaced (the newest figures win).
     * @returns the stored row; throws 'bad_file' / 'queue_full' so the caller can tell the user.
     */
    async enqueue({ kind = 'project', projectId = '', title = '', fileName, sheets, now = Date.now() }) {
      const row = normalizeExportRow({ id: newEntryId(), kind, projectId, title, fileName, sheets, status: 'pending', createdAt: now, attempts: 0, nextAt: 0 });
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
      const next = normalizeExportRow({ ...row, ...patch, id: row.id, kind: row.kind, projectId: row.projectId, fileName: row.fileName, sheets: row.sheets, blob: row.blob });
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
    /** The bytes of a LEGACY row (an .xlsx Blob parked by an older version). A row with `sheets` has none. */
    bytesOf: async (row) => (row.blob ? new Uint8Array(await row.blob.arrayBuffer()) : null),
    /** Rows that are due now: pending and past their retry time. */
    due: (rows, now = Date.now()) => rows.filter((r) => r.status === 'pending' && r.nextAt <= now),
  };
}

export const exportQueue = createExportQueue(hasIndexedDb() ? idbExportBackend(indexedDB) : null);
