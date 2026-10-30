// The Google Drive access token (OAuth, scope drive.file). Google Identity Services issues NO refresh token to a browser app
// (that needs a server secret), so the token is short-lived (≈1 h) and the "persistent login" is built from two pieces:
//   - the token itself, kept while it is valid: in memory, mirrored in sessionStorage (a reload / OAuth redirect keeps it) and in
//     localStorage (closing and reopening the PWA keeps it). It is bound to its own expiry: an expired, refused (401) or signed-out
//     token is erased from every place (session.js wipes localStorage at sign-out). drive.file can only touch files the app created.
//   - the "linked" flag: this device has consented before, so a NEW token is requested silently (prompt: 'none') without any screen.
//   - the "needs interaction" flag: Google answered a silent request with interaction_required / consent_required (or the silent request
//     could not finish). From then on NOTHING automatic asks Google again (no flash of accounts.google.com on boot or in the background);
//     only a tap of the user ("Enviar a Drive", "Reconectar Drive") may open the Google window, and a new token clears the flag.

export const DRIVE_TOKEN_KEY = 'cp.drive.token.v1';
export const DRIVE_LINKED_KEY = 'cp.drive.linked.v1'; // "this device has been connected to Drive before" (no secret): allows silent re-connection
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{10,4096}$/;
const SAFETY_MS = 60_000; // treat the token as expired a minute early

export const DRIVE_INTERACTION_KEY = 'cp.drive.needsInteraction.v1';

let memory = null;
let needsFlag = null; // null = not read yet
const authListeners = new Set();

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

/** Does Google need the user's hands before it gives a token again? (persisted: it survives closing the PWA) */
export function needsDriveInteraction({ store = local() } = {}) {
  if (needsFlag === null) {
    try {
      needsFlag = store?.getItem(DRIVE_INTERACTION_KEY) === '1';
    } catch {
      needsFlag = false;
    }
  }
  return needsFlag;
}

function setNeeds(value, store = local()) {
  const changed = needsDriveInteraction({ store }) !== value;
  needsFlag = value;
  try {
    if (value) store?.setItem(DRIVE_INTERACTION_KEY, '1');
    else store?.removeItem(DRIVE_INTERACTION_KEY);
  } catch {
    /* memory only */
  }
  if (changed) authListeners.forEach((fn) => fn());
}
export const markDriveNeedsInteraction = (opts) => setNeeds(true, opts?.store);
export const clearDriveNeedsInteraction = (opts) => setNeeds(false, opts?.store);
/** For useSyncExternalStore: tells the screens (the "Reconectar Drive" button) when the flag changes. */
export function subscribeDriveAuth(fn) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}
/** Test hook: forget the in-memory copy so the next read goes to storage again. */
export const resetDriveAuthState = () => {
  needsFlag = null;
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
  if (needsFlag !== false) clearDriveNeedsInteraction({ store: linked }); // a token in hand: Google is reachable again
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
