// @vitest-environment happy-dom
// The invisible engine inside the real App: a worker saved in the directory goes up to Drive on its own (no tap), and the header shows the passive cloud.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, q, flush, click, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { parseBackup } from '../src/lib/backup.js';
import { clearDriveToken } from '../src/lib/driveToken.js';
import { upsertWorker } from '../src/lib/workers.js';

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
  localStorage.setItem('cp.drive.linked.v1', '1');
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
  delete window.google;
});

describe('invisible sync', () => {
  it('a worker saved after the first connection reaches the backup by itself, and the header cloud confirms it', async () => {
    seed();
    h = createHost(App);
    await h.mount();
    // the app opened with no valid Google token (it lasts ~1 h): the silent look at Drive could not run, and the cloud says so (amber), never silence
    expect(q('backup-badge')?.dataset.state).toBe('pending');
    expect(q('backup-badge').dataset.reason).toBe('auth');
    await click(h.tab('Ajustes'));
    expect(q('backup-now')).toBeNull(); // no manual save / restore buttons...
    expect(q('backup-restore')).toBeNull();
    await click(q('backup-reconnect')); // ...only, when Google really asks again (amber cloud), the one way back: a single reconnect tap
    await flush(200);
    expect(q('backup-reconnect')).toBeNull();
    await click(h.tab('Proyectos'));
    expect(q('backup-badge')?.dataset.state).toBe('synced');
    expect(q('backup-badge').className).toContain('text-brand-500');

    await act(async () => {
      upsertWorker({ name: 'Luca Bianchi', trade: 'electricista' }); // what the Squadra sheet does on save: local first, instantly
    });
    expect(JSON.parse(localStorage.getItem('cp.workers.v1'))).toHaveLength(1);
    expect(q('backup-badge')?.dataset.state).toBe('syncing'); // on its way up, nothing to tap
    await flush(5600);
    const [f] = drive.backupFiles();
    expect(parseBackup(f.body).workers.map((w) => w.name)).toEqual(['Luca Bianchi']);
    expect(q('backup-badge')?.dataset.state).toBe('synced');
  }, 25_000);
});
