// "Cerrar Rendición": the Excel goes straight to Google Drive, never to the phone's Downloads. No UI, no React.
//
//   closeRendition  builds the .xlsx (Hoja 1 resumen financiero, Hoja 2 detalle de gastos, ...) and delivers it:
//                     online + token  -> CUBRAX - Respaldos Obra / Proyectos / <project> / Rendicion_<YYYY-MM-DD>.xlsx  ('uploaded')
//                     offline / Drive fails -> NOTHING is downloaded: the Blob is parked in IndexedDB (exportQueue)   ('queued')
//   drainExportQueue  the background half (same rules as receiptSync.js): uploads what is parked when the network is back, retries with
//                     exponential backoff, stops at the first connectivity / auth / quota problem, never runs twice at once, never sends offline.
//
// The Drive client and the token are the app's existing ones (injected): this module adds no authentication of its own.

import { PROJECTS_FOLDER, folderNameFor } from './driveExport.js';
import { dayOf } from './ledger.js';
import { buildRenditionBytes } from './rendition.js';
import { exportQueue, EXPORT_QUEUE_LIMITS } from './exportQueue.js';
import { XLSX_MIME } from './xlsx.js';
import { projectTitle } from './projects.js';

export const EXPORT_SYNC_TAG = 'cubrax-exports';

/** Errors that a later attempt can fix (connectivity, Google session, rate limit, a Drive hiccup). */
export const EXPORT_RETRYABLE = Object.freeze(['offline', 'auth', 'quota', 'http', 'bad_response']);
/** Errors that mean "the line is dead / Google is not ready": the rest of the run would fail the same way, so it stops. */
const STOP_RUN = new Set(['offline', 'auth', 'quota']);

export const BACKOFF = Object.freeze({ baseMs: 30_000, maxMs: 15 * 60_000 });
export const backoffMs = (attempts) => Math.min(BACKOFF.maxMs, BACKOFF.baseMs * 2 ** Math.max(0, attempts));

export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** `Rendicion_2026-10-30.xlsx` */
export const renditionFileName = (now = Date.now()) => `Rendicion_${dayOf(now)}.xlsx`;

const codeOf = (err) => (typeof err?.code === 'string' ? err.code : 'unexpected');

/**
 * Put the file in `CUBRAX - Respaldos Obra / Proyectos / <title> /`, replacing a file of the same name (closing twice the same day
 * leaves ONE file). A deleted cached folder (404) is looked up again once. Throws the Drive client's DriveError.
 */
export async function uploadRendition({ client, title, fileName, bytes }) {
  const attempt = async () => {
    const folder = await client.ensureFolderPath([PROJECTS_FOLDER, folderNameFor(title)]);
    const existing = (await client.listFiles(folder)).get(fileName);
    return client.uploadFile(folder, { name: fileName, mimeType: XLSX_MIME, bytes, existingId: existing?.id || '' });
  };
  try {
    return await attempt();
  } catch (err) {
    if (err?.status !== 404) throw err;
    client.forgetFolders();
    return attempt();
  }
}

/**
 * Deliver a finished rendición.
 * @param file       { fileName, bytes: Uint8Array }
 * @param project    { id, title }
 * @param upload     async ({ title, fileName, bytes }) => void        (uploadRendition bound to the app's Drive client)
 * @param ensureToken async () => token|null                           a Google session (the consent may open: this is a tap)
 * @returns {Promise<{ status: 'uploaded' | 'queued' | 'not_configured' | 'failed', reason?: string }>}
 *   'queued' + reason 'offline' | 'auth' | 'quota' | 'error' (parked in IndexedDB, uploaded later); 'failed' + 'queue_full' | 'bad_file'
 *   (could not even be parked). Nothing is ever downloaded.
 */
export async function deliverRendition({ file, project, upload, ensureToken, queue = exportQueue, online = isOnline, configured = true, now = Date.now() }) {
  if (!configured) return { status: 'not_configured' };
  const park = async (reason) => {
    try {
      await queue.enqueue({ projectId: project.id, title: project.title, fileName: file.fileName, blob: new Blob([file.bytes], { type: XLSX_MIME }), now });
      return { status: 'queued', reason };
    } catch (err) {
      return { status: 'failed', reason: err?.message === 'queue_full' ? 'queue_full' : 'bad_file' };
    }
  };
  if (!online()) return park('offline');
  try {
    const token = await ensureToken();
    if (!token) throw Object.assign(new Error('auth'), { code: 'auth' });
    await upload({ title: project.title, fileName: file.fileName, bytes: file.bytes });
    return { status: 'uploaded' };
  } catch (err) {
    const code = codeOf(err);
    return park(code === 'offline' ? 'offline' : code === 'auth' || code === 'quota' ? code : 'error');
  }
}

/**
 * Build the Excel of ONE project and deliver it (see deliverRendition).
 * @param i18n   makeI18n(lang, project.draft.regionCode)
 * @param totals Map(projectId -> budget total | null)
 */
export async function closeRendition({ project, totals, i18n, now = Date.now(), ...deps }) {
  const { t, locale, region } = i18n;
  const bytes = buildRenditionBytes([project], totals, { t, locale, currency: region.currency, digits: region.digits });
  return deliverRendition({ file: { fileName: renditionFileName(now), bytes }, project: { id: project.id, title: projectTitle(project) || t('proj.untitled') }, now, ...deps });
}

let running = null;

/** Exclusive section: one drain at a time in this tab, and (when available) one per origin across tabs. */
async function exclusive(fn) {
  if (running) return running;
  const job = (async () => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
    if (locks?.request) return locks.request(EXPORT_SYNC_TAG, { ifAvailable: true }, (lock) => (lock ? fn() : null));
    return fn();
  })().finally(() => {
    running = null;
  });
  running = job;
  return job;
}

/**
 * Upload every due parked rendición once.
 * @param upload       async ({ title, fileName, bytes, row }) => void
 * @param ensureToken  async () => token|null      SILENT (no screen): null = this device has no Google session now, the rows keep waiting
 * @returns {Promise<{done: object[], failed: object[], deferred: number, skipped: boolean}|null>}
 */
export function drainExportQueue({ queue = exportQueue, upload, ensureToken = async () => 'token', online = isOnline, now = Date.now, force = false } = {}) {
  return exclusive(async () => {
    const result = { done: [], failed: [], deferred: 0, skipped: false };
    if (!online()) return { ...result, skipped: true };
    const rows = force ? (await queue.list()).filter((r) => r.status === 'pending' || r.status === 'failed') : queue.due(await queue.list(), now());
    for (const row of rows) {
      if (!online()) {
        result.deferred += 1;
        continue;
      }
      await queue.update(row.id, { status: 'sending' });
      try {
        if (!(await ensureToken())) throw Object.assign(new Error('auth'), { code: 'auth' });
        await upload({ title: row.title, fileName: row.fileName, bytes: await queue.bytesOf(row), row });
        await queue.remove(row.id); // it is in Drive: the parked copy is no longer needed
        result.done.push(row);
      } catch (err) {
        const code = codeOf(err);
        const stop = STOP_RUN.has(code);
        // connectivity / session / quota never use up the attempts: the file waits as long as it takes (it only counts when Drive itself keeps failing)
        const attempts = stop ? row.attempts : row.attempts + 1;
        const exhausted = attempts >= EXPORT_QUEUE_LIMITS.maxAttempts;
        await queue.update(row.id, exhausted ? { status: 'failed', lastError: code, attempts } : { status: 'pending', lastError: code, attempts, nextAt: now() + backoffMs(Math.max(1, row.attempts + 1)) });
        if (exhausted) result.failed.push(row);
        else result.deferred += 1;
        if (stop) {
          // the rest would fail the same way: they wait for the same retry time (a failed row's `nextAt` is not touched)
          const rest = rows.slice(rows.indexOf(row) + 1).filter((r) => r.status !== 'failed');
          for (const r of rest) await queue.update(r.id, { nextAt: now() + backoffMs(Math.max(1, row.attempts + 1)) });
          result.deferred += rest.length;
          break;
        }
      }
    }
    return result;
  });
}
