// @vitest-environment happy-dom
// Data life cycle, device A: changes are backed up to Drive, and "Cerrar sesión" only erases once Drive has the last change.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, backToDashboard, q, flush, click, typeInto, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { parseBackup } from '../src/lib/backup.js';
import { clearDriveToken } from '../src/lib/driveToken.js';

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
};

const backedUp = () => {
  const [f] = drive.backupFiles();
  return f ? parseBackup(f.body) : null;
};
const names = () => (backedUp()?.projects || []).map((p) => p.draft.project.name);

const createProject = async (name) => {
  await click(q('fab-new'));
  typeInto(document.querySelector('[role="dialog"] input'), name);
  await click(q('project-save'));
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
  delete window.google;
});

describe('Drive backup (device A)', () => {
  it('"Respaldar ahora" uploads one consolidated JSON to the CUBRAX folder with projects, profile and settings', async () => {
    seed();
    h = createHost(App);
    await h.mount();
    await createProject('Casa Norte');
    await click(h.tab('Ajustes'));
    expect(q('backup-status').dataset.status).toBe('idle'); // nothing in Drive yet
    await click(q('backup-now'));
    await flush(60);
    expect(drive.folders().map((f) => f.name)).toEqual(['CUBRAX']);
    expect(drive.backupFiles()).toHaveLength(1);
    const b = backedUp();
    expect(names()).toEqual(['Casa Norte']);
    expect(b.company.name).toBe('Aurora');
    expect(b.settings.region).toBe('CL');
    expect(b.meta.onboarded).toBe(true);
    expect(q('backup-status').dataset.status).toBe('synced');
    expect(q('backup-status').textContent).toContain('Respaldado');
  });

  it('after the first connection every change is uploaded silently (debounced) to the SAME file', async () => {
    seed();
    h = createHost(App);
    await h.mount();
    await createProject('Uno');
    await click(h.tab('Ajustes'));
    await click(q('backup-now'));
    await flush(60);
    await h.unmount(); // app restarted: the token survives in the session, the change after this is silent
    h = createHost(App);
    await h.mount();
    await createProject('Dos'); // no tap on any backup button
    await flush(3500); // debounce window
    expect(drive.backupFiles()).toHaveLength(1);
    expect(names()).toContain('Dos');
  }, 20_000);

  it('Cerrar sesión: shows "Sincronizando…", uploads the LAST change first, then erases the device', async () => {
    seed();
    const out = vi.fn();
    h = createHost(App, { onSignedOut: out });
    await h.mount();
    await createProject('Antigua');
    await click(h.tab('Ajustes'));
    await click(q('backup-now'));
    await flush(60);
    await createProject('Ultima obra'); // made right before leaving: not uploaded yet
    expect(names()).not.toContain('Ultima obra');
    await click(h.tab('Ajustes'));
    await click(q('logout-button'));
    expect(q('logout-warning').textContent).toContain('Google Drive'); // the cloud version of the warning
    // hold the upload to observe the "syncing" state
    let release;
    const hold = new Promise((r) => (release = r));
    const realFetch = drive.fetchImpl;
    vi.stubGlobal('fetch', async (...a) => { await hold; return realFetch(...a); });
    await click(q('logout-confirm'));
    expect(q('logout-confirm').textContent).toContain('Sincronizando');
    expect(q('logout-confirm').disabled).toBe(true);
    expect(out).not.toHaveBeenCalled();
    expect(localStorage.length).toBeGreaterThan(0); // nothing erased while syncing
    release();
    await flush(120);
    expect(names()).toContain('Ultima obra'); // Drive has the last change...
    expect(out).toHaveBeenCalledTimes(1); // ...and only then the sign-out went on
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('if Drive cannot confirm the copy NOTHING is erased; the user can retry or explicitly leave without it', async () => {
    seed();
    const out = vi.fn();
    h = createHost(App, { onSignedOut: out });
    await h.mount();
    await createProject('Importante');
    await click(h.tab('Ajustes'));
    await click(q('backup-now'));
    await flush(60);
    await createProject('Sin subir');
    drive.state.offline = true;
    await click(h.tab('Ajustes'));
    await click(q('logout-button'));
    await click(q('logout-confirm'));
    await flush(60);
    expect(out).not.toHaveBeenCalled();
    expect(localStorage.getItem('cp.company.v1')).not.toBeNull();
    expect(q('logout-warning').textContent).toContain('no se borró nada');
    expect(q('logout-force')).not.toBeNull();
    expect(q('logout-confirm').textContent).toContain('Reintentar');
    // the connection is back: retry works and the copy is complete before erasing
    drive.state.offline = false;
    await click(q('logout-confirm'));
    await flush(120);
    expect(names()).toContain('Sin subir');
    expect(out).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });

  it('"Salir sin respaldar" is the only way to erase without Drive, and it needs its own explicit tap', async () => {
    seed();
    const out = vi.fn();
    h = createHost(App, { onSignedOut: out });
    await h.mount();
    drive.state.offline = true;
    await click(h.tab('Ajustes'));
    await click(q('logout-button'));
    await click(q('logout-confirm'));
    await flush(60);
    expect(out).not.toHaveBeenCalled();
    await click(q('logout-force'));
    await flush(80);
    expect(out).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });
});
