// @vitest-environment happy-dom
// The real App: Contabilidad -> tap the BODY of a card -> the project's financial command center -> add an advance -> "Cerrar Rendición".
// The Excel goes to Drive (CUBRAX - Respaldos Obra / Proyectos / <name> / Rendicion_<date>.xlsx); offline it waits in IndexedDB and the background sync
// uploads it when the connection returns. It is never downloaded.
import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { act } from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, q, flush, click, typeInto, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { clearDriveToken } from '../src/lib/driveToken.js';
import { resetToasts } from '../src/lib/notify.js';
import { projectStore } from '../src/lib/projectStore.js';
import { exportQueue } from '../src/lib/exportQueue.js';
import { renditionFileName } from '../src/lib/exportSync.js';
import { newProject } from '../src/lib/projects.js';
import { normalizeExpenses, normalizePayments } from '../src/lib/ledger.js';

globalThis.Blob = NodeBlob;

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
  for (const p of await projectStore.load()) await projectStore.remove(p.id);
  for (const r of await exportQueue.list()) await exportQueue.remove(r.id);
};
const seed = async () => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Ana', email: 'ana@example.com' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
  localStorage.setItem('cp.drive.linked.v1', '1');
  project = {
    ...newProject({ regionCode: 'CL', name: 'Casa Soto', now: 1000 }),
    payments: normalizePayments([{ id: 'adel0001', amount: 100000, at: Date.UTC(2026, 9, 1), note: 'Adelanto' }]),
    expenses: normalizeExpenses([
      { id: 'gasto001', amount: 30000, category: 'material', supplier: 'Sodimac', description: 'Cemento', at: 5 },
      { id: 'gasto002', amount: 12000, category: 'transport', supplier: 'Copec', description: 'Diésel', at: 6 },
    ]),
  };
  await projectStore.save(project);
};
const openFinance = async () => {
  await click(h.tab('Contabilidad'));
  await click(q(`acc-open-${project.id}`));
};
const setOnline = (v) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
const folderFiles = (name) => {
  const f = drive.folders().find((x) => x.name === name);
  return f ? drive.backupFiles().filter((x) => x.parents.includes(f.id)).map((x) => x.name) : null;
};

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  resetToasts();
  drive = createFakeDrive();
  vi.stubGlobal('fetch', drive.fetchImpl);
  installFakeGoogle(drive, { silentOk: true });
  URL.createObjectURL ??= () => 'blob:x';
  await wipe();
  await seed();
  resetBoot();
});
afterEach(async () => {
  h?.unmount();
  setOnline(true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.google;
  await wipe();
});

describe('Contabilidad -> financial command center', () => {
  it('the card body opens the full-screen view; the checkbox alone selects; the headers add up; back returns', async () => {
    h = createHost(App);
    await h.mount();
    await flush(100);
    await click(h.tab('Contabilidad'));
    await click(q(`acc-check-${project.id}`));
    expect(q('project-finance')).toBeNull();
    expect(q('acc-export').textContent).toContain('1');
    await click(q(`acc-open-${project.id}`));
    expect(q('project-finance')).not.toBeNull();
    expect(q('fin-title').textContent).toBe('Casa Soto');
    expect(q('fin-fund-value').textContent).toContain('100.000');
    expect(q('fin-spent-value').textContent).toContain('42.000');
    expect(q('fin-balance-value').textContent).toContain('58.000');
    await click(q('fin-back'));
    expect(q('project-finance')).toBeNull();
    expect(q('accounting')).not.toBeNull();
  });

  it('an advance added in the view is saved with the project in IndexedDB and moves the headers', async () => {
    h = createHost(App);
    await h.mount();
    await flush(100);
    await openFinance();
    await typeInto(q('fin-income-form').querySelector('input[inputmode]'), '20000');
    await typeInto(q('fin-income-note'), 'Caja chica octubre');
    await click(q('fin-income-add'));
    expect(q('fin-fund-value').textContent).toContain('120.000');
    expect(q('fin-balance-value').textContent).toContain('78.000');
    await flush(100);
    const saved = (await projectStore.load()).find((p) => p.id === project.id);
    expect(saved.payments).toHaveLength(2);
    expect(saved.payments.find((x) => x.note === 'Caja chica octubre')).toMatchObject({ amount: 20000 });
    expect(saved.payments.every((x) => x.amount > 0 && typeof x.id === 'string')).toBe(true);
    expect(saved.id).toBe(project.id); // the same project, nothing orphan
  });
});

describe('Cerrar Rendición (Enviar a Drive)', () => {
  it('online: the Excel lands in CUBRAX - Respaldos Obra / Proyectos / Casa Soto as Rendicion_<date>.xlsx; nothing is downloaded', async () => {
    const download = vi.spyOn(URL, 'createObjectURL');
    h = createHost(App);
    await h.mount();
    await flush(100);
    await openFinance();
    await click(q('fin-close'));
    await flush(400);
    expect(q('toast').textContent).toBe('Rendición enviada a Drive ✓');
    expect(q('toast').dataset.tone).toBe('ok');
    expect(folderFiles('Casa Soto')).toEqual([renditionFileName()]);
    const proyectos = drive.folders().find((f) => f.name === 'Proyectos');
    const root = drive.folders().find((f) => f.name === 'CUBRAX - Respaldos Obra');
    expect(proyectos.parents).toEqual([root.id]);
    expect(drive.backupFiles().find((f) => f.name === renditionFileName()).body.startsWith('PK')).toBe(true); // a real .xlsx (zip)
    expect(await exportQueue.list()).toHaveLength(0);
    expect(download).not.toHaveBeenCalled();
    // closing again the same day replaces the file
    await click(q('fin-close'));
    await flush(400);
    expect(folderFiles('Casa Soto')).toEqual([renditionFileName()]);
  }, 30_000);

  it('offline: calm toast, the Blob waits in IndexedDB (no download, no network); when the connection returns it goes up by itself', async () => {
    const download = vi.spyOn(URL, 'createObjectURL');
    h = createHost(App);
    await h.mount();
    await flush(100);
    await openFinance();
    setOnline(false);
    await click(q('fin-close'));
    await flush(100);
    expect(q('toast').textContent).toBe('Sin conexión. La rendición está en cola y se subirá automáticamente a Drive');
    expect(q('toast').dataset.tone).toBe('amber');
    expect(drive.calls).toHaveLength(0);
    expect(download).not.toHaveBeenCalled();
    const rows = await exportQueue.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ projectId: project.id, title: 'Casa Soto', fileName: renditionFileName(), status: 'pending' });
    expect(q('fin-queued').textContent).toContain('En cola: 1');

    setOnline(true);
    await act_online();
    await flush(500);
    expect(folderFiles('Casa Soto')).toEqual([renditionFileName()]);
    expect(await exportQueue.list()).toHaveLength(0);
    expect(q('fin-queued')).toBeNull();
    expect(document.body.textContent).toContain('Rendiciones subidas a Drive: 1');
    expect(download).not.toHaveBeenCalled();
  }, 30_000);

  it('Drive fails (500): it is parked, not downloaded, and uploaded on the next wake-up', async () => {
    const download = vi.spyOn(URL, 'createObjectURL');
    h = createHost(App);
    await h.mount();
    await flush(100);
    await openFinance();
    drive.state.failNext = 50;
    drive.state.status = 500;
    await click(q('fin-close'));
    await flush(300);
    expect(q('toast').textContent).toBe('No se pudo subir ahora. La rendición está en cola y se subirá automáticamente a Drive');
    expect((await exportQueue.list())).toHaveLength(1);
    expect(download).not.toHaveBeenCalled();
    drive.state.failNext = 0;
    await click(q('fin-queued-retry')); // forced retry
    await flush(500);
    expect(folderFiles('Casa Soto')).toEqual([renditionFileName()]);
    expect(await exportQueue.list()).toHaveLength(0);
  }, 30_000);
});

async function act_online() {
  await act(async () => {
    window.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 50));
  });
}
