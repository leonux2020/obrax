// @vitest-environment happy-dom
// Installed apps (PWA) never see a Google pop-up: consent and sign-in are full-page redirects; every change goes up to Drive by itself
// (workers included) and a passive cloud badge tells the contractor it is safe.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/lib/i18n.jsx';
import { ensureDriveToken, requestDriveAccess } from '../src/lib/auth.js';
import { clearDriveToken } from '../src/lib/driveToken.js';
import { OAUTH_KEYS, clearSignInResult, consumeOAuthCallback, peekSignInResult, startSignInRedirect } from '../src/lib/oauthCallback.js';
import { onWorkersChanged, removeWorker, saveWorkers, upsertWorker } from '../src/lib/workers.js';
import { BackupStatusContext, backupBadgeState } from '../src/lib/backupStatus.jsx';
import BackupBadge from '../src/components/BackupBadge.jsx';
import GoogleButton from '../src/components/GoogleButton.jsx';

const CID = 'cid-123.apps.googleusercontent.com';
const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const idToken = (extra = {}) => `${b64({ alg: 'RS256' })}.${b64({ iss: 'https://accounts.google.com', aud: CID, exp: 4_000_000_000, name: 'Marco Rossi', email: 'marco@example.com', ...extra })}.sig`;
const loc = (hash) => ({ hash, search: '', pathname: '/' });

describe('installed app: no pop-up, redirect from the start', () => {
  it('interactive consent refuses with "popup" at once (Google is never even loaded)', async () => {
    const load = vi.fn();
    await expect(requestDriveAccess({ clientId: CID, enabled: true, load, popups: false })).rejects.toMatchObject({ code: 'popup' });
    expect(load).not.toHaveBeenCalled();
  });
  it('the silent renewal is not turned into a window', async () => {
    const load = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(requestDriveAccess({ clientId: CID, enabled: true, load, popups: false, prompt: 'none' })).rejects.toMatchObject({ code: 'offline' });
    expect(load).toHaveBeenCalled();
  });
  it('a tap (interactive ensureDriveToken) whose pop-up cannot open goes to the redirect; a silent call never does', async () => {
    clearDriveToken();
    const redirect = vi.fn();
    const request = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'popup' }));
    expect(await ensureDriveToken({ interactive: true, request, redirect })).toBeNull();
    expect(redirect).toHaveBeenCalledTimes(1);
    clearDriveToken();
    expect(await ensureDriveToken({ interactive: false, request, redirect })).toBeNull();
    expect(redirect).toHaveBeenCalledTimes(1);
    clearDriveToken();
  });
});

describe('sign-in by redirect', () => {
  const start = (storage) => {
    const go = vi.fn();
    const state = startSignInRedirect({ clientId: CID, redirectUri: 'https://app.test/', storage, go, now: 1000 });
    const url = new URL(go.mock.calls[0][0]);
    return { state, url, nonce: url.searchParams.get('nonce') };
  };
  it('asks Google for an ID token with state + nonce', () => {
    const { url, state, nonce } = start(mem());
    expect(url.searchParams.get('response_type')).toBe('id_token');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/');
    expect(url.searchParams.get('state')).toBe(state);
    expect(nonce.length).toBeGreaterThanOrEqual(16);
  });
  it('on return: validates, cleans the address and hands over the account once', () => {
    const storage = mem();
    const { state, nonce } = start(storage);
    const hist = { replaceState: vi.fn() };
    const r = consumeOAuthCallback({ loc: loc(`#id_token=${idToken({ nonce })}&state=${state}`), hist, storage, now: 2000, clientId: CID });
    expect(r).toMatchObject({ kind: 'signin', granted: true });
    expect(hist.replaceState).toHaveBeenCalled();
    expect(peekSignInResult(storage)).toEqual({ user: expect.objectContaining({ provider: 'google', name: 'Marco Rossi', email: 'marco@example.com' }) });
    expect(storage.getItem(OAUTH_KEYS.result)).toBeNull(); // not mistaken for a Drive answer
    clearSignInResult(storage);
    expect(peekSignInResult(storage)).toBeNull();
  });
  it('refuses a wrong nonce, a wrong state and a user who said no', () => {
    let storage = mem();
    let s = start(storage);
    consumeOAuthCallback({ loc: loc(`#id_token=${idToken({ nonce: 'other' })}&state=${s.state}`), hist: {}, storage, now: 2000, clientId: CID });
    expect(peekSignInResult(storage)).toEqual({ user: null, error: 'nonce' });

    storage = mem();
    s = start(storage);
    consumeOAuthCallback({ loc: loc(`#id_token=${idToken({ nonce: s.nonce })}&state=forged`), hist: {}, storage, now: 2000, clientId: CID });
    expect(peekSignInResult(storage)).toEqual({ user: null, error: 'state' });

    storage = mem();
    s = start(storage);
    consumeOAuthCallback({ loc: loc(`#error=access_denied&state=${s.state}`), hist: {}, storage, now: 2000, clientId: CID });
    expect(peekSignInResult(storage)).toEqual({ user: null, error: 'denied' });
  });
  it('a token for another app (audience) is refused', () => {
    const storage = mem();
    const s = start(storage);
    consumeOAuthCallback({ loc: loc(`#id_token=${idToken({ nonce: s.nonce, aud: 'someone-else' })}&state=${s.state}`), hist: {}, storage, now: 2000, clientId: CID });
    expect(peekSignInResult(storage)?.user).toBeNull();
  });
});

describe('the Google button in an installed app', () => {
  const html = (props) => renderToStaticMarkup(React.createElement(I18nProvider, { lang: 'es' }, React.createElement(GoogleButton, { onUser() {}, clientId: CID, enabled: true, ...props })));
  it('is a plain redirect button (no pop-up widget)', () => {
    const out = html({ redirect: true });
    expect(out).toContain('data-testid="google-redirect"');
    expect(out).toContain('Continuar con Google');
  });
  it('keeps the official pop-up button in a normal browser', () => {
    const out = html({ redirect: false });
    expect(out).not.toContain('google-redirect');
  });
});

describe('workers are part of the invisible backup', () => {
  beforeEach(() => localStorage.clear());
  it('every write of the directory notifies listeners; unsubscribe stops it', () => {
    const fn = vi.fn();
    const off = onWorkersChanged(fn);
    const w = upsertWorker({ name: 'Luca Bianchi', trade: 'electricista' });
    expect(fn).toHaveBeenCalledTimes(1);
    saveWorkers([]);
    expect(fn).toHaveBeenCalledTimes(2);
    if (w?.id) removeWorker(w.id);
    const n = fn.mock.calls.length;
    off();
    upsertWorker({ name: 'Otro', trade: 'pintor' });
    expect(fn).toHaveBeenCalledTimes(n);
  });
  it('a throwing listener never breaks the save', () => {
    const off = onWorkersChanged(() => {
      throw new Error('boom');
    });
    expect(() => upsertWorker({ name: 'Ana', trade: 'albañil' })).not.toThrow();
    off();
  });
});

describe('passive cloud badge', () => {
  const base = { enabled: true, status: 'idle', reason: '', dirty: false, at: 0, held: false };
  it('state table', () => {
    expect(backupBadgeState(null)).toBeNull();
    expect(backupBadgeState({ ...base, enabled: false, at: 5 })).toBeNull();
    expect(backupBadgeState(base)).toBeNull(); // never backed up: nothing to say
    expect(backupBadgeState({ ...base, at: 5 })).toBe('synced');
    expect(backupBadgeState({ ...base, status: 'synced', at: 5 })).toBe('synced');
    expect(backupBadgeState({ ...base, status: 'synced', at: 5, dirty: true })).toBe('syncing');
    expect(backupBadgeState({ ...base, status: 'syncing' })).toBe('syncing');
    expect(backupBadgeState({ ...base, status: 'pending', dirty: true, reason: 'offline' })).toBe('pending');
    expect(backupBadgeState({ ...base, at: 5, held: true })).toBeNull();
  });
  const html = (value, lang = 'es') => renderToStaticMarkup(React.createElement(I18nProvider, { lang }, React.createElement(BackupStatusContext.Provider, { value }, React.createElement(BackupBadge))));
  it('synced = green cloud with a check, read as text for screen readers; never a button', () => {
    const out = html({ ...base, status: 'synced', at: 5 });
    expect(out).toContain('data-testid="backup-badge"');
    expect(out).toContain('data-state="synced"');
    expect(out).toContain('text-brand-500');
    expect(out).toContain('aria-label="Respaldo en la nube al día"');
    expect(out).not.toContain('<button');
  });
  it('syncing and pending have their own look and wording; absent without a provider or when backup is off', () => {
    expect(html({ ...base, status: 'syncing' })).toContain('data-state="syncing"');
    const p = html({ ...base, status: 'pending', reason: 'offline', dirty: true }, 'en');
    expect(p).toContain('data-state="pending"');
    expect(p).toContain('text-amber-500');
    expect(p).toContain('offline');
    expect(html({ ...base, enabled: false, at: 5 })).toBe('');
    expect(renderToStaticMarkup(React.createElement(I18nProvider, { lang: 'es' }, React.createElement(BackupBadge)))).toBe('');
  });
});
