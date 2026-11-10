// "Cerrar Rendición": the rendición goes straight to Google Drive as a LIVE Google Sheet (Sheets API v4), never to the phone's Downloads. No UI, no React.
//
//   closeRendition  builds the tabs as pure values (Resumen, Gastos, Pagos, ...) and delivers them:
//                     online + token  -> CUBRAX - Respaldos Obra / Proyectos / <project> / rendicion-<project>  (a Spreadsheet, refreshed in place)  ('uploaded')
//                     offline / Google fails -> NOTHING is downloaded: the values are parked in IndexedDB (exportQueue)                             ('queued')
//   drainExportQueue  the background half (same rules as receiptSync.js): uploads what is parked when the network is back, retries with
//                     exponential backoff, stops at the first connectivity / auth / quota problem, never runs twice at once, never sends offline.
//
//   closeGlobalRendition  the same for the consolidated rendición of several projects: CUBRAX - Respaldos Obra / Rendiciones_Globales /
//                     rendicion-consolidado (kind 'global' in the same queue).
//
// Nothing here can leave the UI hanging: the connection is read synchronously BEFORE any await (offline = the file is parked at once, no network
// attempt), and every network step (the Google session, the upload) has a time limit, because a phone in airplane mode can answer
// `navigator.onLine === true` and then never answer a request. A step that times out is treated as "offline": the file is parked.
//
// The Drive client and the token are the app's existing ones (injected): this module adds no authentication of its own.

import { GLOBAL_RENDITIONS_FOLDER, PROJECTS_FOLDER, folderNameFor } from './driveExport.js';
import { buildGlobalRenditionData, buildRenditionData, renditionTitle } from './rendition.js';
import { exportQueue, EXPORT_QUEUE_LIMITS } from './exportQueue.js';
import { projectTitle } from './projects.js';
import { DriveError } from './drive.js';

const LEGACY_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const EXPORT_SYNC_TAG = 'cubrax-exports';

/** Errors that a later attempt can fix (connectivity, Google session, rate limit, a Drive hiccup). */
export const EXPORT_RETRYABLE = Object.freeze(['offline', 'auth', 'quota', 'http', 'bad_response']);
/** Errors that mean "the line is dead / Google is not ready": the rest of the run would fail the same way, so it stops. */
const STOP_RUN = new Set(['offline', 'auth', 'quota']);

export const BACKOFF = Object.freeze({ baseMs: 30_000, maxMs: 15 * 60_000 });
export const backoffMs = (attempts) => Math.min(BACKOFF.maxMs, BACKOFF.baseMs * 2 ** Math.max(0, attempts));

export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** Time limits of the network steps (ms). A step that exceeds its limit counts as "offline". */
export const TIMEOUTS = Object.freeze({ token: 45_000, upload: 75_000 });

/** The longest the UI waits for a delivery before it frees the button (the delivery itself keeps its own limits). */
export const UI_WATCHDOG_MS = 90_000;

/** Resolve with `promise`'s value, or with `fallback` once `ms` pass; never rejects past the caller's `catch` (a rejection is re-thrown). */
export function settleWithin(promise, ms = UI_WATCHDOG_MS, fallback = null) {
  let timer;
  const limit = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([Promise.resolve(promise), limit]).finally(() => clearTimeout(timer));
}

/** Reject with a DriveError('offline') when `promise` takes longer than `ms` (the late answer, if any, is ignored). */
export function withTimeout(promise, ms) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DriveError('offline')), ms);
  });
  return Promise.race([Promise.resolve(promise), limit]).finally(() => clearTimeout(timer));
}

const codeOf = (err) => (typeof err?.code === 'string' ? err.code : 'unexpected');

/**
 * Put the rendición in Drive as a Google Sheet inside `CUBRAX - Respaldos Obra / Proyectos / <title> /` (or `Rendiciones_Globales`).
 * Closing again REFRESHES the same Spreadsheet (client.upsertSpreadsheet: found by name, never duplicated).
 * A deleted cached folder (404) is looked up again once. Throws the Drive client's DriveError.
 * @param fileName  the title of the Spreadsheet (no extension)
 * @param sheets    pure-value tabs (sheetData.toValueSheets)
 * @param bytes     only for a legacy .xlsx row of the offline queue (no `sheets`)
 */
export async function uploadRendition({ client, kind = 'project', title, fileName, sheets, bytes }) {
  const attempt = async () => {
    const folder = await client.ensureFolderPath(kind === 'global' ? [GLOBAL_RENDITIONS_FOLDER] : [PROJECTS_FOLDER, folderNameFor(title)]);
    if (sheets) return client.upsertSpreadsheet(folder, { title: fileName, sheets });
    // A row parked by an older version: its finished .xlsx file. It is uploaded as it is (nothing builds .xlsx files anymore), once.
    const existing = (await client.listFiles(folder)).get(fileName);
    return client.uploadFile(folder, { name: fileName, mimeType: LEGACY_XLSX_MIME, bytes, existingId: existing?.id || '' });
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
 * @param file       { fileName, sheets }   fileName = title of the Spreadsheet; sheets = pure-value tabs [{ name, rows, widths }]
 * @param project    { id, title, kind? }  the destination: a project (kind 'project', the default) or the global folder (kind 'global')
 * @param upload     async ({ kind, title, fileName, sheets }) => void   (uploadRendition bound to the app's Drive client)
 * @param ensureToken async ({ interactive: true }) => token|null        a Google session; asked as a TAP of the user, so Google's window may open
 * @returns {Promise<{ status: 'uploaded' | 'queued' | 'not_configured' | 'failed', reason?: string }>}
 *   'queued' + reason 'offline' | 'auth' | 'quota' | 'error' (parked in IndexedDB, uploaded later); 'failed' + 'queue_full' | 'bad_file'
 *   (could not even be parked). Nothing is ever downloaded. Always settles: the network steps are time-limited.
 */
export async function deliverRendition({ file, project, upload, ensureToken, queue = exportQueue, online = isOnline, configured = true, now = Date.now(), timeouts = TIMEOUTS }) {
  const offline = !online(); // read synchronously, BEFORE any await: offline never even tries the network
  if (!configured) return { status: 'not_configured' };
  const kind = project.kind === 'global' ? 'global' : 'project';
  const park = async (reason) => {
    try {
      await queue.enqueue({ kind, projectId: kind === 'global' ? '' : project.id, title: project.title, fileName: file.fileName, sheets: file.sheets, now });
      return { status: 'queued', reason };
    } catch (err) {
      return { status: 'failed', reason: err?.message === 'queue_full' ? 'queue_full' : 'bad_file' };
    }
  };
  if (offline) return park('offline');
  try {
    const token = await withTimeout(ensureToken({ interactive: true }), timeouts.token); // the tap of the user: Google may show its window
    if (!token) throw Object.assign(new Error('auth'), { code: 'auth' });
    await withTimeout(upload({ kind, title: project.title, fileName: file.fileName, sheets: file.sheets }), timeouts.upload);
    return { status: 'uploaded' };
  } catch (err) {
    const code = codeOf(err);
    return park(code === 'offline' ? 'offline' : code === 'auth' || code === 'quota' ? code : 'error');
  }
}

/**
 * Build the rendición of ONE project and deliver it as a Google Sheet (see deliverRendition).
 * @param i18n   makeI18n(lang, project.draft.regionCode)
 * @param totals Map(projectId -> budget total | null)
 */
export async function closeRendition({ project, totals, i18n, now = Date.now(), ...deps }) {
  const { t, locale, region } = i18n;
  const sheets = buildRenditionData([project], totals, { t, locale, currency: region.currency });
  return deliverRendition({ file: { fileName: renditionTitle([project], { t }), sheets }, project: { kind: 'project', id: project.id, title: projectTitle(project) || t('proj.untitled') }, now, ...deps });
}

/**
 * Build the consolidated rendición of several projects and deliver it to Rendiciones_Globales (see deliverRendition).
 * @param i18n   makeI18n(lang, region of the first project): text and number format of the file
 */
export async function closeGlobalRendition({ projects, totals, i18n, now = Date.now(), ...deps }) {
  const { t, locale } = i18n;
  const sheets = buildGlobalRenditionData(projects, totals, { t, locale });
  return deliverRendition({ file: { fileName: renditionTitle(projects, { t, global: true }), sheets }, project: { kind: 'global', id: '', title: '' }, now, ...deps });
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
 * @param upload       async ({ kind, title, fileName, sheets, bytes, row }) => void   (`sheets` for every row; `bytes` only for a legacy .xlsx row parked by an older version)
 * @param ensureToken  async ({ interactive: false }) => token|null   SILENT OR ABORT (prompt 'none', never a window): null = this device has no Google session now, the rows keep waiting
 * @returns {Promise<{done: object[], failed: object[], deferred: number, skipped: boolean}|null>}
 */
export function drainExportQueue({ queue = exportQueue, upload, ensureToken = async () => 'token', online = isOnline, now = Date.now, force = false, timeouts = TIMEOUTS } = {}) {
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
        if (!(await withTimeout(ensureToken({ interactive: false }), timeouts.token))) throw Object.assign(new Error('auth'), { code: 'auth' });
        await withTimeout(upload({ kind: row.kind, title: row.title, fileName: row.fileName, sheets: row.sheets, bytes: row.sheets ? undefined : await queue.bytesOf(row), row }), timeouts.upload);
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
