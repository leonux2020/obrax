// Deferred receipt queue ("Cola Diferida para Boletas"). A receipt photographed WITHOUT a connection is not read
// by any local OCR: the compressed picture is kept as a Blob in IndexedDB (store `receipt_queue`) with the state
// "Pendiente de conexión", and receiptSync.js sends it silently to the AI proxy when the network is back.
//
//   status  'pending'  waiting for a connection / for its retry time (nextAt)        shown as "Pendiente de conexión"
//           'sending'  a drain run has it in flight (reset to 'pending' if the page dies: see recover())
//           'review'   read OK but needs the user's eyes (the receipt's currency differs from the project's)
//           'failed'   permanently unreadable (not a receipt, bad image...): kept so the user can retry / delete
//
// One row = one photo. Rows hold NO personal data besides the picture itself; they never leave the device except
// through the same proxy call the online scanner makes.

import { STORE_RECEIPTS, createRunner, hasIndexedDb } from './db.js';
import { blobToDataUrl, dataUrlToBlob, isBlob } from './blobs.js';
import { newEntryId } from './ledger.js';

export const QUEUE_LIMITS = Object.freeze({ maxItems: 40, maxBlobBytes: 1_200_000, maxAttempts: 8 });
export const QUEUE_STATUSES = Object.freeze(['pending', 'sending', 'review', 'failed']);

const ID_RE = /^[a-z0-9]{4,24}$/;
const PROJECT_RE = /^[a-z0-9]{6,24}$/;
const num = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);

/** Validate an untrusted stored row. Returns a clean row or null (a row without a usable picture is useless). */
export function normalizeQueued(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.id !== 'string' || !ID_RE.test(obj.id)) return null;
  if (typeof obj.projectId !== 'string' || !PROJECT_RE.test(obj.projectId)) return null;
  if (!isBlob(obj.blob) || obj.blob.size <= 0 || obj.blob.size > QUEUE_LIMITS.maxBlobBytes) return null;
  if (!/^image\//.test(obj.blob.type)) return null;
  const status = QUEUE_STATUSES.includes(obj.status) ? obj.status : 'pending';
  return {
    id: obj.id,
    projectId: obj.projectId,
    regionCode: typeof obj.regionCode === 'string' ? obj.regionCode.slice(0, 4) : '',
    currency: typeof obj.currency === 'string' && /^[A-Za-z]{3}$/.test(obj.currency) ? obj.currency.toUpperCase() : '',
    lang: typeof obj.lang === 'string' ? obj.lang.slice(0, 5) : '',
    blob: obj.blob,
    status,
    createdAt: num(obj.createdAt),
    attempts: Math.max(0, Math.min(99, Math.round(num(obj.attempts)))),
    nextAt: num(obj.nextAt),
    lastError: typeof obj.lastError === 'string' ? obj.lastError.slice(0, 40) : '',
    // 'review' only: the extraction already obtained, kept as plain JSON ({supplier, currency, items[]})
    result: status === 'review' && obj.result && typeof obj.result === 'object' ? obj.result : null,
  };
}

export function memoryQueueBackend() {
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

export function idbQueueBackend(factory) {
  const run = createRunner(factory);
  return {
    kind: 'indexeddb',
    getAll: () => run(STORE_RECEIPTS, 'readonly', (s) => s.getAll()),
    put: (row) => run(STORE_RECEIPTS, 'readwrite', (s) => s.put(row)),
    remove: (id) => run(STORE_RECEIPTS, 'readwrite', (s) => s.delete(id)),
  };
}

export function createReceiptQueue(primary = null) {
  const fallback = memoryQueueBackend();
  let backend = primary || fallback;
  const listeners = new Set();
  let snapshot = [];
  const guard = async (op, ...args) => {
    try {
      return await backend[op](...args);
    } catch {
      if (backend === fallback) throw new Error('receipt queue unavailable');
      backend = fallback; // IndexedDB failed: keep working in memory for this session
      return fallback[op](...args);
    }
  };
  const publish = (list) => {
    snapshot = list;
    listeners.forEach((fn) => fn(snapshot));
  };
  const reload = async () => {
    const rows = (await guard('getAll')).map(normalizeQueued).filter(Boolean);
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
     * Park a receipt picture. `image` is the compressed JPEG data URL (or a Blob already).
     * @returns the stored row; throws 'queue_full' / 'bad_image' so the caller can tell the user.
     */
    async enqueue({ projectId, image, regionCode = '', currency = '', lang = '', now = Date.now() }) {
      const blob = isBlob(image) ? image : dataUrlToBlob(image);
      const row = normalizeQueued({ id: newEntryId(), projectId, regionCode, currency, lang, blob, status: 'pending', createdAt: now, attempts: 0, nextAt: 0 });
      if (!row) throw new Error('bad_image');
      const current = await this.list();
      if (current.length >= QUEUE_LIMITS.maxItems) throw new Error('queue_full');
      await guard('put', row);
      await reload();
      return row;
    },
    /** Merge a change into a row (status, attempts, nextAt, lastError, result). No-op when the row is gone. */
    async update(id, patch) {
      const row = (await this.list()).find((r) => r.id === id);
      if (!row) return null;
      const next = normalizeQueued({ ...row, ...patch, id: row.id, projectId: row.projectId, blob: row.blob });
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
      for (const r of (await this.list()).filter((x) => x.projectId === projectId)) await guard('remove', r.id);
      await reload();
    },
    /** The page died mid-send: rows left in 'sending' go back to 'pending'. Call once at start-up. */
    async recover() {
      for (const r of (await this.list()).filter((x) => x.status === 'sending')) await this.update(r.id, { status: 'pending' });
    },
    /** The picture of a row as a data URL (what the proxy call needs). */
    imageOf: (row) => blobToDataUrl(row.blob),
    /** Rows that are due now: pending and past their retry time. */
    due: (rows, now = Date.now()) => rows.filter((r) => r.status === 'pending' && r.nextAt <= now),
  };
}

export const receiptQueue = createReceiptQueue(hasIndexedDb() ? idbQueueBackend(indexedDB) : null);
