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

  return { findFolder, ensureFolder, saveBackup, latestBackup, forgetFolder: () => { folderId = null; } };
}
