// @vitest-environment happy-dom
// Data life cycle, device B / after signing out: the Drive backup is found and restored BEFORE the Dashboard shows.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, q, flush, click, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { collectBackup, serializeBackup } from '../src/lib/backup.js';
import { newProject } from '../src/lib/projects.js';
import { createDriveClient } from '../src/lib/drive.js';
import { clearDriveToken, setDriveToken } from '../src/lib/driveToken.js';
import { photoStoreFor } from '../src/lib/photoStore.js';
import { normalizeCompany } from '../src/lib/draft.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPEG = `data:image/jpeg;base64,${'A'.repeat(200)}`;

let App;
let drive;
let h;
let remote; // the project stored in the backup

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
  App = (await import('../src/App.jsx')).default;
});

const putBackup = async (text) => {
  const c = createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl });
  await c.saveBackup(text);
};
const legitBackup = async (name = 'Casa Restaurada') => {
  remote = newProject({ regionCode: 'CL', name, now: 5000, company: { name: 'Aurora' } });
  return serializeBackup(
    await collectBackup({
      settings: { region: 'CL', lang: 'es' },
      company: normalizeCompany({ name: 'Aurora', proName: 'Ana Ruiz', signature: { dataUrl: PNG, w: 120, h: 40 } }),
      meta: { onboarded: true, drive: true },
      logo: '',
      projects: [remote],
      loadPhotos: async () => [{ slot: 0, dataUrl: JPEG, width: 800, height: 600, at: 7 }],
    })
  );
};
const cards = () => [...document.querySelectorAll('[data-testid="project-card"]')].map((c) => c.textContent);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  drive = createFakeDrive();
  vi.stubGlobal('fetch', drive.fetchImpl);
  installFakeGoogle(drive);
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' })); // device language / country detected
});
afterEach(() => {
  h?.unmount();
  vi.unstubAllGlobals();
  delete window.google;
});

describe('Restore from Drive on a new device (setup screen)', () => {
  it('connecting Drive finds the newest backup and lands on the Dashboard with projects, photos, profile and signature', async () => {
    await putBackup(await legitBackup());
    h = createHost(App);
    await h.mount();
    await click(q('splash-start'));
    expect(q('setup')).not.toBeNull(); // a new device starts at the registration...
    await click(q('setup-drive')); // ...connects Drive (Google consent)...
    await flush(200);
    expect(q('setup')).toBeNull(); // ...and nothing else has to be typed
    expect(q('restore-screen')).toBeNull();
    expect(cards().join('|')).toContain('Casa Restaurada');
    const company = JSON.parse(localStorage.getItem('cp.company.v1'));
    expect(company.name).toBe('Aurora');
    expect(company.signature.w).toBe(120); // the contractor signature is back
    expect(JSON.parse(localStorage.getItem('cp.profile.v1'))).toEqual({ onboarded: true, drive: true });
    expect(JSON.parse(localStorage.getItem('cp.user.v1')).provider).toBe('local');
    const photos = await photoStoreFor(remote.id).load();
    expect(photos[0]?.dataUrl).toBe(JPEG); // the photo went back into the local store
  });

  it('with no backup in Drive the setup simply goes on (nothing is created in Drive by looking)', async () => {
    h = createHost(App);
    await h.mount();
    await click(q('splash-start'));
    await click(q('setup-drive'));
    await flush(150);
    expect(q('setup')).not.toBeNull();
    expect(q('setup-drive').textContent).toContain('Google Drive conectado');
    expect(drive.files.size).toBe(0);
  });

  it('a corrupt backup file never breaks the setup', async () => {
    await putBackup('{"app":"cubrax","version":1,"projects":"nope"');
    h = createHost(App);
    await h.mount();
    await click(q('splash-start'));
    await click(q('setup-drive'));
    await flush(150);
    expect(q('setup')).not.toBeNull();
  });

  it('back from the full-page Google redirect the same search runs and restores', async () => {
    await putBackup(await legitBackup('Obra tras redirección'));
    setDriveToken(drive.token, 3599); // what consumeOAuthCallback stores for the session
    sessionStorage.setItem('cp.oauth.result', JSON.stringify({ kind: 'drive', granted: true }));
    h = createHost(App);
    await h.mount();
    await flush(200);
    expect(q('setup')).toBeNull();
    expect(cards().join('|')).toContain('Obra tras redirección');
  });
});

describe('Restore from Ajustes on a device that already has data', () => {
  it('adds what is missing and never overwrites the existing profile', async () => {
    await putBackup(await legitBackup('Obra de Drive'));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Ana', email: 'a@x.com' }));
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Mi empresa local' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
    localStorage.setItem('cp.drive.linked.v1', '1');
    h = createHost(App);
    await h.mount();
    expect(cards()).toHaveLength(0);
    await click(h.tab('Ajustes'));
    await click(q('backup-restore'));
    await flush(150);
    expect(q('backup-note').textContent).toContain('Respaldo restaurado');
    expect(JSON.parse(localStorage.getItem('cp.company.v1')).name).toBe('Mi empresa local'); // untouched
    expect(cards().join('|')).toContain('Obra de Drive'); // the missing project came back
  });

  it('says so when Drive has no backup, and when the connection fails', async () => {
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Ana', email: 'a@x.com' }));
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Mi empresa' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
    localStorage.setItem('cp.drive.linked.v1', '1');
    h = createHost(App);
    await h.mount();
    await click(h.tab('Ajustes'));
    await click(q('backup-restore'));
    await flush(100);
    expect(q('backup-note').textContent).toContain('No hay ningún respaldo');
    drive.state.offline = true;
    await click(q('backup-restore'));
    await flush(100);
    expect(q('backup-note').textContent).toContain('No se pudo leer');
  });
});
