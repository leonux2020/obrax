// The Google Drive access token (OAuth, scope drive.file). Google Identity Services issues NO refresh token to a browser app
// (that needs a server secret), so the token is short-lived (≈1 h) and the "persistent login" is built from two pieces:
//   - the token itself, kept while it is valid: in memory, mirrored in sessionStorage (a reload / OAuth redirect keeps it) and in
//     localStorage (closing and reopening the PWA keeps it). It is bound to its own expiry: an expired, refused (401) or signed-out
//     token is erased from every place (session.js wipes localStorage at sign-out). drive.file can only touch files the app created.
//   - the "linked" flag: this device has consented before, so a NEW token is requested silently (prompt: 'none') without any screen.

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
const local = () => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export function setDriveToken(token, expiresInSec = 3600, { storage = session(), now = Date.now(), linked = local() } = {}) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return false;
  const secs = Number(expiresInSec);
  const rec = { token, exp: now + (Number.isFinite(secs) && secs > 0 ? Math.min(secs, 3600) : 3600) * 1000 - SAFETY_MS };
  memory = rec;
  try {
    storage?.setItem(DRIVE_TOKEN_KEY, JSON.stringify(rec));
    if (linked && linked !== storage) linked.setItem(DRIVE_TOKEN_KEY, JSON.stringify(rec)); // survives closing the PWA while valid
    linked?.setItem(DRIVE_LINKED_KEY, '1');
  } catch {
    /* memory only */
  }
  return true;
}

/** The current valid token, or null. */
export function getDriveToken({ storage = session(), now = Date.now(), persistent = local() } = {}) {
  let rec = memory;
  if (!rec) {
    for (const store of [storage, persistent]) {
      try {
        const raw = JSON.parse(store?.getItem(DRIVE_TOKEN_KEY) ?? 'null');
        if (raw && typeof raw.token === 'string' && TOKEN_RE.test(raw.token) && Number.isFinite(raw.exp) && raw.exp > now) {
          rec = raw;
          break;
        }
      } catch {
        /* unreadable copy: the next store / null */
      }
    }
  }
  if (!rec || rec.exp <= now) {
    clearDriveToken({ storage, persistent });
    return null;
  }
  memory = rec;
  return rec.token;
}

export function clearDriveToken({ storage = session(), persistent = local() } = {}) {
  memory = null;
  for (const store of [storage, persistent]) {
    try {
      store?.removeItem?.(DRIVE_TOKEN_KEY);
    } catch {
      /* ignore */
    }
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
