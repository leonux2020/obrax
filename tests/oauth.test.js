// @vitest-environment happy-dom
// Google OAuth return path: the answer in the address is caught, validated, stripped of its token and the app
// lands cleanly on setup / dashboard (never a blank screen).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import { OAUTH_KEYS, consumeOAuthCallback, startDriveRedirect, connectDrive, peekOAuthResult, clearOAuthResult, saveSetupDraft, takeSetupDraft } from '../src/lib/oauthCallback.js';
import { DRIVE_SCOPE } from '../src/lib/auth.js';
import { loadProfileMeta } from '../src/lib/draft.js';
import fs from 'node:fs';
import path from 'node:path';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const loc = (hash = '', search = '') => ({ hash, search, pathname: '/' });

describe('startDriveRedirect', () => {
  it('stores a random state and sends the browser to Google with the Drive scope and the app as redirect', () => {
    const storage = mem();
    const go = vi.fn();
    const state = startDriveRedirect({ clientId: 'cid.apps.googleusercontent.com', redirectUri: 'http://localhost:3000/', storage, go, now: 5 });
    const url = new URL(go.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe(DRIVE_SCOPE);
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/');
    expect(url.searchParams.get('response_type')).toBe('token');
    expect(url.searchParams.get('state')).toBe(state);
    expect(state.length).toBeGreaterThanOrEqual(16);
    expect(JSON.parse(storage.getItem(OAUTH_KEYS.state))).toEqual({ state, at: 5 });
  });
});

describe('consumeOAuthCallback', () => {
  const setup = () => {
    const storage = mem();
    const hist = { replaceState: vi.fn() };
    const go = vi.fn();
    const state = startDriveRedirect({ clientId: 'c.apps.googleusercontent.com', redirectUri: 'http://x/', storage, go, now: 1000 });
    return { storage, hist, state };
  };

  it('a normal start is left alone', () => {
    const { storage, hist } = setup();
    expect(consumeOAuthCallback({ loc: loc(''), hist, storage })).toBeNull();
    expect(consumeOAuthCallback({ loc: loc('#/algo', '?lang=es'), hist, storage })).toBeNull();
    expect(hist.replaceState).not.toHaveBeenCalled();
  });

  it('a valid token answer: outcome kept, token dropped, address cleaned, state used once', () => {
    const { storage, hist, state } = setup();
    const res = consumeOAuthCallback({ loc: loc(`#access_token=SECRET-TOKEN&token_type=Bearer&expires_in=3599&state=${state}&scope=x`), hist, storage, now: 2000 });
    expect(res).toEqual({ kind: 'drive', granted: true });
    expect(hist.replaceState).toHaveBeenCalledWith(null, '', '/');
    expect(storage.getItem(OAUTH_KEYS.state)).toBeNull();
    expect(JSON.stringify([...storage.m])).not.toContain('SECRET-TOKEN');
    expect(peekOAuthResult(storage)).toEqual({ kind: 'drive', granted: true, error: '' });
    clearOAuthResult(storage);
    expect(peekOAuthResult(storage)).toBeNull();
    // replaying the same answer fails: the state was consumed
    expect(consumeOAuthCallback({ loc: loc(`#access_token=T&state=${state}`), hist, storage, now: 2001 })).toMatchObject({ granted: false, error: 'state' });
  });

  it('a wrong / missing / expired state is rejected (and the token still never stays in the address)', () => {
    for (const make of [
      (s) => `#access_token=T&state=other`,
      () => `#access_token=T`,
      (s) => `#access_token=T&state=${s}`,
    ]) {
      const { storage, hist, state } = setup();
      const late = make(state).endsWith(state) ? 1000 + 11 * 60 * 1000 : 2000;
      const res = consumeOAuthCallback({ loc: loc(make(state)), hist, storage, now: late });
      expect(res).toMatchObject({ granted: false, error: 'state' });
      expect(hist.replaceState).toHaveBeenCalled();
    }
  });

  it('the user cancelling at Google comes back as "denied"; query-string answers work too', () => {
    const { storage, hist, state } = setup();
    expect(consumeOAuthCallback({ loc: loc(`#error=access_denied&state=${state}`), hist, storage, now: 2000 })).toEqual({ kind: 'drive', granted: false, error: 'denied' });
    const b = setup();
    expect(consumeOAuthCallback({ loc: loc('', `?access_token=T&state=${b.state}`), hist: b.hist, storage: b.storage, now: 2000 })).toEqual({ kind: 'drive', granted: true });
  });
});

describe('connectDrive: pop-up first, redirect when the pop-up cannot open', () => {
  it('passes through success and ordinary errors; a blocked pop-up redirects and keeps the form', async () => {
    await expect(connectDrive({ request: async () => ({ granted: true }) })).resolves.toEqual({ granted: true });
    const denied = Object.assign(new Error('x'), { code: 'denied' });
    const redirect = vi.fn();
    await expect(connectDrive({ request: async () => { throw denied; }, redirect })).rejects.toBe(denied);
    expect(redirect).not.toHaveBeenCalled();
    const before = vi.fn();
    await expect(connectDrive({ request: async () => { throw Object.assign(new Error('p'), { code: 'popup' }); }, redirect, beforeRedirect: before })).rejects.toMatchObject({ code: 'redirect' });
    expect(before).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it('the typed form survives the trip to Google (text fields only)', () => {
    const storage = mem();
    saveSetupDraft({ name: 'Aurora', proName: 'Ana', signature: { dataUrl: 'data:big' }, phone: 5 }, storage);
    expect(takeSetupDraft(storage)).toEqual({ name: 'Aurora', proName: 'Ana' });
    expect(takeSetupDraft(storage)).toBeNull();
  });

  it('main.jsx catches the answer before React renders', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'src/main.jsx'), 'utf8');
    expect(main.indexOf('consumeOAuthCallback();')).toBeGreaterThan(-1);
    expect(main.indexOf('consumeOAuthCallback();')).toBeLessThan(main.indexOf('createRoot('));
  });
});

describe('App after returning from Google', () => {
  let host;
  let root;
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const mount = async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(App, { splash: { hold: 0, fade: 0 } }));
      await new Promise((r) => setTimeout(r, 40));
    });
  };
  const comeBack = (granted = true) => {
    const state = startDriveRedirect({ clientId: 'c.apps.googleusercontent.com', redirectUri: 'http://x/', go: () => {} });
    window.history.replaceState(null, '', `/#${granted ? 'access_token=T&token_type=Bearer' : 'error=access_denied'}&state=${state}`);
    const res = consumeOAuthCallback();
    return res;
  };
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('a new user lands on the setup screen with Drive shown as connected and the typed data restored', async () => {
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
    saveSetupDraft({ name: 'Aurora SpA' });
    expect(comeBack()).toEqual({ kind: 'drive', granted: true });
    expect(window.location.hash).toBe(''); // address cleaned
    await mount();
    expect(q('setup')).not.toBeNull(); // not blank, not the splash button
    expect(q('setup-drive').textContent).toContain('Google Drive conectado');
    expect(host.querySelector('input[type="text"]').value).toBe('Aurora SpA');
    expect(sessionStorage.getItem(OAUTH_KEYS.result)).toBeNull(); // consumed once
  });

  it('a returning user goes straight back to the dashboard with Drive switched on', async () => {
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
    comeBack();
    await mount();
    expect(q('dash-empty')).not.toBeNull();
    expect(q('splash')).toBeNull();
    expect(loadProfileMeta()).toEqual({ onboarded: true, drive: true });
  });

  it('a refusal at Google shows the friendly "not granted" note and the setup stays usable', async () => {
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
    comeBack(false);
    await mount();
    expect(q('setup-drive-note').getAttribute('data-code')).toBe('denied');
    expect(q('setup-save')).not.toBeNull();
    expect(q('setup-drive').textContent).toContain('Conectar Google Drive');
  });
});
