// Google Drive REST client for the CUBRAX backup: ONE dedicated folder ("CUBRAX - Respaldos Obra", created in the root of the
// user's Drive when it does not exist) holding ONE consolidated JSON file. The backup is written ONLY inside that folder
// (`parents`) and restored from it; the folder of the first versions ("CUBRAX") is only READ as a fallback so nobody loses
// the copy they already had.
// Scope is drive.file, so the app can only ever see the files it created itself (never the rest of the user's Drive).
// Pure of the browser: `fetchImpl`, `getToken` and `refreshToken` are injected so everything runs in Node tests.

export const BACKUP_FOLDER = 'CUBRAX - Respaldos Obra';
export const LEGACY_BACKUP_FOLDER = 'CUBRAX';
export const BACKUP_FILE = 'cubrax-backup.json';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ID_RE = /^[A-Za-z0-9_-]{5,200}$/;

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
export function createDriveClient({ getToken, refreshToken = null, onAuthRejected = () => {}, fetchImpl = (...a) => fetch(...a) }) {
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

  async function send(url, init, token) {
    try {
      return await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    } catch {
      throw new DriveError('offline');
    }
  }

  async function call(url, init = {}) {
    const token = await getToken();
    if (!token) throw new DriveError('auth');
    let res = await send(url, init, token);
    if (res.status === 401) {
      onAuthRejected(token);
      const fresh = await renew();
      if (!fresh || fresh === token) throw new DriveError('auth', 401);
      res = await send(url, init, fresh); // the same request, with the new token: the user never notices
      if (res.status === 401) {
        onAuthRejected(fresh);
        throw new DriveError('auth', 401);
      }
    }
    if (res.status === 403 || res.status === 429) throw new DriveError('quota', res.status);
    if (!res.ok) throw new DriveError('http', res.status);
    return res;
  }

  const json = async (url, init) => {
    const res = await call(url, init);
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
      const res = await json(`${UPLOAD}/files/${existing.id}?uploadType=media&fields=id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      });
      return { id: res?.id ?? existing.id, folderId: folder };
    }
    const boundary = `cubrax${Math.random().toString(36).slice(2)}`;
    const meta = JSON.stringify({ name: BACKUP_FILE, parents: [folder], mimeType: 'application/json' });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
    const res = await json(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return { id: res?.id, folderId: folder };
  }

  async function saveBackup(text) {
    try {
      return await saveOnce(text);
    } catch (err) {
      if (err?.status !== 404) throw err; // the cached folder / file was deleted from Drive: look it up again once
      folderId = null;
      return saveOnce(text);
    }
  }

  /**
   * Download the backups of the CUBRAX folder, newest first, until `accept(text)` returns a value (a damaged newest
   * file falls back to the previous one). Resolves { value, modifiedTime } or null when there is nothing usable.
   */
  async function readFrom(folder, accept) {
    for (const file of await backupsIn(folder)) {
      const res = await call(`${API}/files/${file.id}?alt=media`);
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

  /** Create (or overwrite, when `existingId` is given) a binary file. `bytes` is a Uint8Array. Resolves { id }. */
  async function uploadFile(parentId, { name, mimeType = 'application/octet-stream', bytes, existingId = '' }) {
    if (existingId) {
      const res = await json(`${UPLOAD}/files/${existingId}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'Content-Type': mimeType }, body: bytes });
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
    const res = await json(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    if (!ID_RE.test(String(res?.id))) throw new DriveError('bad_response');
    return { id: res.id };
  }

  /** A cached folder was deleted from Drive (404): forget every cached id so the next try looks them up again. */
  const forgetFolders = () => {
    folderId = null;
    childIds.clear();
  };

  return { findFolder, ensureFolder, ensureChildFolder, ensureFolderPath, listFiles, uploadFile, forgetFolders, saveBackup, latestBackup, peekBackup, forgetFolder: () => { folderId = null; } };
}
