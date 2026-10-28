// @vitest-environment happy-dom
// One-click contextual restore: after a Drive login only the METADATA of cubrax-backup.json is read; if it exists and this device
// has no work, a sheet offers "Restaurar ahora" / "Ahora no". Nothing is downloaded until the user accepts, and nothing is uploaded
// (the cloud copy is never overwritten) until the backup is restored or the user explicitly backs up.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, q, flush, click, typeInto, installFakeGoogle, createHost, backToDashboard } from './helpers/appHarness.js';
import { collectBackup, serializeBackup, hasNoProjects } from '../src/lib/backup.js';
import { newProject } from '../src/lib/projects.js';
import { createDriveClient, BACKUP_FILE } from '../src/lib/drive.js';
import { createDriveSync } from '../src/lib/driveSync.js';
import { clearDriveToken } from '../src/lib/driveToken.js';
import { projectStore } from '../src/lib/projectStore.js';
import { normalizeCompany } from '../src/lib/draft.js';

let App;
let drive;
let h;

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
  App = (await import('../src/App.jsx')).default;
});

const cloudBackup = async (name = 'Casa en la nube') => {
  const project = newProject({ regionCode: 'CL', name, now: 5000, company: { name: 'Aurora' } });
  const text = serializeBackup(
    await collectBackup({
      settings: { region: 'CL', lang: 'es' },
      company: normalizeCompany({ name: 'Aurora', proName: 'Ana Ruiz' }),
      meta: { onboarded: true, drive: true },
      logo: '',
      projects: [project],
      loadPhotos: async () => [],
    })
  );
  await createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl }).saveBackup(text);
  drive.calls.length = 0; // only what the app does counts
  return text;
};
const seed = () => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Ana', email: 'ana@example.com' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
};
const cards = () => [...document.querySelectorAll('[data-testid="project-card"]')].map((c) => c.textContent).join('|');
const downloads = () => drive.calls.filter((c) => c.url.includes('alt=media'));
const uploads = () => drive.calls.filter((c) => c.method !== 'GET');
const connect = async () => {
  await click(h.tab('Ajustes'));
  await click(q('backup-connect'));
  await flush(150);
};

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  for (const p of await projectStore.load()) await projectStore.remove(p.id); // an empty database for every test
  drive = createFakeDrive();
  vi.stubGlobal('fetch', drive.fetchImpl);
  installFakeGoogle(drive, { silentOk: false });
});
afterEach(() => {
  h?.unmount();
  vi.unstubAllGlobals();
  delete window.google;
});

describe('detection of an empty device', () => {
  it('"substantially empty" = the projects are loaded and there are none; still loading is NOT empty', () => {
    expect(hasNoProjects({ projects: [] })).toBe(true);
    expect(hasNoProjects({ projects: null })).toBe(false);
    expect(hasNoProjects({})).toBe(false);
    expect(hasNoProjects({ projects: [{ id: 'a' }] })).toBe(false);
  });

  it('peekBackup asks ONLY for metadata: it never downloads the content, and it finds nothing without a backup', async () => {
    const client = createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl });
    expect(await client.peekBackup()).toBeNull();
    await cloudBackup();
    drive.calls.length = 0;
    const found = await createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl }).peekBackup();
    expect(found.name).toBe(BACKUP_FILE);
    expect(found.modifiedTime).toBeTruthy();
    expect(downloads()).toHaveLength(0);
    expect(drive.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('the sync engine holds uploads while a cloud backup is unrestored; only an explicit override sends them', async () => {
    const storage = new Map();
    const store = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
    const saved = [];
    const sync = createDriveSync({ client: { saveBackup: async (t) => saved.push(t) }, collect: async () => ({ app: 'cubrax', version: 1, projects: [] }), ensureToken: async () => 'tok', storage: store, debounceMs: 5 });
    sync.hold();
    sync.markDirty();
    expect(await sync.flush({ force: true })).toEqual({ ok: true, held: true });
    expect(saved).toHaveLength(0);
    expect(JSON.parse(store.getItem('cp.backup.v1')).held).toBe(true); // survives a reload
    expect(createDriveSync({ client: {}, collect: async () => ({}), ensureToken: async () => null, storage: store }).getState().held).toBe(true);
    expect((await sync.flush({ force: true, override: true })).ok).toBe(true);
    expect(saved).toHaveLength(1);
    expect(sync.getState().held).toBe(false);
  });
});

describe('the one-click restore sheet', () => {
  it('after the Drive login on an empty device it offers the backup (metadata only): no download, no upload, OLED sheet with 44px buttons', async () => {
    seed();
    const original = await cloudBackup();
    h = createHost(App);
    await h.mount();
    await connect();
    const offer = q('restore-offer');
    expect(offer).not.toBeNull();
    expect(offer.dataset.phase).toBe('ask');
    expect(offer.textContent).toContain('Hemos encontrado tu respaldo de obra en la nube. ¿Deseas retomar el trabajo donde lo dejaste?');
    expect(q('restore-offer-now').textContent).toBe('Restaurar ahora');
    expect(q('restore-offer-now').className).toMatch(/min-h-\[44px\].*bg-brand|bg-brand.*min-h-\[44px\]/);
    expect(q('restore-offer-later').textContent).toBe('Ahora no');
    expect(offer.closest('[role="dialog"]').className).toContain('bg-black');
    await flush(3500); // longer than the upload debounce
    expect(downloads()).toHaveLength(0); // nothing downloaded until the user accepts
    expect(uploads()).toHaveLength(0); // and the cloud copy is never overwritten by an empty device
    expect(drive.backupFiles()[0].body).toBe(original);
  }, 20_000);

  it('"Restaurar ahora": explicit progress, then success, then the Dashboard with the restored projects', async () => {
    seed();
    await cloudBackup('Obra Norte');
    let release;
    const gate = new Promise((r) => (release = r));
    vi.stubGlobal('fetch', async (url, init) => {
      if (String(url).includes('alt=media')) await gate;
      return drive.fetchImpl(url, init);
    });
    h = createHost(App);
    await h.mount();
    await connect();
    await click(q('restore-offer-now'));
    expect(q('restore-offer').dataset.phase).toBe('working');
    expect(q('restore-offer-working').textContent).toBe('Descargando y reconstruyendo obra...');
    expect(q('restore-offer-now')).toBeNull();
    release();
    await flush(200);
    expect(q('restore-offer').dataset.phase).toBe('done');
    expect(q('restore-offer-done').textContent).toContain('¡Obra restaurada!');
    expect(downloads().length).toBeGreaterThan(0);
    expect((await projectStore.load()).map((p) => p.draft.project.name)).toEqual(['Obra Norte']); // the local database is hydrated
    await flush(1600);
    expect(q('restore-offer')).toBeNull();
    expect(q('settings-backup')).toBeNull(); // the Settings sheet is gone: the Dashboard shows
    expect(cards()).toContain('Obra Norte');
    expect(JSON.parse(localStorage.getItem('cp.backup.v1')).held).toBe(false); // uploads resume...
    await flush(3600);
    expect(uploads().length).toBeGreaterThan(0); // ...and the merged state goes up on its own
  }, 20_000);

  it('"Ahora no" closes without downloading anything; the manual "Restaurar" stays in Ajustes and still works', async () => {
    seed();
    const original = await cloudBackup('Obra Sur');
    h = createHost(App);
    await h.mount();
    await connect();
    await click(q('restore-offer-later'));
    expect(q('restore-offer')).toBeNull();
    expect(downloads()).toHaveLength(0);
    expect(q('backup-restore')).not.toBeNull(); // the conventional button is still there
    expect(q('backup-held').textContent).toContain('respaldo en tu nube sin restaurar');
    await flush(3500);
    expect(uploads()).toHaveLength(0); // still protected after declining
    expect(drive.backupFiles()[0].body).toBe(original);
    await click(q('backup-restore'));
    await flush(300);
    expect((await projectStore.load()).map((p) => p.draft.project.name)).toEqual(['Obra Sur']);
    expect(q('backup-held')).toBeNull(); // restored: nothing left to protect
  }, 20_000);

  it('no offer when the device already has work, or when Drive has no backup (the first backup simply goes up)', async () => {
    seed();
    h = createHost(App);
    await h.mount();
    await connect(); // nothing in Drive
    expect(q('restore-offer')).toBeNull();
    await flush(200);
    expect(drive.backupFiles()).toHaveLength(1); // first backup uploaded, as before
    h.unmount();

    // a device with a project
    localStorage.clear();
    sessionStorage.clear();
    clearDriveToken();
    drive = createFakeDrive();
    vi.stubGlobal('fetch', drive.fetchImpl);
    installFakeGoogle(drive, { silentOk: false });
    seed();
    await cloudBackup('Otra');
    h = createHost(App);
    await h.mount();
    await click(q('fab-new'));
    typeInto(document.querySelector('[role="dialog"] input'), 'Mi obra local');
    await click(q('project-save'));
    await flush(60);
    await backToDashboard();
    await connect();
    expect(q('restore-offer')).toBeNull();
  }, 30_000);
});
