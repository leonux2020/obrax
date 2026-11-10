// "Creación Atómica Segura": a photo / PDF is born INSIDE the folder of its project (parents in the metadata of the very same upload
// request), never in the root of the Drive and never moved afterwards. Also: the exact final tree of a project.
import { describe, it, expect } from 'vitest';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { createDriveClient, DriveError, BACKUP_FOLDER, BACKUP_FILE, isFolderId } from '../src/lib/drive.js';
import { PROJECTS_FOLDER, GLOBAL_RENDITIONS_FOLDER, syncDossier } from '../src/lib/driveExport.js';
import { uploadRendition } from '../src/lib/exportSync.js';

const bytesOf = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => 65 + ((i + seed) % 26));
const img = (name, n, seed) => ({ name, mimeType: 'image/jpeg', load: async () => bytesOf(n, seed) });
const doc = (name, n = 30) => ({ name, mimeType: 'application/pdf', bytes: bytesOf(n) });
const clientFor = (drive) => createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl });
const IMAGES = [
  img('Obra_2026-10-01_1.jpg', 100, 1),
  img('Obra_2026-10-01_2.jpg', 120, 2),
  img('Bitacora_2026-10-02_Material-danado_nota01.jpg', 90, 3),
  img('Comprobante_2026-10-03_Ferreteria-Sur_rcpt01.jpg', 80, 4),
  img('Comprobante_2026-10-04_Pinturas_rcpt02.jpg', 70, 5),
];
const dossier = (drive, extra = {}) => syncDossier({ client: clientFor(drive), title: 'Obra Norte', documents: async () => [doc('Informe-Obra-Norte.pdf')], images: IMAGES, ...extra });

/** The Drive as the user sees it: { 'CUBRAX - Respaldos Obra': { 'Proyectos': {...}, 'x.jpg': null } } (files are null, folders are objects). */
function treeOf(drive) {
  const all = [...drive.files.values()].filter((f) => !f.trashed);
  const children = (id) => Object.fromEntries(all.filter((f) => f.parents.includes(id)).sort((a, b) => a.name.localeCompare(b.name)).map((f) => [f.name, f.mimeType.includes('folder') ? children(f.id) : null]));
  return children('root');
}
const nonFolders = (drive) => drive.backupFiles();

/** The metadata `parents` of every upload (multipart create) that went over the wire. */
const bornIn = (drive) => drive.created.map((c) => c.parents);
const moves = (drive) => drive.calls.filter((c) => c.method === 'PATCH' && /addParents/.test(c.url));

describe('uploadFile: a media file is never created without its folder', () => {
  it.each([[undefined], [null], [''], ['root'], ['x'], ['a b c d e'], [42], [{}]])('refuses the parent %j before sending a single byte', async (parent) => {
    const drive = createFakeDrive();
    const client = clientFor(drive);
    await expect(client.uploadFile(parent, { name: 'a.jpg', mimeType: 'image/jpeg', bytes: bytesOf(10) })).rejects.toMatchObject({ code: 'bad_response' });
    expect(drive.calls).toHaveLength(0);
    expect(nonFolders(drive)).toHaveLength(0);
  });

  it('refuses empty / missing bytes and a malformed existing id (nothing goes out)', async () => {
    const drive = createFakeDrive();
    const client = clientFor(drive);
    const folder = await client.ensureFolder('CUBRAX - Respaldos Obra');
    const before = drive.calls.length;
    await expect(client.uploadFile(folder, { name: 'a.jpg', bytes: undefined })).rejects.toBeInstanceOf(DriveError);
    await expect(client.uploadFile(folder, { name: 'a.jpg', bytes: null })).rejects.toBeInstanceOf(DriveError);
    await expect(client.uploadFile(folder, { name: 'a.jpg', bytes: bytesOf(5), existingId: '../x' })).rejects.toBeInstanceOf(DriveError);
    expect(drive.calls.length).toBe(before);
  });

  it('isFolderId: only a real id (never empty, never the "root" alias)', () => {
    expect(isFolderId('1AbC_dEf-9')).toBe(true);
    for (const bad of ['', 'root', undefined, null, 7, 'abc', 'a/b/c/d/e', ' 1AbC_dEf-9']) expect(isFolderId(bad)).toBe(false);
  });

  it('is atomic: ONE request, with `parents` in the metadata; no PATCH / move afterwards', async () => {
    const drive = createFakeDrive();
    const client = clientFor(drive);
    const folder = await client.ensureFolder('CUBRAX - Respaldos Obra');
    const mark = drive.calls.length;
    const { id } = await client.uploadFile(folder, { name: 'foto.jpg', mimeType: 'image/jpeg', bytes: bytesOf(30) });
    const sent = drive.calls.slice(mark);
    expect(sent).toHaveLength(1); // a single round trip: create-with-parent
    expect(sent[0].method).toBe('POST');
    expect(drive.created).toEqual([{ id, name: 'foto.jpg', parents: [folder] }]);
    expect(drive.files.get(id).parents).toEqual([folder]);
    expect(moves(drive)).toHaveLength(0);
  });

  it('silent healing: if Drive reports the file somewhere else, it is put in its folder at once', async () => {
    const drive = createFakeDrive();
    const client = clientFor(drive);
    const folder = await client.ensureFolder('CUBRAX - Respaldos Obra');
    drive.state.misplaceUploads = true;
    const { id } = await client.uploadFile(folder, { name: 'foto.jpg', mimeType: 'image/jpeg', bytes: bytesOf(30) });
    expect(drive.files.get(id).parents).toEqual([folder]);
    expect(moves(drive)).toHaveLength(1);
  });

  it('a failing healing never turns a stored photo into an error', async () => {
    const drive = createFakeDrive();
    const client = clientFor(drive);
    const folder = await client.ensureFolder('CUBRAX - Respaldos Obra');
    drive.state.misplaceUploads = true;
    const flaky = createDriveClient({ getToken: async () => drive.token, fetchImpl: (url, init) => (init?.method === 'PATCH' ? Promise.reject(new TypeError('network')) : drive.fetchImpl(url, init)) });
    await expect(flaky.uploadFile(folder, { name: 'foto.jpg', mimeType: 'image/jpeg', bytes: bytesOf(30) })).resolves.toMatchObject({ id: expect.any(String) });
  });

  it('overwriting (existingId) keeps the file where it is and sends a single media PATCH', async () => {
    const drive = createFakeDrive();
    const client = clientFor(drive);
    const folder = await client.ensureFolder('CUBRAX - Respaldos Obra');
    const { id } = await client.uploadFile(folder, { name: 'foto.jpg', mimeType: 'image/jpeg', bytes: bytesOf(30) });
    const mark = drive.calls.length;
    await client.uploadFile(folder, { name: 'foto.jpg', mimeType: 'image/jpeg', bytes: bytesOf(40), existingId: id });
    expect(drive.calls.slice(mark)).toHaveLength(1);
    expect(drive.files.get(id).parents).toEqual([folder]);
    expect(drive.created).toHaveLength(1);
  });
});

describe('syncDossier: every photo / PDF is born inside its project folder', () => {
  it('every upload carries ONE parent: the project folder itself; nothing is created in the root and nothing is moved', async () => {
    const drive = createFakeDrive();
    await dossier(drive);
    const project = drive.folders().find((f) => f.name === 'Obra Norte');
    expect(drive.created).toHaveLength(6);
    for (const parents of bornIn(drive)) expect(parents).toEqual([project.id]);
    for (const f of nonFolders(drive)) expect(f.parents).not.toContain('root');
    expect(moves(drive)).toHaveLength(0);
  });

  it('the same holds with a hundred photos in parallel', async () => {
    const drive = createFakeDrive();
    const many = Array.from({ length: 100 }, (_, i) => img(`Obra_2026-10-01_${i + 1}.jpg`, 50 + i, i));
    await dossier(drive, { images: many });
    expect(drive.created).toHaveLength(101);
    const project = drive.folders().find((f) => f.name === 'Obra Norte');
    expect(drive.created.every((c) => c.parents.length === 1 && c.parents[0] === project.id)).toBe(true);
    expect(nonFolders(drive).filter((f) => f.parents.includes('root'))).toHaveLength(0);
    expect(moves(drive)).toHaveLength(0);
  });

  it('after the cached folder vanishes from Drive (404) the retry creates the project folder again and every file is born inside it', async () => {
    const drive = createFakeDrive();
    const client = clientFor(drive);
    await syncDossier({ client, title: 'Obra Norte', documents: async () => [doc('Informe-Obra-Norte.pdf')], images: IMAGES });
    for (const f of [...drive.files.values()]) drive.files.delete(f.id); // the user emptied the Drive
    const mark = drive.created.length;
    await syncDossier({ client, title: 'Obra Norte', documents: async () => [doc('Informe-Obra-Norte.pdf')], images: IMAGES });
    const fresh = drive.created.slice(mark);
    expect(fresh).toHaveLength(6);
    const project = drive.folders().find((f) => f.name === 'Obra Norte');
    for (const c of fresh) expect(c.parents).toEqual([project.id]);
    expect(nonFolders(drive).filter((f) => f.parents.includes('root'))).toHaveLength(0);
    expect(moves(drive)).toHaveLength(0);
  });

  it('a network failure in the middle leaves no orphan: every file that exists is already inside its project', async () => {
    const drive = createFakeDrive();
    let uploads = 0;
    const fetchImpl = (url, init) => {
      if (String(url).includes('/upload/') && init?.method === 'POST' && (uploads += 1) === 4) return Promise.reject(new TypeError('network lost'));
      return drive.fetchImpl(url, init);
    };
    await expect(syncDossier({ client: createDriveClient({ getToken: async () => drive.token, fetchImpl }), title: 'Obra Norte', documents: async () => [doc('Informe-Obra-Norte.pdf')], images: IMAGES })).rejects.toMatchObject({ code: 'offline' });
    expect(nonFolders(drive).length).toBeGreaterThan(0);
    expect(nonFolders(drive).filter((f) => f.parents.includes('root'))).toHaveLength(0);
    expect(moves(drive)).toHaveLength(0);
  });

  it('an unusable project folder id aborts BEFORE any upload (the sync does not touch Drive media at all)', async () => {
    const drive = createFakeDrive();
    const real = clientFor(drive);
    const broken = { ...real, ensureFolderPath: async () => '' }; // a Drive that answers without a usable id
    await expect(syncDossier({ client: broken, title: 'Obra Norte', documents: async () => [doc('a.pdf')], images: IMAGES })).rejects.toMatchObject({ code: 'bad_response' });
    expect(drive.created).toHaveLength(0);
    expect(nonFolders(drive)).toHaveLength(0);
  });

  it('even if Drive misplaced every upload, the photos end up inside the project (healed) and the root stays clean', async () => {
    const drive = createFakeDrive();
    drive.state.misplaceUploads = true;
    await dossier(drive);
    expect(nonFolders(drive).filter((f) => f.parents.includes('root'))).toHaveLength(0);
  });
});

describe('the final tree is strict AND flat', () => {
  const expectedTree = {
    [BACKUP_FOLDER]: {
      [BACKUP_FILE]: null,
      [GLOBAL_RENDITIONS_FOLDER]: { 'rendicion-Global': null },
      [PROJECTS_FOLDER]: {
        'Obra Norte': {
          'Bitacora_2026-10-02_Material-danado_nota01.jpg': null,
          'Comprobante_2026-10-03_Ferreteria-Sur_rcpt01.jpg': null,
          'Comprobante_2026-10-04_Pinturas_rcpt02.jpg': null,
          'Informe-Obra-Norte.pdf': null,
          'Obra_2026-10-01_1.jpg': null,
          'Obra_2026-10-01_2.jpg': null,
          'rendicion-Obra-Norte': null,
        },
      },
    },
  };
  const everything = async (drive) => {
    const client = clientFor(drive);
    await client.saveBackup('{"v":1}');
    await dossier(drive, { documents: async () => [doc('Informe-Obra-Norte.pdf'), { name: 'rendicion-Obra-Norte', sheets: [{ name: 'Resumen', rows: [['a', 1]] }] }] });
    await uploadRendition({ client, kind: 'global', title: '', fileName: 'rendicion-Global', sheets: [{ name: 'Resumen', rows: [['a', 1]] }] });
    return client;
  };

  it('master folder / backup + Rendiciones_Globales + Proyectos / <obra> / { PDF, Sheet vivo, every photo } with NO subfolder inside the project', async () => {
    const drive = createFakeDrive();
    await everything(drive);
    expect(treeOf(drive)).toEqual(expectedTree);
  });

  it('the only folders of the Drive are: master, Rendiciones_Globales, Proyectos and one per project (depth 3 at most)', async () => {
    const drive = createFakeDrive();
    await everything(drive);
    expect(drive.folders().map((f) => f.name).sort()).toEqual([BACKUP_FOLDER, GLOBAL_RENDITIONS_FOLDER, PROJECTS_FOLDER, 'Obra Norte'].sort());
    const project = drive.folders().find((f) => f.name === 'Obra Norte');
    expect(drive.folders().filter((f) => f.parents.includes(project.id))).toHaveLength(0);
  });

  it('the project folder is the ONLY parent of every file of the project, Sheet included', async () => {
    const drive = createFakeDrive();
    await everything(drive);
    const project = drive.folders().find((f) => f.name === 'Obra Norte');
    const mine = nonFolders(drive).filter((f) => f.name !== BACKUP_FILE && f.name !== 'rendicion-Global');
    expect(mine).toHaveLength(7);
    for (const f of mine) expect(f.parents).toEqual([project.id]);
  });

  it('fewer requests: a sync lists ONE folder (no subfolder lookups, no extra listings) and creates no folder besides the project\'s', async () => {
    const drive = createFakeDrive();
    const client = clientFor(drive);
    await syncDossier({ client, title: 'Obra Norte', images: IMAGES });
    const folderCreates = drive.calls.filter((c) => c.method === 'POST' && !c.url.includes('/upload/'));
    expect(folderCreates).toHaveLength(3); // master, Proyectos, Obra Norte
    const mark = drive.calls.length;
    await syncDossier({ client, title: 'Obra Norte', images: IMAGES }); // second sync: folder ids cached -> a single listing, no upload
    const again = drive.calls.slice(mark);
    expect(again).toHaveLength(1);
    expect(again[0].method).toBe('GET');
  });

  it('the tree does not change when everything is synced a second time (no duplicates, nothing in the root)', async () => {
    const drive = createFakeDrive();
    const client = await everything(drive);
    const first = JSON.stringify(treeOf(drive));
    await dossier(drive, { documents: async () => [doc('Informe-Obra-Norte.pdf'), { name: 'rendicion-Obra-Norte', sheets: [{ name: 'Resumen', rows: [['a', 1]] }] }] });
    await client.saveBackup('{"v":2}');
    expect(JSON.stringify(treeOf(drive))).toBe(first);
    expect(Object.keys(treeOf(drive))).toEqual([BACKUP_FOLDER]);
  });
});
