// @vitest-environment happy-dom
// "Sincronizar Expediente a Drive" in the real App: one tap in the project's Exportar sheet; the work runs in the background with a toast
// ("Sincronizando expediente en Drive...") while the user keeps navigating, and the toast becomes "✅ Expediente del proyecto organizado en Drive".
import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, q, flush, click, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { clearDriveToken } from '../src/lib/driveToken.js';
import { resetToasts } from '../src/lib/notify.js';
import { projectStore } from '../src/lib/projectStore.js';
import { photoStoreFor } from '../src/lib/photoStore.js';
import { notePhotosFor } from '../src/lib/notePhotos.js';
import { receiptPhotosFor } from '../src/lib/receiptPhotos.js';
import { newProject } from '../src/lib/projects.js';

globalThis.Blob = NodeBlob; // happy-dom's Blob does not survive fake-indexeddb's structured clone

const bytes = (n, seed) => Uint8Array.from({ length: n }, (_, i) => 65 + ((i + seed) % 26));
const b64 = (n, seed) => `data:image/jpeg;base64,${Buffer.from(bytes(n, seed)).toString('base64')}`;
let App;
let resetBoot;
let drive;
let h;
let project;

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
  ({ default: App, resetBoot } = await import('../src/App.jsx'));
});

const wipe = async () => {
  for (const p of await projectStore.load()) {
    await projectStore.remove(p.id);
    await photoStoreFor(p.id).clear();
    await notePhotosFor(p.id).clear();
    await receiptPhotosFor(p.id).clear();
  }
};
const seed = async () => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Ana', email: 'ana@example.com' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
  localStorage.setItem('cp.drive.linked.v1', '1');
  project = {
    ...newProject({ regionCode: 'CL', name: "Casa D'Arcy", now: 1000 }),
    logbook: [{ id: 'nota0001', at: Date.UTC(2026, 9, 2), text: 'Material dañado', photo: true }],
    expenses: [{ id: 'gasto001', at: Date.UTC(2026, 9, 3), supplier: 'Ferretería Sur', description: 'Cemento', amount: 1500, category: 'material', receiptId: 'rcpt0001' }],
  };
  await projectStore.save(project);
  await photoStoreFor(project.id).save({ slot: 0, dataUrl: b64(200, 1), width: 800, height: 600, at: Date.UTC(2026, 9, 1) });
  await notePhotosFor(project.id).put('nota0001', { dataUrl: b64(150, 2), width: 800, height: 600, at: 9 });
  await receiptPhotosFor(project.id).put('rcpt0001', { dataUrl: b64(120, 3), width: 1000, height: 1400, at: 9 });
};
const names = (folderName) => {
  const f = drive.folders().find((x) => x.name === folderName);
  return f ? drive.backupFiles().filter((x) => x.parents.includes(f.id)).map((x) => x.name).sort() : null;
};
const openExport = async () => {
  await click(h.host.querySelector('[data-testid="project-card"]'));
  await click(q('dock-export'));
};

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  resetToasts();
  drive = createFakeDrive();
  vi.stubGlobal('fetch', drive.fetchImpl);
  installFakeGoogle(drive, { silentOk: true });
  await wipe();
});
afterEach(async () => {
  h?.unmount();
  vi.unstubAllGlobals();
  delete window.google;
  await wipe();
});

describe('Sincronizar Expediente a Drive', () => {
  it('the button is in the Exportar sheet; it runs in the background with a toast, the user keeps navigating, and the folders get organized', async () => {
    await seed();
    let release;
    const gate = new Promise((r) => (release = r));
    vi.stubGlobal('fetch', async (url, init) => {
      if (String(url).includes('/upload/') && init?.method === 'POST') await gate; // the (slow) mobile network
      return drive.fetchImpl(url, init);
    });
    resetBoot();
    h = createHost(App);
    await h.mount();
    await flush(100);
    await openExport();
    const btn = q('export-drive');
    expect(btn.textContent).toContain('Sincronizar Expediente a Drive');
    await click(btn);
    await flush(60);
    expect(q('export-sheet')).toBeNull(); // the sheet closed at once: nothing blocks the screen
    const toast = q('toast');
    expect(toast.textContent).toBe('Sincronizando expediente en Drive...');
    expect(toast.dataset.tone).toBe('info');

    // the user keeps working: back to the project list while Drive is still busy
    await click(q('ws-back'));
    expect(h.host.querySelectorAll('[data-testid="project-card"]')).toHaveLength(1);
    expect(q('toast').textContent).toBe('Sincronizando expediente en Drive...');

    release();
    await flush(400);
    const done = q('toast');
    expect(done.textContent).toBe('✅ Expediente del proyecto organizado en Drive');
    expect(done.dataset.tone).toBe('ok');
    expect(document.querySelectorAll('[data-testid="toast"]')).toHaveLength(1); // the SAME toast was updated, not a second one

    // the virtual tree
    expect(drive.folders().map((f) => f.name).sort()).toEqual(['CUBRAX - Respaldos Obra', 'Comprobantes', "Casa D'Arcy", 'Fotos Obra', 'Proyectos'].sort());
    const root = drive.folders().find((f) => f.name === 'CUBRAX - Respaldos Obra');
    const proyectos = drive.folders().find((f) => f.name === 'Proyectos');
    const casa = drive.folders().find((f) => f.name === "Casa D'Arcy");
    expect(proyectos.parents).toEqual([root.id]);
    expect(casa.parents).toEqual([proyectos.id]);
    // the Excel (bitácora + rendición tables) and the readable Bitácora PDF side by side; no PDF Contratista: this quote is incomplete; no dates in the names
    expect(names("Casa D'Arcy")).toEqual(['Bitacora_Casa-D-Arcy.pdf', 'rendicion-Casa-D-Arcy.xlsx']);
    expect(drive.backupFiles().find((f) => f.name === 'Bitacora_Casa-D-Arcy.pdf').body.startsWith('%PDF')).toBe(true);
    expect(names('Fotos Obra')).toEqual(['Bitacora_2026-10-02_Material-danado_nota00.jpg', 'Obra_2026-10-01_1.jpg']);
    expect(names('Comprobantes')).toEqual(['Comprobante_2026-10-03_Ferreteria-Sur_rcpt00.jpg']);
    const photo = drive.backupFiles().find((f) => f.name === 'Obra_2026-10-01_1.jpg');
    expect(photo.body.length).toBe(200); // the real bytes of the photo
    expect(drive.backupFiles().some((f) => f.name === 'cubrax-backup.json')).toBe(false); // the disaster-recovery file is a separate thing
  }, 30_000);

  it('a second tap does not duplicate anything', async () => {
    await seed();
    resetBoot();
    h = createHost(App);
    await h.mount();
    await flush(100);
    await openExport();
    await click(q('export-drive'));
    await flush(400);
    const files = drive.backupFiles().length;
    const folders = drive.folders().length;
    await click(q('dock-export'));
    await click(q('export-drive'));
    await flush(400);
    expect(drive.backupFiles()).toHaveLength(files);
    expect(drive.folders()).toHaveLength(folders);
    expect(q('toast').textContent).toBe('✅ Expediente del proyecto organizado en Drive');
  }, 30_000);

  it('without coverage: calm amber toast, nothing sent', async () => {
    await seed();
    resetBoot();
    h = createHost(App);
    await h.mount();
    await flush(100);
    await openExport();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      await click(q('export-drive'));
      await flush(60);
      expect(q('toast').textContent).toBe('Sin conexión. Sincroniza el expediente cuando recuperes la señal.');
      expect(q('toast').dataset.tone).toBe('amber');
      expect(drive.calls).toHaveLength(0);
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    }
  }, 30_000);

  it('a Drive failure turns the toast into a clear amber message (never a crash)', async () => {
    await seed();
    resetBoot();
    h = createHost(App);
    await h.mount();
    await flush(100);
    await openExport();
    drive.state.failNext = 1;
    drive.state.status = 500;
    await click(q('export-drive'));
    await flush(300);
    expect(q('toast').textContent).toBe('No se pudo sincronizar el expediente. Inténtalo de nuevo.');
    expect(q('toast').dataset.tone).toBe('amber');
  }, 30_000);
});
