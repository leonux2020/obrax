// Google Drive REST client for the CUBRAX backup: ONE dedicated folder ("CUBRAX - Respaldos Obra", created in the root of the
// user's Drive when it does not exist) holding ONE consolidated JSON file. The backup is written ONLY inside that folder
// (`parents`) and restored from it; the folder of the first versions ("CUBRAX") is only READ as a fallback so nobody loses
// the copy they already had.
// Scopes: drive.file (the app only ever sees the files it created itself, never the rest of the user's Drive) + spreadsheets (the Google Sheets
// API, for the live rendición Spreadsheets: see upsertSpreadsheet).
// Pure of the browser: `fetchImpl`, `getToken` and `refreshToken` are injected so everything runs in Node tests.

import { gridFor, sheetTitle, toValueSheets } from './sheetData.js';
import { formatSpreadsheet } from './sheetFormat.js';

export const BACKUP_FOLDER = 'CUBRAX - Respaldos Obra';
export const LEGACY_BACKUP_FOLDER = 'CUBRAX';
export const BACKUP_FILE = 'cubrax-backup.json';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; // the hand-made Excel of the old versions
const SHEET_CHUNK_ROWS = 500; // rows per range written
const SHEET_CALL_CELLS = 40_000; // cells per values:batchUpdate request (the API recommends <= 2 MB per request)
const ID_RE = /^[A-Za-z0-9_-]{5,200}$/;
/** A real folder id: never empty, never the 'root' alias (a media file is never created in the root of the Drive). */
export const isFolderId = (id) => typeof id === 'string' && id !== 'root' && ID_RE.test(id);

/**
 * Time limits per request (ms). A request that exceeds its limit is aborted and counts as "offline" (the sync keeps the change pending and
 * tries again later). Metadata calls get 30 s; the calls that CARRY the backup (upload, download, binary files) get 90 s, because a backup
 * with a dozen base64 photos per project can weigh several MB and the signal on a job site is often weak: a short limit would abort a slow
 * but healthy upload over and over and the copy would never get up. (Before, a stalled connection hung forever.)
 */
export const DRIVE_TIMEOUTS = Object.freeze({ api: 30_000, transfer: 90_000 });

/** code: 'auth' (no / rejected token) | 'offline' | 'quota' | 'http' | 'bad_response' */
export class DriveError extends Error {
  constructor(code, status = 0) {
    super(`drive:${code}${status ? `:${status}` : ''}`);
    this.code = code;
    this.status = status;
  }
}

/**
 * @param getToken        () => Promise<token|null>: the token held right now
 * @param refreshToken    () => Promise<token|null>: a NEW token WITHOUT any screen (Google silent request). When a request answers 401
 *                        (the token expired while the user was working) it is asked once, and the request is repeated with the new token
 *                        transparently; only when it gives nothing does the error 'auth' reach the caller.
 * @param onAuthRejected  called with the token Drive refused (the app forgets it)
 */
export function createDriveClient({ getToken, refreshToken = null, onAuthRejected = () => {}, fetchImpl = (...a) => fetch(...a), timeouts = DRIVE_TIMEOUTS }) {
  let folderId = null;
  let creating = null; // the folder creation in flight: two parallel saves must not create it twice
  let refreshing = null; // single flight: several requests that fail with 401 together share ONE silent renewal

  const renew = () => {
    if (!refreshToken) return Promise.resolve(null);
    refreshing ??= Promise.resolve()
      .then(refreshToken)
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };

  async function send(url, init, token, limitMs) {
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = abort && limitMs > 0 ? setTimeout(() => abort.abort(), limitMs) : null;
    try {
      return await fetchImpl(url, { ...init, ...(abort ? { signal: abort.signal } : {}), headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    } catch {
      throw new DriveError('offline'); // no network, or the request took longer than its limit
    } finally {
      if (timer) clearTimeout(timer); // the answer arrived: the limit guards the wait for it
    }
  }

  async function reason403(res) {
    try {
      const body = await res.json();
      const text = JSON.stringify(body?.error ?? '').toLowerCase();
      if (text.includes('scope_insufficient') || text.includes('insufficient authentication scopes') || text.includes('insufficientpermissions')) return 'scope';
      if (text.includes('service_disabled') || text.includes('has not been used') || text.includes('is disabled')) return 'disabled';
    } catch {
      /* no readable body */
    }
    return 'limit';
  }

  async function call(url, init = {}, limitMs = timeouts.api) {
    const token = await getToken();
    if (!token) throw new DriveError('auth');
    let res = await send(url, init, token, limitMs);
    if (res.status === 401) {
      onAuthRejected(token);
      const fresh = await renew();
      if (!fresh || fresh === token) throw new DriveError('auth', 401);
      res = await send(url, init, fresh, limitMs); // the same request, with the new token: the user never notices
      if (res.status === 401) {
        onAuthRejected(fresh);
        throw new DriveError('auth', 401);
      }
    }
    if (res.status === 403) {
      // 403 is three different things: the token lacks a scope (the user must consent again), the API is switched off in the Google Cloud project
      // (retrying later cannot fix it: a plain failure), or a rate / quota limit (retry later). Unreadable body = the old rule: quota.
      const why = await reason403(res);
      if (why === 'scope') {
        onAuthRejected(token); // this token can never do it: forget it so the next session asks Google for the full set of scopes
        throw new DriveError('auth', 403);
      }
      throw new DriveError(why === 'disabled' ? 'http' : 'quota', 403);
    }
    if (res.status === 429) throw new DriveError('quota', 429);
    if (!res.ok) throw new DriveError('http', res.status);
    return res;
  }

  const json = async (url, init, limitMs) => {
    const res = await call(url, init, limitMs);
    try {
      return await res.json();
    } catch {
      throw new DriveError('bad_response');
    }
  };

  const list = async (q, fields) => {
    const params = new URLSearchParams({ q, fields, spaces: 'drive', orderBy: 'modifiedTime desc', pageSize: '20' });
    const data = await json(`${API}/files?${params}`);
    return Array.isArray(data?.files) ? data.files.filter((f) => ID_RE.test(String(f?.id))) : [];
  };

  const folderNamed = async (name) => {
    const [f] = await list(`mimeType='${FOLDER_MIME}' and name='${name}' and trashed=false`, 'files(id,name)');
    return f?.id ?? null;
  };

  /** The "CUBRAX - Respaldos Obra" folder id, or null when it does not exist (nothing is created). */
  async function findFolder() {
    if (folderId) return folderId;
    folderId = await folderNamed(BACKUP_FOLDER);
    return folderId;
  }

  /** The folder, created in the root of the user's Drive when missing (never twice, even with parallel saves). */
  async function ensureFolder() {
    const found = await findFolder();
    if (found) return found;
    creating ??= json(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: BACKUP_FOLDER, mimeType: FOLDER_MIME, parents: ['root'] }),
    })
      .then((created) => {
        if (!ID_RE.test(String(created?.id))) throw new DriveError('bad_response');
        folderId = created.id;
        return folderId;
      })
      .finally(() => {
        creating = null;
      });
    return creating;
  }

  const backupsIn = (id) => list(`'${id}' in parents and name='${BACKUP_FILE}' and trashed=false`, 'files(id,name,modifiedTime)');

  /** Create or overwrite the backup file inside the CUBRAX folder. Resolves { id, folderId }. */
  async function saveOnce(text) {
    const folder = await ensureFolder();
    const [existing] = await backupsIn(folder);
    if (existing) {
      const res = await json(`${UPLOAD}/files/${existing.id}?uploadType=media&fields=id,modifiedTime`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      }, timeouts.transfer);
      return { id: res?.id ?? existing.id, folderId: folder, modifiedTime: typeof res?.modifiedTime === 'string' ? res.modifiedTime : '' };
    }
    // ATOMIC: the file is born INSIDE the CUBRAX folder (`parents` in the metadata of this very POST). Never created in the root to be moved later: a
    // death between the two steps would leave an orphan in "Mi unidad".
    if (!ID_RE.test(String(folder))) throw new DriveError('bad_response');
    const boundary = `cubrax${Math.random().toString(36).slice(2)}`;
    const meta = JSON.stringify({ name: BACKUP_FILE, parents: [folder], mimeType: 'application/json' });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
    const res = await json(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }, timeouts.transfer);
    return { id: res?.id, folderId: folder, modifiedTime: typeof res?.modifiedTime === 'string' ? res.modifiedTime : '' };
  }

  // One mutation of the backup file at a time per client: the save of the backup and the silent tidy-up (driveSanitizer.js) never interleave, so the
  // concierge can never trash the very file that is being written. A failed task never blocks the next one.
  let tail = Promise.resolve();
  const serial = (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };

  async function saveBackup(text) {
    return serial(async () => {
      try {
        return await saveOnce(text);
      } catch (err) {
        if (err?.status !== 404) throw err; // the cached folder / file was deleted from Drive: look it up again once
        folderId = null;
        return saveOnce(text);
      }
    });
  }

  /**
   * Download the backups of the CUBRAX folder, newest first, until `accept(text)` returns a value (a damaged newest
   * file falls back to the previous one). Resolves { value, modifiedTime } or null when there is nothing usable.
   */
  async function readFrom(folder, accept) {
    for (const file of await backupsIn(folder)) {
      const res = await call(`${API}/files/${file.id}?alt=media`, {}, timeouts.transfer);
      const value = accept(await res.text());
      if (value) return { value, modifiedTime: file.modifiedTime || '' };
    }
    return null;
  }

  async function latestBackup(accept) {
    const folder = await findFolder();
    const found = folder ? await readFrom(folder, accept) : null;
    if (found) return found;
    // nothing usable in the app folder: the "CUBRAX" folder of the first versions is read (never written) so no copy is lost
    const legacy = await folderNamed(LEGACY_BACKUP_FOLDER);
    return legacy ? readFrom(legacy, accept) : null;
  }

  /**
   * Light existence check: ONLY file metadata (id, name, modifiedTime) is requested, the backup content is never downloaded.
   * Looks where `latestBackup` reads (the app folder, then the legacy "CUBRAX" one). Resolves { id, name, modifiedTime } or null.
   */
  async function peekBackup() {
    const folder = await findFolder();
    const [mine] = folder ? await backupsIn(folder) : [];
    if (mine) return mine;
    const legacy = await folderNamed(LEGACY_BACKUP_FOLDER);
    const [old] = legacy ? await backupsIn(legacy) : [];
    return old ?? null;
  }

  // ---- structured export (human-readable expediente): nested folders and plain files -------------------------------------------------
  // Folder ids are cached ("parent/name" -> id) and a lookup / creation in flight is shared, so the "Proyectos" folder is asked for ONCE
  // however many photos go up in parallel.
  const childIds = new Map();
  const childInflight = new Map();
  const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); // Drive query strings: \ and ' are escaped

  /** The folder `name` inside `parentId`, created when missing (never twice, even with parallel calls). */
  function ensureChildFolder(parentId, name) {
    const key = `${parentId}/${name}`;
    if (childIds.has(key)) return Promise.resolve(childIds.get(key));
    if (!childInflight.has(key)) {
      const job = (async () => {
        const [found] = await list(`mimeType='${FOLDER_MIME}' and name='${esc(name)}' and '${parentId}' in parents and trashed=false`, 'files(id,name)');
        let id = found?.id;
        if (!id) {
          const created = await json(`${API}/files?fields=id`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
          });
          if (!ID_RE.test(String(created?.id))) throw new DriveError('bad_response');
          id = created.id;
        }
        childIds.set(key, id);
        return id;
      })().finally(() => childInflight.delete(key));
      childInflight.set(key, job);
    }
    return childInflight.get(key);
  }

  /** "CUBRAX - Respaldos Obra" -> ...names. Resolves the id of the last folder (every level is looked up once, then cached). */
  async function ensureFolderPath(names) {
    let id = await ensureFolder();
    for (const name of names) id = await ensureChildFolder(id, name);
    return id;
  }

  /** The plain files inside a folder as Map(name -> { id, size }) (all pages: one query per hundreds of files, not one per file). */
  async function listFiles(parentId) {
    const out = new Map();
    let pageToken = '';
    for (let page = 0; page < 20; page += 1) {
      const params = new URLSearchParams({ q: `'${parentId}' in parents and mimeType!='${FOLDER_MIME}' and trashed=false`, fields: 'nextPageToken,files(id,name,size)', spaces: 'drive', pageSize: '1000' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await json(`${API}/files?${params}`);
      for (const f of Array.isArray(data?.files) ? data.files : []) if (ID_RE.test(String(f?.id)) && !out.has(f.name)) out.set(f.name, { id: f.id, size: Number(f.size) || 0 });
      pageToken = data?.nextPageToken || '';
      if (!pageToken) break;
    }
    return out;
  }

  /**
   * ATOMIC SAFE CREATION of a media file (photo, PDF, legacy xlsx): it is born INSIDE its folder, never in the root to be moved later.
   *   1. `parentId` must be a real folder id BEFORE a single byte leaves the device: an empty / unknown / 'root' parent is refused (a `parents` that is
   *      empty or "root" is exactly how a file ends up lying in "Mi unidad").
   *   2. `parents: [parentId]` travels in the metadata part of the very same multipart/related POST: one request, one place, no PATCH afterwards.
   *   3. Drive's answer is checked (`fields=id,parents`): if it ever reports the file somewhere else, it is put in its folder at once (silent healing).
   * With `existingId` the content of a file that is already in its folder is replaced (its place is not touched).
   * @returns {Promise<{ id: string }>}
   */
  async function uploadFile(parentId, { name, mimeType = 'application/octet-stream', bytes, existingId = '' }) {
    if (!isFolderId(parentId) || !bytes || typeof bytes.length !== 'number') throw new DriveError('bad_response'); // nothing is sent without a destination folder
    if (existingId) {
      if (!ID_RE.test(String(existingId))) throw new DriveError('bad_response');
      const res = await json(`${UPLOAD}/files/${existingId}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'Content-Type': mimeType }, body: bytes }, timeouts.transfer);
      return { id: res?.id ?? existingId };
    }
    const boundary = `cubrax${Math.random().toString(36).slice(2)}`;
    const enc = new TextEncoder();
    const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId], mimeType })}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
    const tail = enc.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);
    const res = await json(`${UPLOAD}/files?uploadType=multipart&fields=id,parents`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, timeouts.transfer);
    if (!ID_RE.test(String(res?.id))) throw new DriveError('bad_response');
    if (Array.isArray(res.parents) && !(res.parents.length === 1 && res.parents[0] === parentId)) {
      try {
        await moveInto(res.id, parentId); // it is not where it was asked to be: home, silently
      } catch {
        /* the file exists; the concierge / the next sync deal with it */
      }
    }
    return { id: res.id };
  }

  // ---- live Google Sheets (Sheets API v4) -----------------------------------------------------------------------------------------
  // The rendición is not a file we build: it is a Spreadsheet that lives in the user's Drive (a real, editable database).
  const quoteTab = (name) => `'${String(name).replace(/'/g, "''")}'`; // A1 notation: a whole tab, or  'Tab'!A1
  const post = (url, body) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, timeouts.transfer);
  const okParent = (id) => id === 'root' || ID_RE.test(String(id));

  const findSheet = async (parentId, title) => {
    const [f] = await list(`mimeType='${SHEET_MIME}' and name='${esc(title)}' and '${parentId}' in parents and trashed=false`, 'files(id,name)');
    return f?.id ?? null;
  };

  /** The Sheets API always creates in the root of the Drive: move the file into its folder (add the new parent, drop the old ones). */
  async function moveInto(id, parentId) {
    if (parentId === 'root') return;
    const meta = await json(`${API}/files/${id}?fields=parents`);
    const current = Array.isArray(meta?.parents) ? meta.parents.filter((x) => typeof x === 'string') : [];
    if (current.length === 1 && current[0] === parentId) return;
    const params = new URLSearchParams({ addParents: parentId, fields: 'id' });
    const drop = current.filter((x) => x !== parentId);
    if (drop.length) params.set('removeParents', drop.join(','));
    await json(`${API}/files/${id}?${params}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  }

  /** Every range of every tab, in requests of a bounded size. */
  function valueBatches(tabs) {
    const batches = [];
    let cur = [];
    let cells = 0;
    for (const tab of tabs) {
      for (let i = 0; i < tab.rows.length; i += SHEET_CHUNK_ROWS) {
        const values = tab.rows.slice(i, i + SHEET_CHUNK_ROWS);
        const size = values.reduce((n, r) => n + Math.max(1, r.length), 0);
        if (cur.length && cells + size > SHEET_CALL_CELLS) {
          batches.push(cur);
          cur = [];
          cells = 0;
        }
        cur.push({ range: `${quoteTab(tab.name)}!A${i + 1}`, majorDimension: 'ROWS', values });
        cells += size;
      }
    }
    if (cur.length) batches.push(cur);
    return batches;
  }

  /**
   * Create (or refresh in place) the Google Spreadsheet `title` inside the folder `parentId`.
   *   1. look for it by name in the folder (a second close refreshes the SAME Spreadsheet: never a duplicate);
   *   2. not there: POST spreadsheets (the tabs and their grid sizes go in the same request) -> spreadsheetId. A Spreadsheet created by an earlier attempt
   *      that died before moving it is adopted from the root instead of creating a second one;
   *   3. the Sheets API creates in the root of the Drive: PATCH it into `parentId` (drive v3 addParents / removeParents), BEFORE writing any data,
   *      so a retry after a failure always finds it in its folder;
   *   4. an existing Spreadsheet: add the missing tabs, grow the grids that are too small and clear the tabs we are about to rewrite (what the user
   *      typed in OTHER tabs or to the right of our columns is not touched, and a renamed tab is simply not ours any more);
   *   5. values:batchUpdate with valueInputOption RAW: text and numbers exactly as given, a text starting with "=" is data, never a formula.
   *   6. the visual design (sheetFormat.js: frozen header, bold centred headers, widths in pixels, currency format) in a batchUpdate AFTER the data. It is
   *      "nice-to-have": it can never fail the call (the data is already in the Sheet, a failed design must not send the export to the offline queue).
   * @param sheets  [{ name, rows: (string|number)[][] }]  (cleaned again here: only pure values ever leave the device)
   * @returns { id, created }
   */
  async function upsertSpreadsheet(parentId, { title, sheets }) {
    const tabs = toValueSheets(sheets);
    if (!okParent(parentId) || !tabs.length) throw new DriveError('bad_response');
    const name = sheetTitle(title);
    let id = await findSheet(parentId, name);
    let created = false;
    let misplaced = false;
    const sheetIds = new Map(); // tab title (lower case) -> the sheetId Google gave it: the design needs it
    const rememberTab = (p) => {
      if (p && typeof p.title === 'string' && Number.isInteger(p.sheetId)) sheetIds.set(p.title.toLowerCase(), p.sheetId);
    };
    if (!id && parentId !== 'root') {
      id = await findSheet('root', name);
      misplaced = Boolean(id);
    }
    if (!id) {
      const made = await post(`${SHEETS}?fields=spreadsheetId,sheets.properties(sheetId,title)`, { properties: { title: name }, sheets: tabs.map((t) => ({ properties: { title: t.name, gridProperties: gridFor(t) } })) });
      if (!ID_RE.test(String(made?.spreadsheetId))) throw new DriveError('bad_response');
      id = made.spreadsheetId;
      created = true;
      for (const sh of Array.isArray(made.sheets) ? made.sheets : []) rememberTab(sh?.properties);
      misplaced = true;
    }
    if (misplaced) await moveInto(id, parentId);

    if (!created) {
      const meta = await json(`${SHEETS}/${id}?fields=sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))`);
      const have = new Map((Array.isArray(meta?.sheets) ? meta.sheets : []).map((s) => s?.properties).filter((p) => p && typeof p.title === 'string').map((p) => [p.title.toLowerCase(), p]));
      const requests = [];
      const clear = [];
      for (const p of have.values()) rememberTab(p);
      for (const tab of tabs) {
        const grid = gridFor(tab);
        const mine = have.get(tab.name.toLowerCase());
        if (!mine) {
          requests.push({ addSheet: { properties: { title: tab.name, gridProperties: grid } } });
          continue;
        }
        clear.push(quoteTab(mine.title));
        const rows = Math.max(Number(mine.gridProperties?.rowCount) || 0, grid.rowCount);
        const cols = Math.max(Number(mine.gridProperties?.columnCount) || 0, grid.columnCount);
        if (rows !== Number(mine.gridProperties?.rowCount) || cols !== Number(mine.gridProperties?.columnCount)) {
          requests.push({ updateSheetProperties: { properties: { sheetId: mine.sheetId, gridProperties: { rowCount: rows, columnCount: cols } }, fields: 'gridProperties.rowCount,gridProperties.columnCount' } });
        }
      }
      if (requests.length) {
        const answer = await post(`${SHEETS}/${id}:batchUpdate`, { requests });
        requests.forEach((r, i) => rememberTab(r.addSheet && answer?.replies?.[i]?.addSheet?.properties)); // the tabs just added: Google answers each request in order
      }
      if (clear.length) await post(`${SHEETS}/${id}/values:batchClear`, { ranges: clear });
    }
    for (const data of valueBatches(tabs)) await post(`${SHEETS}/${id}/values:batchUpdate`, { valueInputOption: 'RAW', data });
    await designSpreadsheet(id, tabs, sheetIds); // never throws: the data is already safe
    return { id, created };
  }

  /** The visual design, right after the data. Silent by contract: whatever happens here, the export is a success (the values are in the Sheet). */
  async function designSpreadsheet(id, tabs, sheetIds) {
    try {
      if (tabs.some((t) => !sheetIds.has(t.name.toLowerCase()))) {
        // Google did not tell us every sheetId (a reply without them): read them once
        const meta = await json(`${SHEETS}/${id}?fields=sheets.properties(sheetId,title)`);
        for (const sh of Array.isArray(meta?.sheets) ? meta.sheets : []) if (sh?.properties && typeof sh.properties.title === 'string') sheetIds.set(sh.properties.title.toLowerCase(), sh.properties.sheetId);
      }
      const metadata = tabs.map((t) => ({ sheetId: sheetIds.get(t.name.toLowerCase()), widths: t.widths, moneyCols: t.moneyCols }));
      const currency = tabs.find((t) => t.currency)?.currency || '';
      const quick = (url, body) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, timeouts.api); // decoration: never worth a long wait
      await formatSpreadsheet({ post: quick }, id, metadata, currency);
    } catch {
      /* nice-to-have */
    }
  }

  // ---- primitives of the silent tidy-up (driveSanitizer.js) ---------------------------------------------------------------------------
  // With the drive.file scope Drive only ever shows the files THIS app created, and `'me' in owners` keeps even those to the user's own: the concierge
  // can never touch anything else of the Drive.
  const FILE_FIELDS = 'nextPageToken,files(id,name,mimeType,modifiedTime,size,parents)';
  const asFile = (f) => ({ id: f.id, name: String(f.name ?? ''), mimeType: typeof f.mimeType === 'string' ? f.mimeType : '', modifiedTime: typeof f.modifiedTime === 'string' ? f.modifiedTime : '', size: Number(f.size) || 0, parents: Array.isArray(f.parents) ? f.parents.filter((x) => typeof x === 'string') : [] });
  /** Every page (bounded) of a files query, newest first: [{ id, name, modifiedTime, size, parents }]. */
  async function listAll(q) {
    const out = [];
    let pageToken = '';
    for (let page = 0; page < 5; page += 1) {
      const params = new URLSearchParams({ q, fields: FILE_FIELDS, spaces: 'drive', orderBy: 'modifiedTime desc', pageSize: '100' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await json(`${API}/files?${params}`);
      for (const f of Array.isArray(data?.files) ? data.files : []) if (ID_RE.test(String(f?.id))) out.push(asFile(f));
      pageToken = data?.nextPageToken || '';
      if (!pageToken) break;
    }
    return out;
  }
  /** Every cubrax-backup.json of the user's Drive, wherever it is (root, the CUBRAX folder, the legacy folder), not in the trash. */
  const findBackups = () => listAll(`name='${BACKUP_FILE}' and mimeType!='${FOLDER_MIME}' and trashed=false and 'me' in owners`);
  /**
   * The Excel files (.xlsx) of the user's Drive that this app can see, wherever they are (root, project folders), not in the trash. Two queries, merged:
   * by Excel mimeType, and by name (an .xlsx uploaded by hand may carry another mimeType).
   */
  async function findExcelFiles() {
    const [byMime, byName] = await Promise.all([
      listAll(`mimeType='${XLSX_MIME}' and trashed=false and 'me' in owners`),
      listAll(`name contains 'xlsx' and mimeType!='${FOLDER_MIME}' and trashed=false and 'me' in owners`),
    ]);
    const seen = new Set();
    return [...byMime.map((f) => ({ ...f, mimeType: XLSX_MIME })), ...byName].filter((f) => (seen.has(f.id) ? false : seen.add(f.id))).filter((f) => f.mimeType === XLSX_MIME || /\.xlsx$/i.test(f.name));
  }
  /** EVERYTHING (not a folder, not in the trash) that Drive shows this app: only for the developer's log of the concierge (what it "sees"). */
  const listVisible = () => listAll(`mimeType!='${FOLDER_MIME}' and trashed=false and 'me' in owners`);

  /** The Spreadsheets directly inside `parentId` ('root' = My Drive), not in the trash. */
  const listSheets = (parentId) => {
    if (!okParent(parentId)) throw new DriveError('bad_response');
    return listAll(`mimeType='${SHEET_MIME}' and '${parentId}' in parents and trashed=false and 'me' in owners`);
  };
  /** The folders directly inside `parentId`: [{ id, name }]. */
  const listFolders = async (parentId) => {
    if (!okParent(parentId)) throw new DriveError('bad_response');
    return (await listAll(`mimeType='${FOLDER_MIME}' and '${parentId}' in parents and trashed=false and 'me' in owners`)).map((f) => ({ id: f.id, name: f.name }));
  };
  /** To the trash (recoverable for 30 days), never a permanent delete. */
  async function trashFile(id) {
    if (!ID_RE.test(String(id))) throw new DriveError('bad_response');
    await json(`${API}/files/${id}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  }
  const moveFile = (id, parentId) => {
    if (!ID_RE.test(String(id)) || !okParent(parentId)) throw new DriveError('bad_response');
    return moveInto(id, parentId);
  };

  /** A cached folder was deleted from Drive (404): forget every cached id so the next try looks them up again. */
  const forgetFolders = () => {
    folderId = null;
    childIds.clear();
  };

  return { findFolder, ensureFolder, ensureChildFolder, ensureFolderPath, listFiles, uploadFile, upsertSpreadsheet, forgetFolders, serial, findBackups, findExcelFiles, listVisible, listSheets, listFolders, trashFile, moveFile, saveBackup, latestBackup, peekBackup, forgetFolder: () => { folderId = null; } };
}
