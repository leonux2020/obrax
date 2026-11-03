// @vitest-environment happy-dom
// Two devices, one Drive: the tablet is stale, the phone wrote more. Opening / waking the app pulls and MERGES (never overwrites), the
// screen state updates at once, and what only this device had goes back up.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, q, flush, click, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { collectBackup, parseBackup, serializeBackup } from '../src/lib/backup.js';
import { createDriveClient } from '../src/lib/drive.js';
import { clearDriveToken, setDriveToken } from '../src/lib/driveToken.js';
import { projectStore } from '../src/lib/projectStore.js';
import { newProject } from '../src/lib/projects.js';
import { normalizeExpenses } from '../src/lib/ledger.js';
import { normalizeCompany } from '../src/lib/draft.js';
import { loadWorkers, upsertWorker } from '../src/lib/workers.js';

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

const exp = (id, amount, updatedAt) => normalizeExpenses([{ id, amount, at: 1, supplier: 'Ferretería', updatedAt }])[0];
const withExpenses = (p, list, updatedAt) => ({ ...p, expenses: list.map((e) => ({ ...e, projectId: p.id })), updatedAt });
const driveClient = () => createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl });
const putCloud = async (projects, extra = {}) => {
  const text = serializeBackup(
    await collectBackup({ settings: { region: 'CL', lang: 'es' }, company: normalizeCompany({ name: 'Aurora' }), meta: { onboarded: true, drive: true }, logo: '', projects, loadPhotos: async () => [], ...extra })
  );
  await driveClient().saveBackup(text);
};
const cloud = () => parseBackup(drive.backupFiles()[0].body);
const stored = async () => (await projectStore.load()).find((p) => p.draft.project.name === 'Casa Compartida');
const uploads = () => drive.calls.filter((c) => c.method !== 'GET');

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  resetBoot(); // every mount reads the database again (the app shares one boot promise per page)
  for (const p of await projectStore.load()) await projectStore.remove(p.id);
  drive = createFakeDrive();
  vi.stubGlobal('fetch', drive.fetchImpl);
  installFakeGoogle(drive);
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Ana', email: 'ana@example.com' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
  localStorage.setItem('cp.drive.linked.v1', '1');
  setDriveToken(drive.token, 3600); // a valid session token: the silent pull can run
});
afterEach(() => {
  h?.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.google;
});

describe('auto-pull + granular merge', () => {
  it('opening a stale tablet merges the phone\'s expense in (nothing is crushed), shows it, and the merged whole goes back up', async () => {
    const shared = newProject({ regionCode: 'CL', name: 'Casa Compartida', now: 100, company: { name: 'Aurora' } });
    const tablet = withExpenses(shared, [exp('e1aaaa', 100, 300)], 900); // newer project stamp, but it never saw the phone's expense
    const phone = withExpenses(shared, [exp('e1aaaa', 100, 300), exp('e2bbbb', 250, 500)], 500);
    await projectStore.save(tablet);
    await putCloud([phone]);
    drive.calls.length = 0;
    h = createHost(App);
    await h.mount();
    await flush(300);
    const local = await stored();
    expect(local.expenses.map((e) => e.id).sort()).toEqual(['e1aaaa', 'e2bbbb']); // IndexedDB has both
    expect(document.querySelectorAll('[data-testid="project-card"]')).toHaveLength(1); // the screen is up to date, no manual refresh
    await flush(5600); // this device was ahead (its project differs from Drive's): the merged whole is uploaded, once
    expect(cloud().projects[0].expenses.map((e) => e.id).sort()).toEqual(['e1aaaa', 'e2bbbb']);
    expect(uploads().length).toBeGreaterThan(0);
    expect(q('backup-badge')?.dataset.state).toBe('synced');
  }, 25_000);

  it('waking the app (visibilitychange) pulls what the phone did meanwhile, and uploads nothing when there is nothing new', async () => {
    const shared = newProject({ regionCode: 'CL', name: 'Casa Compartida', now: 100, company: { name: 'Aurora' } });
    const first = withExpenses(shared, [exp('e1aaaa', 100, 300)], 300);
    await projectStore.save(first);
    await putCloud([first]);
    h = createHost(App);
    await h.mount();
    await flush(300);
    expect((await stored()).expenses).toHaveLength(1);
    // the phone adds an expense and uploads
    await putCloud([withExpenses(shared, [exp('e1aaaa', 100, 300), exp('e2bbbb', 40, 700)], 700)]);
    drive.calls.length = 0;
    const real = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(real + 60_000); // past the 15 s throttle
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 300));
    });
    expect((await stored()).expenses.map((e) => e.id).sort()).toEqual(['e1aaaa', 'e2bbbb']);
    await flush(5600);
    expect(uploads()).toHaveLength(0); // the device holds exactly what Drive has: no redundant upload
  }, 25_000);

  it('a worker added on the phone arrives on the tablet; a worker deleted on the phone is not brought back', async () => {
    const shared = newProject({ regionCode: 'CL', name: 'Casa Compartida', now: 100, company: { name: 'Aurora' } });
    await projectStore.save(shared);
    const { worker: gone } = upsertWorker({ name: 'Borrado Pérez' }, 100);
    await putCloud([shared], {
      workers: [{ id: 'w9zzzz', name: 'Nuevo Trabajador', updatedAt: 400, createdAt: 400 }],
      tombs: { projects: {}, workers: { [gone.id]: 5000 } },
    });
    h = createHost(App);
    await h.mount();
    await flush(300);
    expect(loadWorkers().map((w) => w.name)).toEqual(['Nuevo Trabajador']);
  }, 25_000);
});

describe('automatic merge in the background (no "Ripristina da Drive" button)', () => {
  it('merges by itself, uploads the merged whole, and a second wake on identical data downloads nothing (up to date, silently)', async () => {
    const shared = newProject({ regionCode: 'CL', name: 'Casa Compartida', now: 100, company: { name: 'Aurora' } });
    await projectStore.save(withExpenses(shared, [exp('e1aaaa', 100, 300)], 900));
    await putCloud([withExpenses(shared, [exp('e1aaaa', 100, 300), exp('e2bbbb', 250, 500)], 500)]);
    h = createHost(App);
    await h.mount();
    await flush(300);
    await click(h.tab('Ajustes'));
    expect(q('backup-restore')).toBeNull(); // nothing to tap: the merge already happened on open
    expect(q('backup-now')).toBeNull();
    expect((await stored()).expenses.map((e) => e.id).sort()).toEqual(['e1aaaa', 'e2bbbb']);
    await flush(5600); // the merged state is uploaded
    expect(cloud().projects[0].expenses.map((e) => e.id).sort()).toEqual(['e1aaaa', 'e2bbbb']);
    drive.calls.length = 0;
    await act(async () => {
      window.dispatchEvent(new Event('online')); // the signal comes back / any other wake-up
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(drive.calls.some((c) => c.url.includes('alt=media'))).toBe(false); // Drive still shows what this device wrote: nothing to download
    expect(uploads()).toHaveLength(0);
    expect(q('backup-last')).not.toBeNull(); // and Settings shows when the last successful sync happened
  }, 30_000);

  it('without a usable token the failure is named and the header cloud turns amber', async () => {
    const shared = newProject({ regionCode: 'CL', name: 'Casa Compartida', now: 100, company: { name: 'Aurora' } });
    await projectStore.save(shared);
    await putCloud([shared]);
    clearDriveToken();
    h = createHost(App);
    await h.mount();
    await click(h.tab('Ajustes'));
    expect(q('backup-badge')?.dataset.state).toBe('pending');
    expect(q('backup-badge').className).toContain('text-amber-500');
  }, 25_000);
});
