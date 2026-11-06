// @vitest-environment happy-dom
// "Cambiar de cuenta de Google" (Ajustes > Operaciones y Sincronización): it forgets the Drive CONNECTION of this device and nothing else.
// The local database stays intact, so the projects cross over to the next Google account as soon as it is connected.
import React, { act } from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, backToDashboard, q, flush, click, typeInto, installFakeGoogle, createHost, createProjectViaDraft } from './helpers/appHarness.js';
import { parseBackup } from '../src/lib/backup.js';
import { DRIVE_INTERACTION_KEY, DRIVE_LINKED_KEY, DRIVE_TOKEN_KEY, clearDriveToken, getDriveToken, isDriveLinked, markDriveNeedsInteraction, setDriveToken, unlinkDriveAccount } from '../src/lib/driveToken.js';
import { DICT } from '../src/lib/dict.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let App;
let drive;
let h;

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
  App = (await import('../src/App.jsx')).default;
});

const seed = () => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Ana', email: 'ana@example.com' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
  localStorage.setItem(DRIVE_LINKED_KEY, '1');
  setDriveToken(drive.token, 3600);
};
const openOps = async () => {
  await click(h.tab('Ajustes'));
  const d = q('settings-ops');
  d.open = true;
  await act(async () => {
    d.dispatchEvent(new Event('toggle'));
  });
  await flush(10);
};
const createProject = async (name) => {
  await createProjectViaDraft(name);
  await flush(60);
  await backToDashboard();
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  drive = createFakeDrive();
  vi.stubGlobal('fetch', drive.fetchImpl);
  installFakeGoogle(drive);
});
afterEach(() => {
  h?.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.google;
});

describe('unlinkDriveAccount (driveToken.js)', () => {
  it('erases the token (memory, session, local), the linked flag and the needs-interaction flag; any other key survives', () => {
    setDriveToken('abcdefghijklmnop', 3600);
    localStorage.setItem(DRIVE_LINKED_KEY, '1');
    markDriveNeedsInteraction();
    localStorage.setItem('cp.company.v1', '{"name":"Aurora"}');
    localStorage.setItem('cp.user.v1', '{"provider":"google"}');
    unlinkDriveAccount();
    expect(getDriveToken()).toBeNull();
    expect(isDriveLinked()).toBe(false);
    expect(sessionStorage.getItem(DRIVE_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(DRIVE_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(DRIVE_INTERACTION_KEY)).toBeNull();
    expect(localStorage.getItem('cp.company.v1')).toBe('{"name":"Aurora"}');
    expect(localStorage.getItem('cp.user.v1')).toBe('{"provider":"google"}');
  });
  it('is safe with nothing stored and never touches IndexedDB (the module does not even mention it)', () => {
    expect(() => unlinkDriveAccount()).not.toThrow();
    expect(() => unlinkDriveAccount({ storage: null, persistent: null })).not.toThrow();
    const src = readFileSync('src/lib/driveToken.js', 'utf8');
    expect(src).not.toMatch(/indexedDB|deleteDatabase|db\.js/);
  });
});

describe('Ajustes: switch Google account', () => {
  it('the row only offers a quiet pencil (44px, no border): the real action is hidden until the pencil is tapped', async () => {
    seed();
    h = createHost(App);
    await h.mount();
    await openOps();
    const row = q('settings-account');
    const pencil = q('edit-account');
    expect(row.contains(pencil)).toBe(true);
    expect(row.lastElementChild).toBe(pencil);
    expect(pencil.getAttribute('aria-label')).toBe(DICT.es['settings.account.edit']);
    expect(pencil.getAttribute('aria-expanded')).toBe('false');
    expect(pencil.className).toContain('h-11');
    expect(pencil.className).toContain('w-11');
    expect(pencil.className).toContain('active:scale-95');
    expect(pencil.className).not.toMatch(/\bborder\b|bg-neutral|bg-gray/);
    expect(pencil.querySelector('svg[data-outline-icon="true"][data-icon="pencil"]')).not.toBeNull();
    expect(q('switch-account')).toBeNull(); // no accidental disconnect: nothing to tap by mistake
    expect(q('account-edit-panel')).toBeNull();
    expect(q('account-unlink-desc')).toBeNull();
    expect(q('google-login')).toBeNull(); // a Google user does not see the sign-in button
  });

  it('tapping the pencil expands the row: dim micro-text + a clear text button (48px, rounded-full, translucent), well apart from the pencil; a second tap folds it', async () => {
    seed();
    h = createHost(App);
    await h.mount();
    await openOps();
    await click(q('edit-account'));
    expect(q('edit-account').getAttribute('aria-expanded')).toBe('true');
    const panel = q('account-edit-panel');
    const desc = q('account-unlink-desc');
    const btn = q('switch-account');
    expect(panel.contains(desc) && panel.contains(btn)).toBe(true);
    expect(desc.textContent).toBe(DICT.es['settings.account.unlink_desc']);
    expect(desc.className).toContain('text-white/50');
    expect(desc.className).toContain('text-xs');
    expect(btn.textContent).toBe('Cambiar cuenta de Google'); // explicit words, not just an icon
    expect(btn.querySelector('svg')).toBeNull();
    expect(btn.className).toContain('min-h-[48px]');
    expect(btn.className).toContain('w-full');
    expect(btn.className).toContain('rounded-full');
    expect(btn.className).toContain('bg-white/5');
    expect(btn.className).not.toMatch(/\bborder\b|bg-neutral|bg-gray/);
    expect(panel.className).toMatch(/\bmt-5\b/); // generous margins: the button is NOT where the thumb just tapped
    expect(panel.className).toMatch(/space-y-5/);
    expect(q('settings-account').compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(drive.backupFiles()).toHaveLength(0); // opening the panel changes nothing
    expect(getDriveToken()).not.toBeNull();
    await click(q('edit-account'));
    expect(q('account-edit-panel')).toBeNull();
    expect(getDriveToken()).not.toBeNull(); // folding it does not disconnect either
  });

  it('one tap: token + flags gone, the Google button is back, the user is the local profile; local data and IndexedDB are NOT touched', async () => {
    seed();
    h = createHost(App);
    await h.mount();
    await createProject('Casa Norte');
    await flush(5600); // the first backup goes up to the OLD account
    expect(drive.backupFiles()).toHaveLength(1);
    const clearLocal = vi.spyOn(Storage.prototype, 'clear');
    await openOps();
    await click(q('edit-account'));
    await click(q('switch-account'));
    await flush(30);
    // the connection is gone...
    expect(getDriveToken()).toBeNull();
    expect(isDriveLinked()).toBe(false);
    expect(localStorage.getItem(DRIVE_TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(DRIVE_TOKEN_KEY)).toBeNull();
    // ...and the sign-in button of Google is offered again
    expect(q('google-login')).not.toBeNull();
    expect(q('switch-account')).toBeNull();
    expect(q('edit-account')).toBeNull();
    expect(q('settings-backup').dataset.state).toBe('disconnected');
    expect(JSON.parse(localStorage.getItem('cp.user.v1'))).toMatchObject({ provider: 'local', name: 'Ana', email: '' });
    // ...but nothing local was erased
    expect(clearLocal).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('cp.company.v1')).name).toBe('Aurora');
    expect(JSON.parse(localStorage.getItem('cp.settings.v1')).region).toBe('CL');
    await click(h.tab('Proyectos'));
    expect(document.body.textContent).toContain('Casa Norte');
    // and nothing was sent to the old Drive by the switch itself
    expect(drive.backupFiles()).toHaveLength(1);
  }, 30_000);

  it('the local projects are the bridge: connecting the NEW account uploads them to the new Drive', async () => {
    seed();
    h = createHost(App);
    await h.mount();
    await createProject('Casa Norte');
    await flush(5600);
    await openOps();
    await click(q('edit-account'));
    await click(q('switch-account'));
    await flush(30);
    const fresh = createFakeDrive(); // the new account's Drive: empty
    vi.stubGlobal('fetch', fresh.fetchImpl);
    installFakeGoogle(fresh, { silentOk: false });
    await click(q('backup-connect'));
    await flush(150);
    expect(fresh.backupFiles()).toHaveLength(1);
    const names = parseBackup(fresh.backupFiles()[0].body).projects.map((p) => p.draft.project.name);
    expect(names).toEqual(['Casa Norte']);
  }, 30_000);
});

describe('the switch can never wipe the device', () => {
  it('the handler in App.jsx calls unlinkDriveAccount + sync.detach and never wipeLocalData / db.js / localStorage.clear', () => {
    const src = readFileSync('src/App.jsx', 'utf8');
    const a = src.indexOf('const switchGoogleAccount');
    const body = src.slice(a, src.indexOf('}, [sync]);', a));
    expect(body).toContain('unlinkDriveAccount()');
    expect(body).toContain('sync.detach()');
    expect(body).not.toMatch(/wipeLocalData|wipingRef\.current = true|onSignedOut|deleteDatabase|indexedDB|\.clear\(|db\.js/);
    const sync = readFileSync('src/lib/driveSync.js', 'utf8');
    const d = sync.indexOf('detach()');
    expect(sync.slice(d, d + 500)).not.toMatch(/indexedDB|deleteDatabase|\.clear\(/);
  });
});

describe('the new words', () => {
  it('switch / edit / unlink_desc exist in the six languages, each one different from the others', () => {
    for (const k of ['settings.account.switch', 'settings.account.edit', 'settings.account.unlink_desc']) {
      for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) expect(DICT[l][k]?.length, `${l} ${k}`).toBeGreaterThan(5);
      expect(new Set(['es', 'en', 'pt', 'fr', 'it', 'de'].map((l) => DICT[l][k])).size, k).toBe(6);
    }
  });
});
