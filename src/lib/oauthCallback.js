// Google OAuth return path (Drive consent) when the browser has to LEAVE the app to Google and come back
// (pop-up blocked, in-app browsers, installed PWA...). Google sends the user back to the app's own address with
// the answer in the URL (`#access_token=...&state=...` or `#error=...`). That answer must be caught BEFORE the app
// renders: otherwise the page boots on an address it does not understand and the user is left on a blank screen.
//
//   startDriveRedirect()   -> remembers a random `state` and sends the browser to Google's consent page
//   consumeOAuthCallback() -> (called in main.jsx, before React) validates `state`, moves the token to the
//                             session-only token store (the result record only says "consent granted"), cleans the address bar and stores a small result
//   peekOAuthResult() / clearOAuthResult() -> the app reads that result once it is mounted
//
// The access token is NEVER left in the address bar or in the stored result: it goes to driveToken.js, which keeps it for
// this browser session only (memory + sessionStorage) so the silent Drive backup can use it.

import { DRIVE_SCOPE, GOOGLE_CLIENT_ID, requestDriveAccess, userFromCredential } from './auth.js';
import { setDriveToken } from './driveToken.js';

export const OAUTH_KEYS = Object.freeze({ state: 'cp.oauth.state', result: 'cp.oauth.result', signin: 'cp.oauth.signin', setup: 'cp.setup.draft' });
const STATE_TTL_MS = 10 * 60 * 1000;

const session = () => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};

const randomState = () => {
  try {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
};

/** Send the browser to Google's consent page; the answer comes back to `redirectUri` (the app itself). */
export function startDriveRedirect({ clientId = GOOGLE_CLIENT_ID, redirectUri = typeof location === 'undefined' ? '' : `${location.origin}/`, storage = session(), go = (url) => location.assign(url), now = Date.now() } = {}) {
  const state = randomState();
  storage?.setItem(OAUTH_KEYS.state, JSON.stringify({ state, at: now }));
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: DRIVE_SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  go(`https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`);
  return state;
}

/**
 * Identity sign-in by FULL-PAGE redirect (installed PWAs: the pop-up of Google's button opens on a blank screen there and never comes back).
 * `response_type=id_token` + a random `nonce`: the returned ID token must carry the very nonce we sent, so a token minted for someone else is refused.
 */
export function startSignInRedirect({ clientId = GOOGLE_CLIENT_ID, redirectUri = typeof location === 'undefined' ? '' : `${location.origin}/`, storage = session(), go = (url) => location.assign(url), now = Date.now() } = {}) {
  const state = randomState();
  const nonce = randomState();
  storage?.setItem(OAUTH_KEYS.state, JSON.stringify({ state, nonce, kind: 'signin', at: now }));
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'id_token', scope: 'openid email profile', nonce, state, prompt: 'select_account' });
  go(`https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`);
  return state;
}

const readJson = (storage, key) => {
  try {
    return JSON.parse(storage?.getItem(key) ?? 'null');
  } catch {
    return null;
  }
};

/**
 * Look at the address the app was opened with. If it carries a Google OAuth answer, validate it, clean the
 * address and store { kind: 'drive', granted, error? }. Returns that result, or null when this is a normal start.
 */
export function consumeOAuthCallback({ loc = typeof location === 'undefined' ? null : location, hist = typeof history === 'undefined' ? null : history, storage = session(), now = Date.now(), clientId = GOOGLE_CLIENT_ID } = {}) {
  if (!loc) return null;
  const params = new URLSearchParams((loc.hash || '').replace(/^#/, ''));
  for (const [k, v] of new URLSearchParams(loc.search || '')) if (!params.has(k)) params.set(k, v);
  const hasToken = params.has('access_token');
  const hasIdToken = params.has('id_token');
  const hasError = params.has('error') && params.has('state');
  if (!hasToken && !hasIdToken && !hasError) return null;

  // Whatever happens next, the answer (a bearer token!) must not stay in the address bar / history.
  const clean = loc.pathname || '/';
  try {
    hist?.replaceState?.(null, '', clean);
  } catch {
    /* read-only history: nothing else to do */
  }

  const saved = readJson(storage, OAUTH_KEYS.state);
  storage?.removeItem?.(OAUTH_KEYS.state);
  const stateOk = Boolean(saved?.state) && saved.state === params.get('state') && now - (saved.at || 0) < STATE_TTL_MS;
  if (saved?.kind === 'signin') {
    // the answer to a sign-in redirect: the account (validated like the pop-up's credential: issuer, audience, expiry + our nonce) or the reason it failed
    let outcome = { error: !stateOk ? 'state' : 'denied' };
    if (stateOk && hasIdToken && !params.has('error')) {
      try {
        const user = userFromCredential(params.get('id_token'), { clientId, now });
        const payload = JSON.parse(atob(params.get('id_token').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        outcome = payload.nonce && payload.nonce === saved.nonce ? { user } : { error: 'nonce' };
      } catch {
        outcome = { error: 'invalid' };
      }
    }
    try {
      storage?.setItem(OAUTH_KEYS.signin, JSON.stringify(outcome));
    } catch {
      /* storage unavailable */
    }
    return { kind: 'signin', granted: Boolean(outcome.user), ...(outcome.error ? { error: outcome.error } : {}) };
  }
  const result = !stateOk ? { kind: 'drive', granted: false, error: 'state' } : hasToken && !params.has('error') ? { kind: 'drive', granted: true } : { kind: 'drive', granted: false, error: 'denied' };
  // the result record keeps only the outcome; the token goes to its own session-only store
  if (result.granted) setDriveToken(params.get('access_token'), Number(params.get('expires_in')), { storage, now });
  try {
    storage?.setItem(OAUTH_KEYS.result, JSON.stringify(result));
  } catch {
    /* storage unavailable */
  }
  return result;
}

export const peekOAuthResult = (storage = session()) => {
  const r = readJson(storage, OAUTH_KEYS.result);
  return r && r.kind === 'drive' ? { kind: 'drive', granted: r.granted === true, error: typeof r.error === 'string' ? r.error : '' } : null;
};
/** The account chosen in a sign-in redirect: { user } or { user: null, error } ; null when the app did not just come back from one. */
export const peekSignInResult = (storage = session()) => {
  const r = readJson(storage, OAUTH_KEYS.signin);
  if (!r || typeof r !== 'object') return null;
  return r.user && typeof r.user === 'object' ? { user: r.user } : { user: null, error: typeof r.error === 'string' ? r.error : 'denied' };
};
export const clearSignInResult = (storage = session()) => storage?.removeItem?.(OAUTH_KEYS.signin);
export const clearOAuthResult = (storage = session()) => storage?.removeItem?.(OAUTH_KEYS.result);

// The setup form is kept while the browser is away at Google, so nothing the user typed is lost on return.
const SETUP_FIELDS = ['name', 'taxId', 'phone', 'email', 'city', 'proName', 'proTaxId'];
export function saveSetupDraft(form, storage = session()) {
  try {
    const out = {};
    for (const k of SETUP_FIELDS) if (typeof form?.[k] === 'string') out[k] = form[k].slice(0, 120);
    storage?.setItem(OAUTH_KEYS.setup, JSON.stringify(out));
  } catch {
    /* ignore */
  }
}
export function takeSetupDraft(storage = session()) {
  const raw = readJson(storage, OAUTH_KEYS.setup);
  storage?.removeItem?.(OAUTH_KEYS.setup);
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const k of SETUP_FIELDS) if (typeof raw[k] === 'string') out[k] = raw[k].slice(0, 120);
  return out;
}

/**
 * The Drive request the screens use: Google's pop-up first (never in an installed app, which blocks it: requestDriveAccess refuses with 'popup'
 * at once there); if the browser cannot open it, the same consent through a full-page redirect (the answer is caught by `consumeOAuthCallback` on return). In that case it rejects with
 * code 'redirect' (the page is leaving) so the caller just keeps its "waiting for Google" state.
 */
export async function connectDrive({ request = requestDriveAccess, redirect = startDriveRedirect, beforeRedirect } = {}) {
  try {
    return await request();
  } catch (err) {
    if (err?.code !== 'popup') throw err;
    beforeRedirect?.();
    redirect();
    throw Object.assign(new Error('drive:redirect'), { code: 'redirect' });
  }
}
