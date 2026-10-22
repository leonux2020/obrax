// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DICT } from '../src/lib/dict.js';
import { LANGS } from '../src/lib/regions.js';
import { FREE_PROJECT_LIMIT, isPro, projectLimitReached } from '../src/lib/pro.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT = 'test-client-123.apps.googleusercontent.com';
const read = (rel) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');

let App;
let host;
let root;
let gsi; // captured Google Identity Services config

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const credential = (over = {}) =>
  `${b64({ alg: 'RS256' })}.${b64({ iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 3600, name: 'Ana Pérez', email: 'ana@example.com', picture: 'https://lh3.googleusercontent.com/a/x', ...over })}.sig`;

function installFakeGsi() {
  gsi = { inits: [], rendered: 0 };
  window.google = {
    accounts: {
      id: {
        initialize: (cfg) => gsi.inits.push(cfg),
        renderButton: (el) => {
          gsi.rendered += 1;
          el.innerHTML = '<button type="button" data-testid="gsi-btn">Continue with Google</button>';
        },
      },
    },
  };
}

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
  App = (await import('../src/App.jsx')).default; // imported AFTER the stub: auth.js reads the env at load time
});

const mountApp = async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(App));
    await new Promise((r) => setTimeout(r, 40));
  });
};
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 5)); });
const typeInto = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const tab = (name) => [...host.querySelectorAll('nav button')].find((b) => b.textContent.includes(name));
const signInWith = (cred) => act(async () => { gsi.inits.at(-1).callback({ credential: cred }); await new Promise((r) => setTimeout(r, 30)); });

function seed({ user = { provider: 'local', name: 'Ana' } } = {}) {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  if (user) localStorage.setItem('cp.user.v1', JSON.stringify(user));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
}

beforeEach(() => {
  localStorage.clear();
  installFakeGsi();
});
afterEach(() => {
  if (host?.isConnected) {
    act(() => root.unmount());
    host.remove();
  }
  delete window.google;
});

describe('Google login on the main access screen (VITE_GOOGLE_CLIENT_ID)', () => {
  it('shows the Google button FIRST, then the local profile, and initializes GIS with the env client id', async () => {
    seed({ user: null });
    await mountApp();
    const card = q('login-google-card');
    const local = q('login-local');
    expect(card).not.toBeNull();
    expect(q('gsi-btn')).not.toBeNull();
    expect(card.compareDocumentPosition(local) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // Google above local
    expect(gsi.inits).toHaveLength(1);
    expect(gsi.inits[0].client_id).toBe(CLIENT);
    expect(gsi.inits[0].auto_select).toBe(false);
  });

  it('a successful Google sign-in is stored and lands on the main view; it survives a relaunch', async () => {
    seed({ user: null });
    await mountApp();
    expect(q('dash-empty')).toBeNull();
    await signInWith(credential());
    expect(q('login-google-card')).toBeNull();
    expect(q('dash-empty')).not.toBeNull(); // dashboard
    expect(JSON.parse(localStorage.getItem('cp.user.v1'))).toMatchObject({ provider: 'google', name: 'Ana Pérez', email: 'ana@example.com' });

    act(() => root.unmount());
    host.remove();
    await mountApp();
    expect(q('login-google-card')).toBeNull();
    expect(q('splash')).toBeNull();
    expect(q('dash-empty')).not.toBeNull();
  });

  it('rejects a credential for another client / an expired one: error shown, still on the access screen, nothing stored', async () => {
    seed({ user: null });
    await mountApp();
    await signInWith(credential({ aud: 'someone-else.apps.googleusercontent.com' }));
    expect(q('google-error')).not.toBeNull();
    expect(q('login-google-card')).not.toBeNull();
    expect(localStorage.getItem('cp.user.v1')).toBeNull();
    await signInWith(credential({ exp: Math.floor(Date.now() / 1000) - 10 }));
    expect(q('google-error')).not.toBeNull();
    await signInWith('garbage');
    expect(q('google-error')).not.toBeNull();
    expect(localStorage.getItem('cp.user.v1')).toBeNull();
  });

  it('the local profile still works next to Google', async () => {
    seed({ user: null });
    await mountApp();
    await click(q('login-local').querySelector('button[type="submit"]'));
    expect(q('dash-empty')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('cp.user.v1')).provider).toBe('local');
  });

  it('if Google cannot load (offline) a short message appears and the local profile remains', async () => {
    delete window.google;
    const real = document.head.appendChild.bind(document.head);
    document.head.appendChild = (node) => {
      if (node.tagName === 'SCRIPT' && String(node.src).includes('gsi/client')) queueMicrotask(() => node.onerror?.());
      return node;
    };
    try {
      seed({ user: null });
      await mountApp();
      await flush();
      expect(q('google-offline').textContent).toContain('Sin conexión');
      expect(q('login-local')).not.toBeNull();
    } finally {
      document.head.appendChild = real;
    }
  });

  it('a local user can link a Google account from Ajustes; logging out returns to the access screen', async () => {
    seed();
    await mountApp();
    await click(tab('Ajustes'));
    expect(q('settings-google-link')).not.toBeNull();
    await signInWith(credential());
    expect(document.querySelector('[role="dialog"]')).toBeNull(); // sheet closed, back on the dashboard
    expect(JSON.parse(localStorage.getItem('cp.user.v1')).provider).toBe('google');
    await click(tab('Ajustes'));
    expect(q('settings-google-link')).toBeNull();
    expect(q('settings-account').textContent).toContain('ana@example.com');
    await click([...q('settings-account').querySelectorAll('button')].find((b) => b.textContent.trim()));
    expect(q('login-google-card')).not.toBeNull();
  });
});

describe('PRO paywall opens when a locked function is used', () => {
  const createViaNav = async (name) => {
    await click(tab('Nuevo'));
    if (q('pro-paywall')) return;
    typeInto(document.querySelector('[role="dialog"] input'), name);
    await click(q('project-save'));
    await flush(60);
    await click(q('wizard-back'));
  };

  it(`the free plan allows ${FREE_PROJECT_LIMIT} projects; the next "Nuevo" opens the PRO screen instead of the form`, async () => {
    seed();
    await mountApp();
    for (let i = 1; i <= FREE_PROJECT_LIMIT; i += 1) {
      await createViaNav(`Obra ${i}`);
      expect(q('pro-paywall'), `project ${i}`).toBeNull();
      expect(host.querySelectorAll('ul[aria-label] > li')).toHaveLength(i);
    }
    await click(tab('Nuevo'));
    expect(q('pro-paywall')).not.toBeNull();
    expect(q('project-save')).toBeNull(); // no new-project form
    expect(q('pro-reason').textContent).toContain(`${FREE_PROJECT_LIMIT} proyectos`);
    expect(q('pro-paywall').querySelector('[data-active="true"]').textContent).toContain('Sin límites de proyectos');
    expect(host.querySelectorAll('ul[aria-label] > li')).toHaveLength(FREE_PROJECT_LIMIT);

    await click(q('pro-back')); // free navigation back
    expect(q('pro-paywall')).toBeNull();
    expect(host.querySelectorAll('ul[aria-label] > li')).toHaveLength(FREE_PROJECT_LIMIT);
  });

  it('the Drive backup row in Ajustes is locked: it opens the PRO screen with that benefit highlighted', async () => {
    seed();
    await mountApp();
    await click(tab('Ajustes'));
    const row = q('settings-drive-pro');
    expect(row.textContent).toContain('Respaldo automático en Google Drive');
    expect(row.textContent).toContain('PRO');
    expect(row.querySelector('svg[data-testid="helmet-icon"]')).not.toBeNull();
    await click(row);
    expect(document.querySelector('[role="dialog"] [data-testid="settings-drive-pro"]')).toBeNull(); // Ajustes closed
    expect(q('pro-reason').textContent).toContain('Google Drive');
    expect(q('pro-paywall').querySelector('[data-active="true"]').textContent).toContain('Respaldo automático');
    await click(document.querySelector('[data-sheet-close]'));
    expect(q('pro-paywall')).toBeNull();
  });

  it('"Descubre PRO" still opens it without a reason; the helmet icon and clean design are kept', async () => {
    seed();
    await mountApp();
    await click(q('pro-scan'));
    expect(q('pro-paywall')).not.toBeNull();
    expect(q('pro-reason')).toBeNull();
    expect(q('pro-paywall').querySelector('[data-active]')).toBeNull();
    expect(q('pro-paywall').querySelector('svg[data-testid="helmet-icon"]')).not.toBeNull();
    expect(q('pro-subscribe').disabled).toBe(true);
    const text = read('components/ProPaywall.jsx');
    expect(text).toContain('bg-black');
    expect(text).not.toMatch(/bg-(neutral|gray|zinc|slate|stone)-\d/);
  });

  it('gate helpers: nobody is PRO yet, existing projects are never removed, limit is exact', () => {
    expect(isPro()).toBe(false);
    expect(projectLimitReached(FREE_PROJECT_LIMIT - 1)).toBe(false);
    expect(projectLimitReached(FREE_PROJECT_LIMIT)).toBe(true);
    expect(projectLimitReached(FREE_PROJECT_LIMIT + 5)).toBe(true);
    expect(projectLimitReached(99, true)).toBe(false);
  });
});

describe('frontend only: no Gemini key in the client', () => {
  it('no source file reads GEMINI_API_KEY and the only env var used by the client is VITE_GOOGLE_CLIENT_ID', () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const files = walk(path.join(process.cwd(), 'src')).filter((f) => /\.(js|jsx)$/.test(f));
    for (const f of files) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/GEMINI/i);
    const envUses = files.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/import\.meta\.env\??\.(\w+)/g)].map((m) => m[1]));
    expect(new Set(envUses.filter((n) => n.startsWith('VITE_')))).toEqual(new Set(['VITE_GOOGLE_CLIENT_ID']));
  });

  it('new strings exist in six languages with matching placeholders', () => {
    const keys = ['login.google.loading', 'login.google.offline', 'login.google.note', 'settings.account.google', 'settings.account.link', 'pro.locked.projects', 'pro.locked.drive', 'pro.locked.ai'];
    for (const l of LANGS) for (const k of keys) expect(DICT[l][k], `${l}:${k}`).toBeTruthy();
    for (const l of LANGS) expect(DICT[l]['pro.locked.projects'], l).toContain('{n}');
  });
});
