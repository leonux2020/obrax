// Structured export ("Expediente") to Drive: CUBRAX - Respaldos Obra / Proyectos / <project> / { PDF + Sheet + every photo }, FLAT.
import { describe, it, expect } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { createDriveClient, BACKUP_FOLDER } from '../src/lib/drive.js';
import { PROJECTS_FOLDER, folderNameFor, slug, collectDossierImages, syncDossier } from '../src/lib/driveExport.js';
import { normalizeExpenses } from '../src/lib/ledger.js';
import { normalizeReceiptPhoto, receiptPhotosFor } from '../src/lib/receiptPhotos.js';

const bytesOf = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => 65 + ((i + seed) % 26)); // ASCII, so the fake can compare text
const img = (name, n, seed) => ({ name, mimeType: 'image/jpeg', load: async () => bytesOf(n, seed) });
const doc = (name, n = 30) => ({ name, mimeType: 'application/pdf', bytes: bytesOf(n) });
const clientFor = (drive) => createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl });
const folder = (drive, name, parentName) => {
  const parent = parentName ? drive.folders().find((f) => f.name === parentName) : null;
  return drive.folders().filter((f) => f.name === name && (!parent || f.parents.includes(parent.id)));
};
const inFolder = (drive, f) => drive.backupFiles().filter((x) => x.parents.includes(f.id)).map((x) => x.name).sort();
const uploadsOf = (drive) => drive.calls.filter((c) => c.method !== 'GET' && c.url.includes('/upload/'));

const run = (drive, extra = {}) =>
  syncDossier({
    client: clientFor(drive),
    title: 'Obra Norte',
    documents: async () => [doc('Informe-Contratista-Obra-Norte.pdf'), doc('Rendicion-Obra-Norte.xlsx', 40)],
    images: [img('Obra_2026-10-01_1.jpg', 100, 1), img('Obra_2026-10-01_2.jpg', 120, 2), img('Bitacora_2026-10-02_Material-danado_nota01.jpg', 90, 3), img('Comprobante_2026-10-03_Ferreteria-Sur_rcpt01.jpg', 80, 4)],
    ...extra,
  });

describe('folder tree', () => {
  it('creates CUBRAX - Respaldos Obra / Proyectos / <project>, each inside its parent, and NOTHING below the project', async () => {
    const drive = createFakeDrive();
    const stats = await run(drive);
    const root = folder(drive, BACKUP_FOLDER);
    const proyectos = folder(drive, PROJECTS_FOLDER);
    const project = folder(drive, 'Obra Norte');
    for (const list of [root, proyectos, project]) expect(list).toHaveLength(1);
    expect(root[0].parents).toEqual(['root']);
    expect(proyectos[0].parents).toEqual([root[0].id]);
    expect(project[0].parents).toEqual([proyectos[0].id]);
    expect(drive.folders()).toHaveLength(3); // no "Fotos Obra", no "Comprobantes"
    expect(stats.folderId).toBe(project[0].id);
  });

  it('routes every file (documents, camera photos, logbook photos, receipts) straight to the project folder', async () => {
    const drive = createFakeDrive();
    const stats = await run(drive);
    expect(inFolder(drive, folder(drive, 'Obra Norte')[0])).toEqual([
      'Bitacora_2026-10-02_Material-danado_nota01.jpg',
      'Comprobante_2026-10-03_Ferreteria-Sur_rcpt01.jpg',
      'Informe-Contratista-Obra-Norte.pdf',
      'Obra_2026-10-01_1.jpg',
      'Obra_2026-10-01_2.jpg',
      'Rendicion-Obra-Norte.xlsx',
    ]);
    expect(stats).toMatchObject({ documents: 2, uploaded: 4, unchanged: 0, failed: 0, total: 6 });
    const pdf = drive.backupFiles().find((f) => f.name.endsWith('.pdf'));
    expect(pdf.body.length).toBe(30); // the bytes arrive intact (binary multipart)
  });

  it('a project without photos creates no subfolders either', async () => {
    const drive = createFakeDrive();
    await run(drive, { images: [] });
    expect(drive.folders().map((f) => f.name).sort()).toEqual([BACKUP_FOLDER, PROJECTS_FOLDER, 'Obra Norte'].sort());
  });

  it('is idempotent: syncing again creates no folder and no file, and photos already there are not sent again', async () => {
    const drive = createFakeDrive();
    await run(drive);
    const folders = drive.folders().length;
    const files = drive.backupFiles().length;
    drive.calls.length = 0;
    const again = await run(drive);
    expect(drive.folders()).toHaveLength(folders);
    expect(drive.backupFiles()).toHaveLength(files);
    expect(again).toMatchObject({ unchanged: 4, uploaded: 0, documents: 2 });
    expect(uploadsOf(drive).every((c) => c.method === 'PATCH')).toBe(true); // the documents are replaced in place
    expect(uploadsOf(drive)).toHaveLength(2);
  });

  it('a project name with quotes or characters Windows forbids still works and lands in ONE folder', async () => {
    expect(folderNameFor('  Casa: "Norte"/Sur?  ')).toBe('Casa Norte Sur');
    expect(folderNameFor('...')).toBe('Proyecto');
    expect(slug('Material dañado!!')).toBe('Material-danado');
    const drive = createFakeDrive();
    await run(drive, { title: "Casa D'Arcy" });
    await run(drive, { title: "Casa D'Arcy" });
    expect(folder(drive, "Casa D'Arcy")).toHaveLength(1);
  });
});

describe('cache, concurrency and errors', () => {
  it('"Proyectos" is looked up and created ONCE however many photos go up', async () => {
    const drive = createFakeDrive();
    await run(drive, { images: Array.from({ length: 9 }, (_, i) => img(`Obra_${i}.jpg`, 50 + i, i)) });
    const lookups = drive.calls.filter((c) => c.method === 'GET' && decodeURIComponent(c.url).includes("name='Proyectos'"));
    const creations = drive.calls.filter((c) => c.method === 'POST' && !c.url.includes('/upload/') && c.body.includes('"Proyectos"'));
    expect(lookups).toHaveLength(1);
    expect(creations).toHaveLength(1);
  });

  it('uploads photos IN SINGLE FILE: one at a time (never two in flight), in the order they were given', async () => {
    const drive = createFakeDrive();
    let inflight = 0;
    let peak = 0;
    const order = [];
    const fetchImpl = async (url, init) => {
      const isImg = String(url).includes('/upload/') && init?.method === 'POST';
      if (!isImg) return drive.fetchImpl(url, init);
      inflight += 1;
      peak = Math.max(peak, inflight);
      order.push(JSON.parse(new TextDecoder().decode(init.body.slice(0, 400)).split('\r\n\r\n')[1].split('\r\n')[0]).name);
      await new Promise((r) => setTimeout(r, 8));
      inflight -= 1;
      return drive.fetchImpl(url, init);
    };
    const client = createDriveClient({ getToken: async () => drive.token, fetchImpl });
    await syncDossier({ client, title: 'Obra', images: Array.from({ length: 12 }, (_, i) => img(`Obra_${i}.jpg`, 60 + i, i)) });
    expect(peak).toBe(1);
    expect(order).toEqual(Array.from({ length: 12 }, (_, i) => `Obra_${i}.jpg`));
    expect(drive.backupFiles()).toHaveLength(12);
  });

  it('one photo that fails does not stop the rest: it is counted as failed', async () => {
    const drive = createFakeDrive();
    const bad = { name: 'Obra_rota.jpg', mimeType: 'image/jpeg', load: async () => { throw new Error('unreadable'); } };
    const stats = await run(drive, { images: [img('Obra_a.jpg', 50, 1), bad, img('Obra_b.jpg', 60, 2), img('Comprobante_a.jpg', 70, 3)] });
    expect(stats.failed).toBe(1);
    expect(stats.uploaded).toBe(3);
  });

  it('no coverage: the sync stops with an "offline" error; rate limit: stops with "quota" instead of hammering Google', async () => {
    const drive = createFakeDrive();
    drive.state.offline = true;
    await expect(run(drive)).rejects.toMatchObject({ code: 'offline' });
    drive.state.offline = false;

    const limited = createFakeDrive();
    let uploads = 0;
    const fetchImpl = async (url, init) => {
      if (String(url).includes('/upload/') && init?.method === 'POST') {
        uploads += 1;
        return { ok: false, status: 429, json: async () => ({}), text: async () => '' };
      }
      return limited.fetchImpl(url, init);
    };
    const client = createDriveClient({ getToken: async () => limited.token, fetchImpl });
    await expect(
      syncDossier({ client, title: 'Obra', images: Array.from({ length: 30 }, (_, i) => img(`Obra_${i}.jpg`, 40, i)) })
    ).rejects.toMatchObject({ code: 'quota' });
    expect(uploads).toBe(1); // single file: the first answer (429) stops the whole run, nothing else is sent
  });

  it('a cached folder deleted from Drive (404) is looked up again once and the sync completes', async () => {
    const drive = createFakeDrive();
    const client = clientFor(drive);
    const args = { client, title: 'Obra Norte', images: [img('Obra_a.jpg', 50, 1)] };
    await syncDossier(args);
    for (const f of [...drive.files.values()]) drive.files.delete(f.id); // the user emptied the Drive
    const stats = await syncDossier(args);
    expect(stats.uploaded).toBe(1);
    expect(folder(drive, 'Obra Norte')).toHaveLength(1);
  });

  it('reports progress after every file', async () => {
    const drive = createFakeDrive();
    const seen = [];
    await run(drive, { onProgress: (p) => seen.push(p.done) });
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('what goes into the project folder', () => {
  const project = {
    logbook: [
      { id: 'nota0001abc', at: Date.UTC(2026, 9, 2), text: 'Material dañado', photo: true },
      { id: 'nota0002', at: 5, text: 'Sin foto' },
    ],
    expenses: [
      { id: 'e1', at: Date.UTC(2026, 9, 3), supplier: 'Ferretería Sur', description: 'Cemento', amount: 10, receiptId: 'rcpt01aaaa' },
      { id: 'e2', at: Date.UTC(2026, 9, 3), supplier: 'Ferretería Sur', description: 'Arena', amount: 5, receiptId: 'rcpt01aaaa' },
      { id: 'e3', at: 1, supplier: '', description: 'Sin foto', amount: 1 },
    ],
  };
  it('camera photos, photos of logbook notes and one receipt photo per receipt (shared by its lines) come as ONE flat list', async () => {
    const JPEG = `data:image/jpeg;base64,${Buffer.from(bytesOf(50)).toString('base64')}`;
    const photos = await collectDossierImages(project, {
      cameraPhotos: async () => [null, { slot: 1, dataUrl: JPEG, at: Date.UTC(2026, 9, 1) }],
      notePhoto: async (id) => (id === 'nota0001abc' ? { blob: new Blob([bytesOf(40)], { type: 'image/jpeg' }) } : null),
      receiptPhoto: async () => ({ blob: new Blob([bytesOf(30)], { type: 'image/jpeg' }) }),
    });
    expect(Array.isArray(photos)).toBe(true);
    expect(photos.map((x) => x.name)).toEqual([`Obra_2026-10-01_2_${Date.UTC(2026, 9, 1)}.jpg`, 'Bitacora_2026-10-02_Material-danado_nota0001abc.jpg', 'Comprobante_2026-10-03_Ferreteria-Sur_rcpt01aaaa.jpg']);
    expect(new Set(photos.map((x) => x.name)).size).toBe(3); // the names never collide in the shared folder
    expect((await photos[0].load()).length).toBe(50);
    expect((await photos[1].load()).length).toBe(40);
    expect((await photos[2].load()).length).toBe(30);
  });
});

describe('receipt photos are kept with the expenses', () => {
  it('expense lines keep a valid receiptId and drop a bad one', () => {
    const [a, b] = normalizeExpenses([
      { id: 'e1', amount: 5, receiptId: 'abc123xyz' },
      { id: 'e2', amount: 5, receiptId: '<script>' },
    ]);
    expect(a.receiptId).toBe('abc123xyz');
    expect(b.receiptId).toBeUndefined();
  });

  it('the store keeps the photo as a Blob (dimensions optional, up to the receipt ceiling) and rejects non-images', async () => {
    const store = receiptPhotosFor('proj00001');
    const JPEG = `data:image/jpeg;base64,${Buffer.from(bytesOf(300)).toString('base64')}`;
    await store.put('rcpt01aaaa', { dataUrl: JPEG, at: 7 });
    const got = await store.get('rcpt01aaaa');
    expect(got.blob.size).toBe(300);
    expect(got.blob.type).toBe('image/jpeg');
    await expect(store.put('rcpt02', { dataUrl: 'data:text/plain;base64,QUJD' })).rejects.toThrow();
    expect(normalizeReceiptPhoto({ blob: new Blob([new Uint8Array(1_300_000)], { type: 'image/jpeg' }) })).toBeNull();
    await store.clear();
    expect(await store.get('rcpt01aaaa')).toBeNull();
  });
});
