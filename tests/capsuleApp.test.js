// @vitest-environment happy-dom
// The capsule in the real app: a project that predates it is sealed at boot, the Dashboard no longer follows the price book of the device,
// and a background pull merges the budget lines of the other device and stores the recalculated totals before the screen shows them.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, flush, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { collectBackup, serializeBackup } from '../src/lib/backup.js';
import { createDriveClient } from '../src/lib/drive.js';
import { clearDriveToken, setDriveToken } from '../src/lib/driveToken.js';
import { projectStore } from '../src/lib/projectStore.js';
import { newProject } from '../src/lib/projects.js';
import { newPartida, normalizeCompany } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { publish, resetRegistry } from '../src/lib/priceRegistry.js';
import { projectTotal } from '../src/lib/projectTotals.js';
import { stampProject } from '../src/lib/merge.js';

const part = (task, dims) => ({ ...newPartida(task), dims: { ...newPartida(task).dims, ...dims } });

describe('capsule inside the app', () => {
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
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    clearDriveToken();
    resetBoot();
    resetRegistry();
    for (const p of await projectStore.load()) await projectStore.remove(p.id);
    drive = createFakeDrive();
    vi.stubGlobal('fetch', drive.fetchImpl);
    installFakeGoogle(drive);
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Ana', email: 'ana@example.com' }));
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
    localStorage.setItem('cp.drive.linked.v1', '1');
    setDriveToken(drive.token, 3600);
  });
  afterEach(() => {
    h?.unmount();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.google;
  });
  const card = () => document.querySelector('[data-testid="project-card"]');
  const put = async (project) => {
    const text = serializeBackup(await collectBackup({ settings: { region: 'CL', lang: 'es' }, company: normalizeCompany({ name: 'Aurora' }), meta: { onboarded: true, drive: true }, logo: '', projects: [project], loadPhotos: async () => [] }));
    await createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl }).saveBackup(text);
  };

  it('boot seals a legacy project; the card keeps its total when the device price book changes', async () => {
    const p0 = newProject({ regionCode: 'CL', mode: 'project', name: 'Casa Cápsula', now: 100, company: { name: 'Aurora' } });
    const legacy = { ...p0, draft: { ...p0.draft, partidas: [part('slab', { length: 6, width: 4 })] } };
    await projectStore.save(legacy);
    h = createHost(App);
    await h.mount();
    await flush(500);
    const stored = (await projectStore.load()).find((p) => p.id === p0.id);
    expect(stored.draft.capsule.tax.rate).toBeGreaterThan(0);
    expect(Object.keys(stored.draft.capsule.prices.best).length).toBeGreaterThan(0);
    expect(stored.totals.total).toBeGreaterThan(0);
    const before = card().textContent;
    const ids = Object.keys(stored.draft.capsule.prices.best);
    await act(async () => {
      publish('CL', { book: { region: 'CL', at: 9, materials: Object.fromEntries(ids.map((id) => [id, 1])), rent: {} } }); // this device now "knows" absurd prices
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(card().textContent).toBe(before);
  }, 30_000);

  it('a background pull brings the other device\'s new partida; the stored project already carries the recalculated totals', async () => {
    const p0 = newProject({ regionCode: 'CL', mode: 'project', name: 'Casa Nube', now: 100, company: { name: 'Aurora' } });
    const slab = { ...part('slab', { length: 6, width: 4 }), updatedAt: 100 };
    const tablet = { ...p0, updatedAt: 900, draft: { ...p0.draft, partidas: [slab] } };
    await projectStore.save(tablet);
    // the phone (older project stamp) added a paint partida and a payment
    const base = { ...p0, updatedAt: 500, draft: { ...p0.draft, partidas: [slab] } };
    const phone = stampProject(base, { ...base, updatedAt: 600, payments: [{ id: 'pay1aaaa', amount: 1000, at: 1, note: '', updatedAt: 600 }], draft: { ...base.draft, partidas: [slab, part('paint', { length: 20, height: 2.5 })] } }, 600);
    await put(phone);
    h = createHost(App);
    await h.mount();
    await flush(300);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 500));
    });
    const stored = (await projectStore.load()).find((p) => p.id === p0.id);
    expect(stored.draft.partidas.map((p) => p.task).sort()).toEqual(['paint', 'slab']);
    expect(stored.payments).toHaveLength(1);
    expect(stored.totals.paid).toBe(1000);
    expect(stored.totals.total).toBe(projectTotal(stored, Date.now()));
    expect(stored.totals.pending).toBe(Math.max(0, stored.totals.total - 1000));
    expect(computeAll(stored.draft, Date.now(), { chains: false }).sealed).toBe(true);
  }, 30_000);
});
