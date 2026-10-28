// Structured export ("Expediente") to Drive: CUBRAX - Respaldos Obra / Proyectos / <project> / { PDF+Excel, Fotos Obra, Comprobantes }.
import { describe, it, expect } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { createDriveClient, BACKUP_FOLDER } from '../src/lib/drive.js';
import { PROJECTS_FOLDER, PHOTOS_FOLDER, RECEIPTS_FOLDER, EXPORT_CONCURRENCY, mapLimit, folderNameFor, slug, collectDossierImages, syncDossier } from '../src/lib/driveExport.js';
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
    images: { obra: [img('Obra_2026-10-01_1.jpg', 100, 1), img('Obra_2026-10-01_2.jpg', 120, 2), img('Bitacora_2026-10-02_Material-danado_nota01.jpg', 90, 3)], comprobantes: [img('Comprobante_2026-10-03_Ferreteria-Sur_rcpt01.jpg', 80, 4)] },
    ...extra,
  });

describe('folder tree', () => {
  it('creates CUBRAX - Respaldos Obra / Proyectos / <project> / Fotos Obra + Comprobantes, each inside its parent', async () => {
    const drive = createFakeDrive();
    const stats = await run(drive);
    const root = folder(drive, BACKUP_FOLDER);
    const proyectos = folder(drive, PROJECTS_FOLDER);
    const project = folder(drive, 'Obra Norte');
    const obra = folder(drive, PHOTOS_FOLDER);
    const comp = folder(drive, RECEIPTS_FOLDER);
    for (const list of [root, proyectos, project, obra, comp]) expect(list).toHaveLength(1);
    expect(root[0].parents).toEqual(['root']);
    expect(proyectos[0].parents).toEqual([root[0].id]);
    expect(project[0].parents).toEqual([proyectos[0].id]);
    expect(obra[0].parents).toEqual([project[0].id]);
    expect(comp[0].parents).toEqual([project[0].id]);
    expect(stats.folderId).toBe(project[0].id);
  });

  it('routes every file: the documents to the project root, progress photos to "Fotos Obra", receipts to "Comprobantes"', async () => {
    const drive = createFakeDrive();
    const stats = await run(drive);
    expect(inFolder(drive, folder(drive, 'Obra Norte')[0])).toEqual(['Informe-Contratista-Obra-Norte.pdf', 'Rendicion-Obra-Norte.xlsx']);
    expect(inFolder(drive, folder(drive, PHOTOS_FOLDER)[0])).toEqual(['Bitacora_2026-10-02_Material-danado_nota01.jpg', 'Obra_2026-10-01_1.jpg', 'Obra_2026-10-01_2.jpg']);
    expect(inFolder(drive, folder(drive, RECEIPTS_FOLDER)[0])).toEqual(['Comprobante_2026-10-03_Ferreteria-Sur_rcpt01.jpg']);
    expect(stats).toMatchObject({ documents: 2, uploaded: 4, unchanged: 0, failed: 0, total: 6 });
    const pdf = drive.backupFiles().find((f) => f.name.endsWith('.pdf'));
    expect(pdf.body.length).toBe(30); // the bytes arrive intact (binary multipart)
  });

  it('even a project without photos gets both subfolders (the structure is always there)', async () => {
    const drive = createFakeDrive();
    await run(drive, { images: { obra: [], comprobantes: [] } });
    expect(folder(drive, PHOTOS_FOLDER)).toHaveLength(1);
    expect(folder(drive, RECEIPTS_FOLDER)).toHaveLength(1);
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
    await run(drive, { images: { obra: Array.from({ length: 9 }, (_, i) => img(`Obra_${i}.jpg`, 50 + i, i)), comprobantes: [] } });
    const lookups = drive.calls.filter((c) => c.method === 'GET' && decodeURIComponent(c.url).includes("name='Proyectos'"));
    const creations = drive.calls.filter((c) => c.method === 'POST' && !c.url.includes('/upload/') && c.body.includes('"Proyectos"'));
    expect(lookups).toHaveLength(1);
    expect(creations).toHaveLength(1);
  });

  it('uploads photos at most 3 at a time (and really in parallel)', async () => {
    const drive = createFakeDrive();
    let inflight = 0;
    let peak = 0;
    const fetchImpl = async (url, init) => {
      const isImg = String(url).includes('/upload/') && init?.method === 'POST' && String(init.body.length ?? 0) > 0 && !String(url).includes('xlsx');
      if (!isImg) return drive.fetchImpl(url, init);
      inflight += 1;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 15));
      inflight -= 1;
      return drive.fetchImpl(url, init);
    };
    const client = createDriveClient({ getToken: async () => drive.token, fetchImpl });
    await syncDossier({ client, title: 'Obra', images: { obra: Array.from({ length: 12 }, (_, i) => img(`Obra_${i}.jpg`, 60 + i, i)), comprobantes: [] } });
    expect(EXPORT_CONCURRENCY).toBe(3);
    expect(peak).toBe(3);
    expect(drive.backupFiles()).toHaveLength(12);
  });

  it('mapLimit never exceeds the limit, keeps the order and reports failures without rejecting', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      if (n === 4) throw new Error('boom');
      return n * 2;
    });
    expect(peak).toBe(3);
    expect(out.map((x) => (x.ok ? x.value : 'x'))).toEqual([2, 4, 6, 'x', 10, 12, 14]);
    expect(await mapLimit([], 3, async () => 1)).toEqual([]);
  });

  it('one photo that fails does not stop the rest: it is counted as failed', async () => {
    const drive = createFakeDrive();
    const bad = { name: 'Obra_rota.jpg', mimeType: 'image/jpeg', load: async () => { throw new Error('unreadable'); } };
    const stats = await run(drive, { images: { obra: [img('Obra_a.jpg', 50, 1), bad, img('Obra_b.jpg', 60, 2)], comprobantes: [img('Comprobante_a.jpg', 70, 3)] } });
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
      syncDossier({ client, title: 'Obra', images: { obra: Array.from({ length: 30 }, (_, i) => img(`Obra_${i}.jpg`, 40, i)), comprobantes: [] } })
    ).rejects.toMatchObject({ code: 'quota' });
    expect(uploads).toBeLessThanOrEqual(EXPORT_CONCURRENCY); // only the ones already in flight
  });

  it('a cached folder deleted from Drive (404) is looked up again once and the sync completes', async () => {
    const drive = createFakeDrive();
    const client = clientFor(drive);
    const args = { client, title: 'Obra Norte', images: { obra: [img('Obra_a.jpg', 50, 1)], comprobantes: [] } };
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

describe('what goes to each folder', () => {
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
  it('camera photos + photos of logbook notes -> Fotos Obra; one receipt photo per receipt (shared by its lines) -> Comprobantes', async () => {
    const JPEG = `data:image/jpeg;base64,${Buffer.from(bytesOf(50)).toString('base64')}`;
    const { obra, comprobantes } = await collectDossierImages(project, {
      cameraPhotos: async () => [null, { slot: 1, dataUrl: JPEG, at: Date.UTC(2026, 9, 1) }],
      notePhoto: async (id) => (id === 'nota0001abc' ? { blob: new Blob([bytesOf(40)], { type: 'image/jpeg' }) } : null),
      receiptPhoto: async () => ({ blob: new Blob([bytesOf(30)], { type: 'image/jpeg' }) }),
    });
    expect(obra.map((x) => x.name)).toEqual(['Obra_2026-10-01_2.jpg', 'Bitacora_2026-10-02_Material-danado_nota00.jpg']);
    expect(comprobantes.map((x) => x.name)).toEqual(['Comprobante_2026-10-03_Ferreteria-Sur_rcpt01.jpg']);
    expect((await obra[0].load()).length).toBe(50);
    expect((await obra[1].load()).length).toBe(40);
    expect((await comprobantes[0].load()).length).toBe(30);
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
