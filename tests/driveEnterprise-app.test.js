// @vitest-environment happy-dom
// Drive in the real App: a token that expires while working is renewed silently, and "Respaldar" without coverage shows a calm
// amber toast (never a crash) and uploads by itself when the signal returns.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, backToDashboard, q, flush, click, typeInto, installFakeGoogle, createHost } from './helpers/appHarness.js';
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

const seed = () => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Ana', email: 'ana@example.com' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
  localStorage.setItem('cp.drive.linked.v1', '1'); // this device was connected before: the card shows "Respaldar ahora"
};
const names = () => {
  const [f] = drive.backupFiles();
  return f ? parseBackup(f.body).projects.map((p) => p.draft.project.name) : [];
};
const createProject = async (name) => {
  await click(q('fab-new'));
  typeInto(document.querySelector('[role="dialog"] input'), name);
  await click(q('project-save'));
  await flush(60);
  await backToDashboard();
};
const setOnline = (value) => Object.defineProperty(navigator, 'onLine', { value, configurable: true });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  resetToasts();
  drive = createFakeDrive();
  vi.stubGlobal('fetch', drive.fetchImpl);
  requests = installFakeGoogle(drive, { silentOk: true });
});
afterEach(() => {
  h?.unmount();
  setOnline(true);
  vi.unstubAllGlobals();
  delete window.google;
});

describe('Drive in the app', () => {
  it('a token that expires while the user works is renewed silently and the upload is repeated: no screen, no error', async () => {
    seed();
    h = createHost(App);
    await h.mount();
    await createProject('Uno');
    await click(h.tab('Ajustes'));
    await click(q('backup-now'));
    await flush(60);
    expect(names()).toEqual(['Uno']);
    requests.length = 0;
    drive.rotate('tok-renewed-9999999'); // Google expired the token the app is holding
    await click(q('backup-status')?.closest('[role="dialog"]')?.querySelector('[data-sheet-close]') ?? document.querySelector('[data-sheet-close]'));
    await createProject('Dos'); // the user keeps working
    await flush(3600); // debounce -> upload -> 401 -> silent renewal -> same upload again
    expect(requests).toEqual(['none']); // ONE silent request, never the consent screen
    expect(names()).toContain('Dos');
    expect(drive.calls.some((c) => c.method !== 'GET' && c.url.includes('/upload/'))).toBe(true);
    expect(q('toast')).toBeNull(); // no error shown
  }, 20_000);

  it('"Respaldar" without coverage: amber toast, nothing sent, no crash; the backup goes up by itself when the signal returns', async () => {
    seed();
    h = createHost(App);
    await h.mount();
    await createProject('Casa Norte');
    await click(h.tab('Ajustes'));
    await click(q('backup-now')); // the device is connected to Drive once (first and only consent)
    await flush(60);
    expect(names()).toEqual(['Casa Norte']);
    await click(document.querySelector('[data-sheet-close]'));
    await createProject('Casa Sur'); // work in the field...
    setOnline(false); // ...without coverage
    await click(h.tab('Ajustes'));
    drive.calls.length = 0;
    await click(q('backup-now'));
    await flush(60);
    const toast = q('toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toBe('Sin conexión. El respaldo se intentará cuando recupere la señal');
    expect(toast.dataset.tone).toBe('amber');
    expect(toast.style.color).toBe('#e8c35f');
    expect(drive.calls).toHaveLength(0);
    expect(q('backup-status').dataset.status).toBe('pending');
    expect(q('backup-status').textContent).toContain('sin conexión');
    await click(q('backup-now')); // trying again offline does not pile up toasts
    await flush(30);
    expect(document.querySelectorAll('[data-testid="toast"]')).toHaveLength(1);
    setOnline(true);
    await act_online();
    await flush(120);
    expect(names()).toContain('Casa Sur'); // uploaded on its own
    expect(q('backup-status').dataset.status).toBe('synced');
  }, 20_000);

  it('a network failure during the upload (fetch rejects) is handled the same way', async () => {
    seed();
    h = createHost(App);
    await h.mount();
    await createProject('Obra');
    await click(h.tab('Ajustes'));
    drive.state.offline = true;
    await click(q('backup-now'));
    await flush(60);
    expect(q('toast').textContent).toContain('Sin conexión');
    expect(q('backup-status').dataset.status).toBe('pending');
    drive.state.offline = false;
  }, 20_000);
});

async function act_online() {
  const { act } = await import('react');
  await act(async () => {
    window.dispatchEvent(new Event('online'));
  });
}
