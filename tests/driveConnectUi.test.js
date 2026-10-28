// @vitest-environment happy-dom
// The Google Drive card in Ajustes: explicit states (not connected / connected), the first connection creates the exclusive folder
// and uploads the first backup, and switching "Respaldo en Google Drive" ON starts Google's authorization by itself.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, q, flush, click, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { parseBackup } from '../src/lib/backup.js';
import { clearDriveToken } from '../src/lib/driveToken.js';
import { resetToasts } from '../src/lib/notify.js';

let App;
let drive;
let h;
let requests;

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
  App = (await import('../src/App.jsx')).default;
});

const seed = (profile) => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Leo', email: 'leo@example.com' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, ...profile }));
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  resetToasts();
  drive = createFakeDrive();
  vi.stubGlobal('fetch', drive.fetchImpl);
});
afterEach(() => {
  h?.unmount();
  vi.unstubAllGlobals();
  delete window.google;
});

describe('Google Drive card in Ajustes', () => {
  it('not connected: a 44px green "Conectar cuenta de Google" button, no "not configured" error, nothing sent to Drive yet', async () => {
    requests = installFakeGoogle(drive, { silentOk: true });
    seed({ drive: true });
    h = createHost(App);
    await h.mount();
    await click(h.tab('Ajustes'));
    expect(q('settings-backup').dataset.state).toBe('disconnected');
    expect(q('settings-backup').textContent).not.toContain('no está configurada');
    expect(q('backup-config-diagnostic')).toBeNull();
    const btn = q('backup-connect');
    expect(btn.textContent).toContain('Conectar cuenta de Google');
    expect(btn.className).toContain('min-h-[44px]');
    expect(btn.className).toContain('text-brand');
    expect(q('backup-now')).toBeNull();
    expect(q('backup-connected')).toBeNull();
    expect(drive.calls).toHaveLength(0);
  });

  it('click on "Conectar cuenta": Google asks for consent; then "Conectado a Google Drive" with the account, the exclusive folder, "Respaldar ahora" and the first backup', async () => {
    requests = installFakeGoogle(drive, { silentOk: false });
    seed({ drive: true });
    h = createHost(App);
    await h.mount();
    await click(h.tab('Ajustes'));
    await click(q('backup-connect'));
    await flush(120);
    expect(requests).toEqual(['']); // the real consent screen, once
    expect(q('settings-backup').dataset.state).toBe('connected');
    expect(q('backup-connected').textContent).toContain('Conectado a Google Drive');
    expect(q('backup-account').textContent).toBe('Leo · leo@example.com');
    expect(q('backup-folder').textContent).toBe('Carpeta exclusiva: CUBRAX - Respaldos Obra');
    expect(q('backup-now').className).toContain('min-h-[44px]');
    expect(q('backup-now').className).toContain('bg-brand');
    expect(q('backup-connect')).toBeNull();
    expect(drive.folders()).toHaveLength(1); // created in the background
    expect(drive.folders()[0].name).toBe('CUBRAX - Respaldos Obra');
    expect(drive.backupFiles()).toHaveLength(1); // and the first backup is up
    expect(parseBackup(drive.backupFiles()[0].body)).not.toBeNull();
    expect(q('backup-status').textContent).toBe('Último respaldo: Hace un momento');
    expect(q('backup-synced-tag').textContent).toBe('Sincronizado');
  }, 20_000);

  it('switching "Respaldo en Google Drive" ON for an unlinked account opens the Google authorization by itself and backs up', async () => {
    requests = installFakeGoogle(drive, { silentOk: false });
    seed({ drive: false });
    h = createHost(App);
    await h.mount();
    await click(h.tab('Ajustes'));
    expect(q('settings-backup').dataset.state).toBe('off');
    expect(requests).toEqual([]);
    await click(q('settings-drive'));
    await flush(120);
    expect(requests).toEqual(['']); // no extra click: the official consent started
    expect(q('settings-drive').getAttribute('aria-checked')).toBe('true');
    expect(q('settings-backup').dataset.state).toBe('connected');
    expect(drive.folders()).toHaveLength(1);
    expect(drive.backupFiles()).toHaveLength(1);
  }, 20_000);

  it('if the user refuses on Google the switch goes back OFF, with a clear message and nothing created', async () => {
    requests = installFakeGoogle(drive, { silentOk: false });
    window.google.accounts.oauth2.initTokenClient = (cfg) => ({
      requestAccessToken: () => queueMicrotask(() => cfg.callback({ error: 'access_denied' })),
    });
    seed({ drive: false });
    h = createHost(App);
    await h.mount();
    await click(h.tab('Ajustes'));
    await click(q('settings-drive'));
    await flush(120);
    expect(q('settings-drive').getAttribute('aria-checked')).toBe('false');
    expect(JSON.parse(localStorage.getItem('cp.profile.v1')).drive).toBe(false);
    expect(drive.folders()).toHaveLength(0);
    expect(drive.backupFiles()).toHaveLength(0);
  }, 20_000);
});
