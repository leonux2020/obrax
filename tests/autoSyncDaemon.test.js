// @vitest-environment happy-dom
// ZERO STRESS sync: no "save now" / "restore" buttons; a background daemon that wakes on (a) the app coming back (visibilitychange),
// (b) the signal returning ('online') and (c) every local change (debounced push); and a header cloud that spins while it works.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, q, flush, click, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { collectBackup, parseBackup, serializeBackup } from '../src/lib/backup.js';
import { createDriveClient } from '../src/lib/drive.js';
import { clearDriveToken, setDriveToken } from '../src/lib/driveToken.js';
import { projectStore } from '../src/lib/projectStore.js';
import { newProject } from '../src/lib/projects.js';
import { normalizeCompany } from '../src/lib/draft.js';
import { loadWorkers, upsertWorker } from '../src/lib/workers.js';
import { AUTO_SYNC } from '../src/lib/driveSync.js';

let App;
let resetBoot;
let drive;
let h;

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
  const mod = await import('../src/App.jsx');
  App = mod.default;
  resetBoot = mod.resetBoot;
});

const seed = (lang = 'es') => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang, langLocked: true }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Ana', email: 'ana@example.com' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
  localStorage.setItem('cp.drive.linked.v1', '1');
  setDriveToken(drive.token, 3600);
};
const driveClient = () => createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl });
const putCloud = async (projects, extra = {}) => {
  const text = serializeBackup(await collectBackup({ settings: { region: 'CL', lang: 'es' }, company: normalizeCompany({ name: 'Aurora' }), meta: { onboarded: true, drive: true }, logo: '', projects, loadPhotos: async () => [], ...extra }));
  await driveClient().saveBackup(text);
};
const uploads = () => drive.calls.filter((c) => c.method !== 'GET' && c.url.includes('/upload/'));
const downloads = () => drive.calls.filter((c) => c.url.includes('alt=media'));
const fire = (target, type) => act(async () => { target.dispatchEvent(new Event(type)); await new Promise((r) => setTimeout(r, 300)); });

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  resetBoot();
  for (const p of await projectStore.load()) await projectStore.remove(p.id);
  drive = createFakeDrive();
  vi.stubGlobal('fetch', drive.fetchImpl);
  installFakeGoogle(drive);
});
afterEach(() => {
  h?.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.google;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('Settings: only the master switch, the account and a passive line', () => {
  it('has NO "Salva ora" / "Ripristina da Drive" buttons; says (in Italian) that automatic sync is active, with the last successful sync', async () => {
    seed('it');
    const p = newProject({ regionCode: 'CL', name: 'Casa', now: 100, company: { name: 'Aurora' } });
    await projectStore.save(p);
    await putCloud([p]);
    h = createHost(App);
    await h.mount();
    await flush(400);
    await click(h.tab('Impostazioni'));
    expect(q('settings-drive')).not.toBeNull(); // the master switch stays
    expect(q('backup-account').textContent).toContain('ana@example.com'); // the connected account
    expect(q('backup-now')).toBeNull();
    expect(q('backup-restore')).toBeNull();
    expect(document.body.textContent).not.toContain('Salva ora');
    expect(document.body.textContent).not.toContain('Ripristina da Drive');
    expect(q('backup-auto').textContent).toContain('Sincronizzazione automatica attiva in background');
    expect(q('backup-last').textContent).toMatch(/^Ultima sincronizzazione: .+/);
    expect(Number(q('backup-last').dataset.at)).toBeGreaterThan(0);
  }, 25_000);
});

describe('the daemon\'s triggers', () => {
  it('a) the app coming back (visibilitychange -> visible) pulls what another device wrote; b) hidden pushes what is still waiting at once', async () => {
    seed();
    const shared = newProject({ regionCode: 'CL', name: 'Casa Compartida', now: 100, company: { name: 'Aurora' } });
    await projectStore.save(shared);
    await putCloud([shared]);
    h = createHost(App);
    await h.mount();
    await flush(400);
    // another device renames the job and uploads
    await putCloud([{ ...shared, location: { lat: -33.5, lng: -70.6, label: 'Otra' }, updatedAt: 9_999_999_999_999 }]);
    drive.calls.length = 0;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000); // past the 15 s throttle
    await fire(document, 'visibilitychange');
    expect(downloads().length).toBeGreaterThan(0); // pulled by itself, nobody tapped anything
    expect((await projectStore.load())[0].updatedAt).toBe(9_999_999_999_999);
    // hidden: a change waiting for its debounce is pushed immediately (leaving the app never strands it)
    vi.restoreAllMocks();
    drive.calls.length = 0;
    await act(async () => { upsertWorker({ name: 'Luca Bianchi' }); });
    expect(uploads()).toHaveLength(0); // still inside the debounce
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await fire(document, 'visibilitychange');
    await flush(300);
    expect(uploads().length).toBeGreaterThan(0);
    expect(parseBackup(drive.backupFiles()[0].body).workers.map((w) => w.name)).toEqual(['Luca Bianchi']);
  }, 30_000);

  it('b) the signal coming back (online) pulls and pushes by itself, without waiting for the 15 s throttle', async () => {
    seed();
    const shared = newProject({ regionCode: 'CL', name: 'Casa Compartida', now: 100, company: { name: 'Aurora' } });
    await projectStore.save(shared);
    await putCloud([shared]);
    h = createHost(App);
    await h.mount();
    await flush(400); // boot pull just ran (inside the throttle window)
    await putCloud([{ ...shared, updatedAt: 8_888_888_888_888 }]);
    drive.calls.length = 0;
    await fire(window, 'online');
    expect(downloads().length).toBeGreaterThan(0);
    expect((await projectStore.load())[0].updatedAt).toBe(8_888_888_888_888);
  }, 30_000);

  it('c) local changes are DEBOUNCED: a burst of edits makes ONE upload, only after the quiet period (5 s)', async () => {
    expect(AUTO_SYNC.debounceMs).toBeGreaterThanOrEqual(5000);
    expect(AUTO_SYNC.debounceMs).toBeLessThanOrEqual(10_000);
    seed();
    const shared = newProject({ regionCode: 'CL', name: 'Casa Compartida', now: 100, company: { name: 'Aurora' } });
    await projectStore.save(shared);
    await putCloud([shared]);
    h = createHost(App);
    await h.mount();
    await flush(400);
    drive.calls.length = 0;
    await act(async () => { upsertWorker({ name: 'Uno' }); });
    await flush(1500);
    await act(async () => { upsertWorker({ name: 'Dos' }); }); // typing fast: the wait restarts
    await flush(1500);
    await act(async () => { upsertWorker({ name: 'Tres' }); });
    await flush(3000); // 4.5 s after the first change, 3 s after the last: still waiting
    expect(uploads()).toHaveLength(0);
    await flush(2600); // the quiet period is over
    expect(uploads()).toHaveLength(1); // ONE upload for the whole burst
    expect(parseBackup(drive.backupFiles()[0].body).workers.map((w) => w.name).sort()).toEqual(['Dos', 'Tres', 'Uno']);
    expect(loadWorkers()).toHaveLength(3);
  }, 40_000);
});

describe('the header cloud spins while the daemon works, never blocking the screen', () => {
  it('spins during the upload (data-busy, animate-spin), no overlay or "syncing" dialog ever appears, and stops when done', async () => {
    seed();
    const shared = newProject({ regionCode: 'CL', name: 'Casa Compartida', now: 100, company: { name: 'Aurora' } });
    await projectStore.save(shared);
    await putCloud([shared]);
    h = createHost(App);
    await h.mount();
    await flush(400);
    expect(q('backup-badge').dataset.busy).toBeUndefined();
    expect(q('backup-badge').className).not.toContain('animate-spin');
    let release;
    const gate = new Promise((r) => (release = r));
    const real = drive.fetchImpl;
    vi.stubGlobal('fetch', async (...a) => {
      if (String(a[0]).includes('/upload/')) await gate; // hold the upload in flight
      return real(...a);
    });
    // the app's client reads the global fetch lazily: the held request is the one the daemon makes
    await act(async () => { upsertWorker({ name: 'Luca' }); });
    await flush(AUTO_SYNC.debounceMs + 400);
    const badge = q('backup-badge');
    expect(badge.dataset.state).toBe('syncing');
    expect(badge.dataset.busy).toBe('true');
    expect(badge.className).toContain('animate-spin');
    expect(document.querySelector('[role="dialog"]')).toBeNull(); // no pop-up
    expect(document.querySelector('[data-testid="sync-overlay"]')).toBeNull(); // no overlay
    expect(q('fab-new')).not.toBeNull(); // the screen stays usable
    release();
    await flush(400);
    expect(q('backup-badge').dataset.busy).toBeUndefined();
    expect(q('backup-badge').className).not.toContain('animate-spin');
    expect(q('backup-badge').dataset.state).toBe('synced');
  }, 40_000);
});
