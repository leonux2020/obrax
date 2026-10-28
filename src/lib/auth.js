// Google authentication.
//  - Production: set VITE_GOOGLE_CLIENT_ID and Google Identity Services (GIS) is used.
//  - Without a client id the app runs a clearly-labelled SIMULATION so it works out of the box.
// IMPORTANT for production: the ID token (credential) must also be verified SERVER-SIDE
// (signature, aud, iss, exp) before you trust it for anything beyond showing the user's name.

import { sanitizeText, sanitizeEmail, sanitizeAvatarUrl } from './sanitize.js';
import { getDriveToken, setDriveToken } from './driveToken.js';

const CLIENT_ID_RE = /^[\w-]+\.apps\.googleusercontent\.com$/;

/** The id as typed in the host's env panel: trimmed, without the quotes people paste around it, "undefined"/"null" = nothing. */
export const cleanClientId = (value) => {
  const id = String(value ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  return /^(undefined|null)$/i.test(id) ? '' : id;
};

/**
 * Is Google configured in THIS build? 'ok' | 'missing' (VITE_GOOGLE_CLIENT_ID is not defined: on Vercel it must exist when the build RUNS,
 * Vite bakes it into the bundle) | 'invalid' (defined, but not shaped like <number>-<hash>.apps.googleusercontent.com).
 */
export function googleConfigStatus(value) {
  const id = cleanClientId(value);
  if (!id) return 'missing';
  return CLIENT_ID_RE.test(id) ? 'ok' : 'invalid';
}

export const GOOGLE_CLIENT_ID = cleanClientId(import.meta.env?.VITE_GOOGLE_CLIENT_ID);
export const GOOGLE_CONFIG_STATUS = googleConfigStatus(import.meta.env?.VITE_GOOGLE_CLIENT_ID);
export const googleConfigured = GOOGLE_CONFIG_STATUS === 'ok';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

export function loadGsi(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      clearTimeout(timer);
      window.google?.accounts?.id ? resolve(window.google) : reject(new Error('gsi'));
    };
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error('offline'));
    };
    document.head.appendChild(s);
  });
}

export function decodeJwtPayload(token) {
  const part = String(token || '').split('.')[1];
  if (!part) throw new Error('bad token');
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Client-side sanity checks only (see note above about server verification). */
export function userFromCredential(credential, { clientId = GOOGLE_CLIENT_ID, now = Date.now() } = {}) {
  const p = decodeJwtPayload(credential);
  const issOk = p.iss === 'https://accounts.google.com' || p.iss === 'accounts.google.com';
  if (!issOk || p.aud !== clientId || typeof p.exp !== 'number' || p.exp * 1000 < now) {
    throw new Error('invalid credential');
  }
  return {
    provider: 'google',
    name: sanitizeText(p.name || p.given_name, 60) || 'Google',
    email: sanitizeEmail(p.email),
    picture: sanitizeAvatarUrl(p.picture),
  };
}

export const demoUser = () => ({ provider: 'demo', name: 'Usuario Demo', email: 'demo@cubrax.app', picture: '' });
export const guestUser = () => ({ provider: 'guest', name: 'Invitado', email: '', picture: '' });

/** Local profile: no account, no network. Name is optional and stays on this device. */
export const localUser = (name = '') => ({
  provider: 'local',
  name: sanitizeText(name, 60).trim() || 'Perfil local',
  email: '',
  picture: '',
});

// ---- Google Drive consent (the same native Google OAuth as the sign-in; no password is ever typed here) ----------
// `drive.file` only gives access to files the app itself creates, never to the rest of the user's Drive.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const driveError = (code) => Object.assign(new Error(`drive:${code}`), { code });

/**
 * Ask Google (consent pop-up of Google Identity Services) for access to the app's own Drive folder.
 * Resolves { granted: true } only when Google confirms the scope; rejects with an Error whose `code` is
 * 'not_configured' | 'offline' | 'denied' | 'popup' (the pop-up could not open). The access token is kept only while it is valid (driveToken.js): it is what the silent backup uses.
 * `prompt: 'none'` is the SILENT renewal (no screen: it works while Google still remembers the consent, else it rejects 'denied');
 * it gives up after `silentTimeoutMs` ('timeout') so a blocked silent request never leaves the backup waiting. `hint` (the Google
 * account e-mail) lets Google pick the right account without asking.
 */
export async function requestDriveAccess({ clientId = GOOGLE_CLIENT_ID, enabled = googleConfigured, load = loadGsi, prompt = '', hint = '', silentTimeoutMs = 15_000 } = {}) {
  if (!enabled) throw driveError('not_configured');
  let google;
  try {
    google = await load();
  } catch {
    throw driveError('offline');
  }
  const oauth = google?.accounts?.oauth2;
  if (!oauth?.initTokenClient) throw driveError('offline');
  return new Promise((resolve, reject) => {
    const timer = prompt === 'none' && silentTimeoutMs > 0 ? setTimeout(() => reject(driveError('timeout')), silentTimeoutMs) : null;
    const done = (fn) => (v) => {
      clearTimeout(timer);
      fn(v);
    };
    resolve = done(resolve);
    reject = done(reject);
    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      ...(hint ? { hint } : {}),
      callback: (resp) => {
        const ok = resp?.access_token && !resp.error && (typeof oauth.hasGrantedAllScopes !== 'function' || oauth.hasGrantedAllScopes(resp, DRIVE_SCOPE));
        if (ok) {
          setDriveToken(resp.access_token, resp.expires_in); // kept for this session only: it is what the silent backup uses
          resolve({ granted: true });
        } else reject(driveError('denied'));
      },
      // the pop-up could not open (blocked, in-app browser): the caller falls back to a full-page redirect
      error_callback: (e) => reject(driveError(e?.type === 'popup_failed_to_open' ? 'popup' : 'denied')),
    });
    client.requestAccessToken({ prompt });
  });
}

/**
 * A valid Drive token for the silent backup / restore. Uses the one already held; otherwise asks Google:
 * `interactive: false` never shows a screen (works only while Google still remembers the consent, else resolves
 * null), `interactive: true` may open the consent pop-up (call it from a tap). Never throws.
 */
export async function ensureDriveToken({ interactive = false, request = requestDriveAccess, hint = '' } = {}) {
  const held = getDriveToken();
  if (held) return held;
  // ONE request at a time (single flight): a backup round and a 401 renewal asking together share the same answer
  const key = interactive ? 'interactive' : 'silent';
  renewals[key] ??= (async () => {
    try {
      await request({ prompt: interactive ? '' : 'none', ...(hint ? { hint } : {}) });
    } catch {
      return null;
    } finally {
      renewals[key] = null;
    }
    return getDriveToken();
  })();
  return renewals[key];
}
const renewals = { silent: null, interactive: null };
