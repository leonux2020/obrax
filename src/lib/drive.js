// Google Drive REST client for the CUBRAX backup: ONE dedicated folder ("CUBRAX") holding ONE consolidated JSON file.
// Scope is drive.file, so the app can only ever see the files it created itself (never the rest of the user's Drive).
// Pure of the browser: `fetchImpl` and `getToken` are injected so everything runs in Node tests.

export const BACKUP_FOLDER = 'CUBRAX';
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

export function createDriveClient({ getToken, onAuthRejected = () => {}, fetchImpl = (...a) => fetch(...a) }) {
  let folderId = null;

  async function call(url, init = {}) {
    const token = await getToken();
    if (!token) throw new DriveError('auth');
    let res;
    try {
      res = await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    } catch {
      throw new DriveError('offline');
    }
    if (res.status === 401) {
      onAuthRejected();
      throw new DriveError('auth', 401);
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

  /** The CUBRAX folder id, or null when it does not exist (nothing is created). */
  async function findFolder() {
    if (folderId) return folderId;
    const [f] = await list(`mimeType='${FOLDER_MIME}' and name='${BACKUP_FOLDER}' and trashed=false`, 'files(id,name)');
    folderId = f?.id ?? null;
    return folderId;
  }

  async function ensureFolder() {
    const found = await findFolder();
    if (found) return found;
    const created = await json(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: BACKUP_FOLDER, mimeType: FOLDER_MIME }),
    });
    if (!ID_RE.test(String(created?.id))) throw new DriveError('bad_response');
    folderId = created.id;
    return folderId;
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
  async function latestBackup(accept) {
    const folder = await findFolder();
    if (!folder) return null;
    for (const file of await backupsIn(folder)) {
      const res = await call(`${API}/files/${file.id}?alt=media`);
      const value = accept(await res.text());
      if (value) return { value, modifiedTime: file.modifiedTime || '' };
    }
    return null;
  }

  return { findFolder, ensureFolder, saveBackup, latestBackup, forgetFolder: () => { folderId = null; } };
}
