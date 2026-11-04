// @vitest-environment happy-dom
// "Sanador automático": a legacy project (no capsule) that gets its capsule for the first time is repaired AND uploaded by the Auto-Sync
// daemon by itself - nobody has to make a phantom edit. The heal never moves `updatedAt` (a stale device must not win the merge with it).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, flush, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { collectBackup, mergeBackup, parseBackup, serializeBackup } from '../src/lib/backup.js';
import { createDriveClient } from '../src/lib/drive.js';
import { clearDriveToken, setDriveToken } from '../src/lib/driveToken.js';
import { projectStore } from '../src/lib/projectStore.js';
import { newProject } from '../src/lib/projects.js';
import { newPartida, normalizeCompany } from '../src/lib/draft.js';
import { isHealed } from '../src/lib/capsule.js';
import { recalculateProjectTotals } from '../src/lib/projectTotals.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { AUTO_SYNC } from '../src/lib/driveSync.js';

const part = (task, dims) => ({ ...newPartida(task), dims: { ...newPartida(task).dims, ...dims } });
const company = normalizeCompany({ name: 'Aurora' });
const device = (projects) => ({ settings: { region: 'CL', lang: 'es' }, company, meta: { onboarded: true, drive: true }, logo: '', projects });
const legacyProject = (name = 'Casa Legacy') => {
  const p0 = newProject({ regionCode: 'CL', mode: 'project', name, now: 100, company: { name: 'Aurora' } });
  return { ...p0, updatedAt: 777, draft: { ...p0.draft, partidas: [part('slab', { length: 6, width: 4 })] } };
};

describe('isHealed', () => {
  it('true only when the capsule was born in this step', () => {
    const legacy = legacyProject();
    const sealed = recalculateProjectTotals(legacy);
    expect(isHealed(legacy, sealed)).toBe(true);
    expect(isHealed(sealed, sealed)).toBe(false);
    expect(isHealed(sealed, recalculateProjectTotals(sealed))).toBe(false);
    expect(isHealed(legacy, legacy)).toBe(false);
    expect(isHealed(null, sealed)).toBe(true);
    expect(isHealed(legacy, null)).toBe(false);
  });
  it('sealing a legacy project does not move updatedAt', () => {
    const legacy = legacyProject();
    expect(recalculateProjectTotals(legacy).updatedAt).toBe(777);
  });
});

describe('mergeBackup: a legacy copy in the cloud is flagged for repair', () => {
  it('remote legacy + local sealed -> needsPush (even though both say the same)', async () => {
    const legacy = legacyProject();
    const sealed = recalculateProjectTotals(legacy);
    const file = parseBackup(serializeBackup(await collectBackup(device([legacy]))));
    const m = mergeBackup({ ...device([sealed]), tombs: { projects: {}, workers: {} } }, file);
    expect(m.needsPush).toBe(true);
    expect(m.projects.find((p) => p.id === legacy.id).updatedAt).toBe(777);
  });
  it('both sealed and identical -> nothing to do (no sync loop)', async () => {
    const sealed = recalculateProjectTotals(legacyProject());
    const file = parseBackup(serializeBackup(await collectBackup(device([sealed]))));
    const m = mergeBackup({ ...device([sealed]), tombs: { projects: {}, workers: {} } }, file);
    expect(m.needsPush).toBe(false);
  });
});

describe('the app heals legacy projects on its own', () => {
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
  const putCloud = async (projects) => {
    const text = serializeBackup(await collectBackup({ ...device(projects), loadPhotos: async () => [] }));
    await createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl }).saveBackup(text);
  };
  const uploads = () => drive.calls.filter((c) => c.method !== 'GET' && c.url.includes('/upload/'));
  const cloud = (id) => parseBackup(drive.backupFiles()[0].body).projects.find((p) => p.id === id);

  it('boot: the legacy project gets its capsule and reaches Drive with NO edit by the user; updatedAt untouched', async () => {
    const legacy = legacyProject();
    await projectStore.save(legacy);
    await putCloud([legacy]); // Drive holds the old (capsule-less) copy
    h = createHost(App);
    await h.mount();
    await flush(AUTO_SYNC.debounceMs + 2500); // nobody touches anything
    const stored = (await projectStore.load()).find((p) => p.id === legacy.id);
    expect(stored.draft.capsule).toBeTruthy();
    expect(stored.updatedAt).toBe(777);
    expect(uploads().length).toBeGreaterThan(0);
    const remote = cloud(legacy.id);
    expect(remote.draft.capsule).toBeTruthy();
    expect(remote.updatedAt).toBe(777);
    expect(remote.totals.total).toBe(stored.totals.total);
  }, 40_000);

  it('boot with a sealed copy already in Drive: the project sealed on this device still ends up uploaded without any edit', async () => {
    const legacy = legacyProject('Casa Boot');
    await projectStore.save(legacy); // legacy here
    await putCloud([recalculateProjectTotals(legacy)]); // sealed there: the merge alone sees no difference
    h = createHost(App);
    await h.mount();
    await flush(AUTO_SYNC.debounceMs + 2500);
    expect((await projectStore.load()).find((p) => p.id === legacy.id).draft.capsule).toBeTruthy();
    expect(uploads().length).toBeGreaterThan(0);
  }, 40_000);

  it('pull: another device uploads a legacy copy of an already sealed project -> this device repairs the cloud copy', async () => {
    const legacy = legacyProject('Casa Remota');
    await projectStore.save(recalculateProjectTotals(legacy));
    await putCloud([legacy]);
    h = createHost(App);
    await h.mount();
    await flush(AUTO_SYNC.debounceMs + 2500);
    expect(uploads().length).toBeGreaterThan(0);
    expect(cloud(legacy.id).draft.capsule).toBeTruthy();
  }, 40_000);

  it('an already sealed project does not trigger any upload by itself', async () => {
    const sealed = recalculateProjectTotals(legacyProject('Casa Sellada'));
    await projectStore.save(sealed);
    await putCloud([sealed]);
    h = createHost(App);
    await h.mount();
    await flush(400);
    drive.calls.length = 0;
    await flush(AUTO_SYNC.debounceMs + 2000);
    expect(uploads()).toHaveLength(0);
  }, 40_000);
});
