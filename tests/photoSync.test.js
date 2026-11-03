// @vitest-environment happy-dom
// Photos across devices: a phone with 4 photos and a tablet with 2 must end with 4 on BOTH (and on Drive), whatever the project's own
// updatedAt says; deletions stay deleted; every photo change stamps the project; Drive calls have time limits.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, q, flush, click, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { collectBackup, parseBackup, restoreBackup, serializeBackup } from '../src/lib/backup.js';
import { createDriveClient, DRIVE_TIMEOUTS, DriveError } from '../src/lib/drive.js';
import { clearDriveToken, setDriveToken } from '../src/lib/driveToken.js';
import { projectStore } from '../src/lib/projectStore.js';
import { photoStoreFor } from '../src/lib/photoStore.js';
import { newProject, normalizeProject } from '../src/lib/projects.js';
import { mergePhotoSlots, mergeProject } from '../src/lib/merge.js';
import { diffPhotos, emptySlots } from '../src/lib/photos.js';
import { normalizeCompany } from '../src/lib/draft.js';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const variant = (k) => {
  const at = JPEG.indexOf('//////') + 10 + (k % 20);
  return JPEG.slice(0, at) + 'ABCD'[Math.floor(k / 20) % 4] + JPEG.slice(at + 1);
};
const ph = (slot, at, v = slot) => ({ slot, dataUrl: variant(v), width: 1080, height: 810, bytes: 10, at });
const slotsOf = (...list) => {
  const a = emptySlots();
  for (const p of list) a[p.slot] = p;
  return a;
};

describe('mergePhotoSlots: per-slot deep merge', () => {
  it('keeps the UNION: a stale device with 2 photos receives the 2 it lacks and loses nothing', () => {
    const tablet = slotsOf(ph(0, 10), ph(1, 20));
    const phone = slotsOf(ph(0, 10), ph(1, 20), ph(2, 30), ph(3, 40));
    const r = mergePhotoSlots(tablet, phone, {});
    expect(r.slots.filter(Boolean).map((p) => p.slot)).toEqual([0, 1, 2, 3]);
    expect(r.fromRemote.map((p) => p.slot)).toEqual([2, 3]); // what the tablet has to write
    expect(r.localAhead).toBe(false);
    // and the other way round nothing is lost either: the phone is "ahead" of a tablet backup and keeps its photos
    const back = mergePhotoSlots(phone, tablet, {});
    expect(back.slots.filter(Boolean)).toHaveLength(4);
    expect(back.fromRemote).toEqual([]);
    expect(back.localAhead).toBe(true); // the backup lacks two: the merged whole must go up
  });

  it('on the same slot the NEWEST capture wins, and the tie is broken the same way on both devices (they converge)', () => {
    const a = slotsOf(ph(0, 100, 1));
    const b = slotsOf(ph(0, 200, 2));
    expect(mergePhotoSlots(a, b, {}).slots[0].at).toBe(200);
    expect(mergePhotoSlots(b, a, {}).slots[0].at).toBe(200); // an old cached copy never overwrites a newer photo
    const t1 = slotsOf(ph(0, 100, 1));
    const t2 = slotsOf(ph(0, 100, 2));
    expect(mergePhotoSlots(t1, t2, {}).slots[0].dataUrl).toBe(mergePhotoSlots(t2, t1, {}).slots[0].dataUrl);
  });

  it('a deletion (photoTomb) outlives the merge: the older photo is dropped, a newer one taken after the deletion stays', () => {
    const mine = slotsOf(ph(0, 100), ph(1, 500));
    const theirs = slotsOf(ph(0, 100), ph(1, 500));
    const r = mergePhotoSlots(mine, theirs, { 0: 300, 1: 300 });
    expect(r.slots[0]).toBeNull();
    expect(r.dropLocal).toEqual([0]);
    expect(r.slots[1].at).toBe(500); // taken after the deletion: alive
  });

  it('mergeProject unions photoTomb by the newest deletion of each slot', () => {
    const a = { id: 'p1', updatedAt: 5, photoTomb: { 0: 100, 2: 50 } };
    const b = { id: 'p1', updatedAt: 9, photoTomb: { 0: 70, 3: 80 } };
    expect(mergeProject(a, b).photoTomb).toEqual({ 0: 100, 3: 80, 2: 50 });
    expect(normalizeProject({ ...newProject({ regionCode: 'CL', name: 'X', now: 1 }), photoTomb: { 1: 99, 77: 5, bad: 'x' } }).photoTomb).toEqual({ 1: 99, 77: 5 });
  });
});

describe('diffPhotos', () => {
  it('detects add / replace / remove', () => {
    const base = slotsOf(ph(0, 1), ph(1, 2));
    expect(diffPhotos(base, base)).toEqual({ changed: false, removed: [] });
    expect(diffPhotos(base, slotsOf(ph(0, 1), ph(1, 2), ph(2, 3)))).toEqual({ changed: true, removed: [] });
    expect(diffPhotos(base, slotsOf(ph(0, 1), ph(1, 9, 5)))).toEqual({ changed: true, removed: [] });
    expect(diffPhotos(base, slotsOf(ph(1, 2)))).toEqual({ changed: true, removed: [0] });
  });
});

describe('restoreBackup reconciles photos even when the project record is identical', () => {
  it('the tablet gets the phone\'s 4 photos although the project did not change, and flags nothing to overwrite Drive with', async () => {
    const p = newProject({ regionCode: 'CL', name: 'Casa', now: 100 });
    const phone = [ph(0, 10), ph(1, 20), ph(2, 30), ph(3, 40)];
    const remote = parseBackup(serializeBackup(await collectBackup({ settings: { region: 'CL', lang: 'es' }, company: normalizeCompany({}), meta: { onboarded: true, drive: true }, logo: '', projects: [p], loadPhotos: async () => phone, workers: [], tombs: { projects: {}, workers: {} } })));
    const tabletStore = { rows: slotsOf(ph(0, 10), ph(1, 20)) };
    const stores = {
      projectStore: { save: async () => {}, remove: async () => {} },
      photoStoreFor: () => ({ load: async () => tabletStore.rows, save: async (x) => { tabletStore.rows[x.slot] = x; }, remove: async (s) => { tabletStore.rows[s] = null; } }),
      logoStore: { save: async () => {} },
    };
    const local = { settings: { region: 'CL', lang: 'es' }, company: normalizeCompany({ name: 'A' }), meta: { onboarded: true, drive: true }, logo: '', projects: [p], tombs: { projects: {}, workers: {} } };
    const out = await restoreBackup(local, remote, stores);
    expect(out.wonProjects).toEqual([]); // the record did not change: the old code never even looked at the photos
    expect(tabletStore.rows.filter(Boolean).map((x) => x.slot)).toEqual([0, 1, 2, 3]);
    expect(out.photosChanged).toEqual([p.id]);
  });
});

describe('Drive time limits', () => {
  it('requests carry an abort signal, the limits are generous (30 s metadata / 90 s transfers) and a stalled call fails as offline instead of hanging', async () => {
    expect(DRIVE_TIMEOUTS.api).toBeGreaterThanOrEqual(20_000);
    expect(DRIVE_TIMEOUTS.transfer).toBeGreaterThanOrEqual(30_000);
    const seen = [];
    const fetchImpl = (url, init) =>
      new Promise((resolve, reject) => {
        seen.push({ url, signal: init.signal });
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const client = createDriveClient({ getToken: async () => 'tok-123456', fetchImpl, timeouts: { api: 40, transfer: 80 } });
    const started = Date.now();
    await expect(client.peekBackup()).rejects.toMatchObject({ code: 'offline' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(seen[0].signal).toBeTruthy();
    expect(seen[0].signal.aborted).toBe(true);
    expect(new DriveError('offline').code).toBe('offline');
  });

  it('a slow but healthy upload (answers after the metadata limit, before the transfer limit) still succeeds', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(init.method || 'GET');
      const isUpload = String(url).includes('/upload/');
      if (isUpload) await new Promise((r) => setTimeout(r, 120)); // longer than the 60 ms "api" limit
      const body = isUpload ? { id: 'file12345', modifiedTime: 'x' } : String(url).includes('mimeType') ? { files: [{ id: 'folder12345' }] } : { files: [] };
      return { ok: true, status: 200, json: async () => body, text: async () => '' };
    };
    const client = createDriveClient({ getToken: async () => 'tok-123456', fetchImpl, timeouts: { api: 60, transfer: 600 } });
    await expect(client.saveBackup('{"a":1}')).resolves.toMatchObject({ id: 'file12345' });
  });
});

describe('app: photo changes stamp the project and Drive keeps the phone\'s photos', () => {
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
    for (const p of await projectStore.load()) {
      await projectStore.remove(p.id);
      await photoStoreFor(p.id).clear();
    }
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
  const client = () => createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl });
  const cloud = () => parseBackup(drive.backupFiles()[0].body);

  it('opening the stale tablet pulls the 2 missing photos and does NOT overwrite the phone\'s 4 on Drive', async () => {
    const p = newProject({ regionCode: 'CL', name: 'Casa Compartida', now: 100, company: { name: 'Aurora' } });
    await projectStore.save(p); // the same record on both devices
    const tablet = photoStoreFor(p.id);
    await tablet.save(ph(0, 10));
    await tablet.save(ph(1, 20));
    const text = serializeBackup(await collectBackup({ settings: { region: 'CL', lang: 'es' }, company: normalizeCompany({ name: 'Aurora' }), meta: { onboarded: true, drive: true }, logo: '', projects: [p], loadPhotos: async () => [ph(0, 10), ph(1, 20), ph(2, 30), ph(3, 40)] }));
    await client().saveBackup(text);
    h = createHost(App);
    await h.mount();
    await flush(400);
    const local = (await photoStoreFor(p.id).load()).filter(Boolean);
    expect(local.map((x) => x.slot).sort()).toEqual([0, 1, 2, 3]); // the tablet now has all four
    await flush(3600);
    expect(cloud().photos[p.id].map((x) => x.slot).sort()).toEqual([0, 1, 2, 3]); // and Drive was never reduced to two
  });

  it('adding and deleting a photo stamps the project (updatedAt) at once, and a deletion leaves a photoTomb entry', async () => {
    const p = newProject({ regionCode: 'CL', name: 'Casa Foto', now: 100, company: { name: 'Aurora' } });
    await projectStore.save(p);
    await photoStoreFor(p.id).save(ph(0, 10));
    await photoStoreFor(p.id).save(ph(1, 20));
    h = createHost(App);
    await h.mount();
    await flush(300);
    await click(q('project-card') ?? document.querySelector('[data-testid="project-card"]'));
    await flush(300);
    await click(q('dock-camera'));
    await flush(100);
    const before = (await projectStore.load()).find((x) => x.id === p.id).updatedAt;
    await click(q('photo-edit-toggle'));
    await click(q('snap-remove-0'));
    await flush(400);
    const after = (await projectStore.load()).find((x) => x.id === p.id);
    expect(after.updatedAt).toBeGreaterThan(before); // the sync engine sees the change
    expect(Object.keys(after.photoTomb || {})).toEqual(['0']);
    expect((await photoStoreFor(p.id).load()).filter(Boolean).map((x) => x.slot)).toEqual([1]);
  });
});
