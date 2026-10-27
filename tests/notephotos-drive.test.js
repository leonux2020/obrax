// @vitest-environment happy-dom
// The whole cycle in the real App: device A backs up to Drive (Blob -> base64 only inside the JSON), the phone is lost,
// device B restores (base64 -> Blob in IndexedDB) and the Bitácora thumbnails read the restored Blobs.
import 'fake-indexeddb/auto'; // the app's real IndexedDB stores (not the in-memory fallback)
import { Blob as NodeBlob } from 'node:buffer';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, q, flush, click, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { parseBackup } from '../src/lib/backup.js';
import { clearDriveToken } from '../src/lib/driveToken.js';
import { projectStore } from '../src/lib/projectStore.js';
import { notePhotosFor } from '../src/lib/notePhotos.js';
import { newProject } from '../src/lib/projects.js';
import { STORE_PHOTOS, createRunner } from '../src/lib/db.js';

// happy-dom's Blob does not survive fake-indexeddb's structured clone (a real browser keeps it): Node's does
globalThis.Blob = NodeBlob;

const BYTES = Uint8Array.from({ length: 2000 }, (_, i) => (i * 13 + 5) % 256);
const JPEG = `data:image/jpeg;base64,${Buffer.from(BYTES).toString('base64')}`;
let App;
let resetBoot;
let drive;
let h;
let project;

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
  ({ default: App, resetBoot } = await import('../src/App.jsx'));
});

const profile = () => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Ana', email: 'ana@example.com' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
};
const wipe = async () => {
  for (const p of await projectStore.load()) {
    await projectStore.remove(p.id);
    await notePhotosFor(p.id).clear();
  }
};
const mount = async () => {
  resetBoot();
  h = createHost(App);
  await h.mount();
  await flush(100);
};

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  drive = createFakeDrive();
  vi.stubGlobal('fetch', drive.fetchImpl);
  installFakeGoogle(drive);
  URL.createObjectURL = vi.fn(() => 'blob:restored-photo');
  URL.revokeObjectURL = vi.fn();
  await wipe();
});
afterEach(async () => {
  h?.unmount();
  vi.unstubAllGlobals();
  delete window.google;
  await wipe();
});

describe('Drive cycle of the logbook photos', () => {
  it('A: "Respaldar ahora" uploads the note photo (base64 inside the JSON only); B: restore brings the Blob back and the thumbnail reads it', async () => {
    // ---- device A
    profile();
    project = {
      ...newProject({ regionCode: 'CL', name: 'Casa Norte', now: 1000 }),
      logbook: [{ id: 'nota0001', at: 5, text: 'Material dañado', photo: true }, { id: 'nota0002', at: 4, text: 'Sin foto' }],
    };
    await projectStore.save(project);
    await notePhotosFor(project.id).put('nota0001', { dataUrl: JPEG, width: 800, height: 600, at: 9 });
    await mount();
    await click(h.tab('Ajustes'));
    await click(q('backup-now'));
    await flush(300);
    const [file] = drive.backupFiles();
    expect(file).toBeTruthy();
    const raw = JSON.parse(file.body);
    expect(raw.notePhotos[project.id].nota0001.dataUrl).toBe(JPEG); // the picture travels as base64 inside the payload...
    expect(Object.keys(raw.notePhotos[project.id])).toEqual(['nota0001']);
    expect(JSON.stringify(raw.projects)).not.toContain('data:image'); // ...and the project JSON only says photo:true
    expect(parseBackup(file.body).notePhotos[project.id].nota0001.width).toBe(800);

    // ---- the phone is lost: device B has nothing of this project
    h.unmount();
    await wipe();
    expect(await notePhotosFor(project.id).get('nota0001')).toBeNull();
    await mount();
    expect(document.querySelectorAll('[data-testid="project-card"]')).toHaveLength(0);
    await click(h.tab('Ajustes'));
    await click(q('backup-restore'));
    await flush(300);
    expect(q('backup-note').textContent).toContain('Respaldo restaurado');

    // IndexedDB: a Blob row (never base64), the same bytes, the link in the project
    const rows = await createRunner(indexedDB)(STORE_PHOTOS, 'readonly', (s) => s.getAll());
    const row = rows.find((r) => r.noteId === 'nota0001');
    expect(row.blob).toBeInstanceOf(NodeBlob);
    expect(row.dataUrl).toBeUndefined();
    expect([...new Uint8Array(await row.blob.arrayBuffer())]).toEqual([...BYTES]);
    expect((await projectStore.load())[0].logbook.find((e) => e.id === 'nota0001').photo).toBe(true);
    expect(JSON.stringify({ ...localStorage })).not.toContain('data:image/jpeg');

    // the Bitácora accordion reads the restored Blob
    await click(h.host.querySelector('[data-testid="project-card"]'));
    await click(q('ws-log').querySelector('summary'));
    await flush(60);
    const thumb = q('wlog-thumb-nota0001');
    expect(thumb).not.toBeNull();
    expect(thumb.querySelector('img').getAttribute('src')).toBe('blob:restored-photo');
    expect(q('wlog-thumb-nota0002')).toBeNull();
  }, 30_000);
});
