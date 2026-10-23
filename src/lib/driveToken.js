// The Google Drive access token (OAuth, scope drive.file). It is short-lived (≈1 h) and is kept ONLY for the
// current browser session: in memory, mirrored in sessionStorage so a full-page OAuth redirect or a reload does not
// lose it. It is never written to localStorage / IndexedDB, and signing out erases it (see session.js).

export const DRIVE_TOKEN_KEY = 'cp.drive.token.v1';
export const DRIVE_LINKED_KEY = 'cp.drive.linked.v1'; // "this device has been connected to Drive before" (no secret): allows silent re-connection
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{10,4096}$/;
const SAFETY_MS = 60_000; // treat the token as expired a minute early

let memory = null;

const session = () => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};

/** Remember a token returned by Google. Returns true when it was accepted. */
export function setDriveToken(token, expiresInSec = 3600, { storage = session(), now = Date.now(), linked = typeof localStorage === 'undefined' ? null : localStorage } = {}) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return false;
  const secs = Number(expiresInSec);
  const rec = { token, exp: now + (Number.isFinite(secs) && secs > 0 ? Math.min(secs, 3600) : 3600) * 1000 - SAFETY_MS };
  memory = rec;
  try {
    storage?.setItem(DRIVE_TOKEN_KEY, JSON.stringify(rec));
    linked?.setItem(DRIVE_LINKED_KEY, '1');
  } catch {
    /* memory only */
  }
  return true;
}

/** The current valid token, or null. */
export function getDriveToken({ storage = session(), now = Date.now() } = {}) {
  let rec = memory;
  if (!rec) {
    try {
      const raw = JSON.parse(storage?.getItem(DRIVE_TOKEN_KEY) ?? 'null');
      if (raw && typeof raw.token === 'string' && TOKEN_RE.test(raw.token) && Number.isFinite(raw.exp)) rec = raw;
    } catch {
      rec = null;
    }
  }
  if (!rec || rec.exp <= now) {
    clearDriveToken({ storage });
    return null;
  }
  memory = rec;
  return rec.token;
}

export function clearDriveToken({ storage = session() } = {}) {
  memory = null;
  try {
    storage?.removeItem?.(DRIVE_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Has this device ever been connected to Drive? (then a silent token request is worth trying) */
export function isDriveLinked({ linked = typeof localStorage === 'undefined' ? null : localStorage } = {}) {
  try {
    return linked?.getItem(DRIVE_LINKED_KEY) === '1';
  } catch {
    return false;
  }
}
