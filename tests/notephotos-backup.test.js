// Drive backup of the logbook photos: Blob (IndexedDB) -> base64 ONLY inside the backup JSON -> Blob (IndexedDB) on restore.
import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { collectBackup, parseBackup, restoreBackup, serializeBackup } from '../src/lib/backup.js';
import { createNotePhotoStore, idbNoteBackend, readNotePhotos, writeNotePhotos } from '../src/lib/notePhotos.js';
import { createProjectStore, idbProjectBackend } from '../src/lib/projectStore.js';
import { blobToDataUrl, isBlob } from '../src/lib/blobs.js';
import { newProject } from '../src/lib/projects.js';
import { normalizeCompany } from '../src/lib/draft.js';
import { STORE_PHOTOS, createRunner } from '../src/lib/db.js';

// a real (tiny) byte sequence, so the round trip can be compared byte for byte
const BYTES = Uint8Array.from({ length: 3000 }, (_, i) => (i * 37 + 11) % 256);
const JPEG = `data:image/jpeg;base64,${Buffer.from(BYTES).toString('base64')}`;
const SECOND = `data:image/jpeg;base64,${Buffer.from(BYTES.slice(0, 1500)).toString('base64')}`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const NOTE = 'nota0001';
const withNote = (name, updatedAt, notes) => ({ ...newProject({ regionCode: 'CL', name, now: updatedAt }), updatedAt, logbook: notes });
const base = (projects) => ({ settings: { region: 'CL', lang: 'es' }, company: normalizeCompany({ name: 'Aurora' }), meta: { onboarded: true, drive: true }, logo: '', projects });
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
const device = () => {
  const factory = new IDBFactory();
  const stores = new Map();
  return {
    factory,
    projectStore: createProjectStore(idbProjectBackend(factory)),
    notePhotosFor: (id) => (stores.has(id) ? stores.get(id) : stores.set(id, createNotePhotoStore(idbNoteBackend(factory, id))).get(id)),
    photoStoreFor: () => ({ save: async () => {} }),
    logoStore: { save: async () => {} },
  };
};

describe('Blob -> base64 -> Blob', () => {
  it('readNotePhotos turns the stored Blobs into base64 (only for notes flagged photo:true) and writeNotePhotos restores identical Blobs', async () => {
    const a = device();
    const store = a.notePhotosFor('proyecto01');
    await store.put(NOTE, { dataUrl: JPEG, width: 800, height: 600, at: 7 });
    await store.put('sinflag01', { dataUrl: SECOND, width: 10, height: 10 });
    const logbook = [
      { id: NOTE, at: 1, text: 'Material dañado', photo: true },
      { id: 'sinflag01', at: 2, text: 'sin flag' }, // a Blob without the flag is not part of the backup
      { id: 'sinfoto01', at: 3, text: 'sin foto', photo: true }, // flagged but no Blob: skipped, never an error
    ];
    const read = await readNotePhotos(store, logbook);
    expect(Object.keys(read)).toEqual([NOTE]);
    expect(read[NOTE]).toEqual({ dataUrl: JPEG, width: 800, height: 600, at: 7 });

    const b = device();
    const target = b.notePhotosFor('proyecto01');
    expect(await writeNotePhotos(target, read)).toBe(1);
    const back = await target.get(NOTE);
    expect(isBlob(back.blob)).toBe(true);
    expect(back.blob.type).toBe('image/jpeg');
    expect([...(await bytesOf(back.blob))]).toEqual([...BYTES]); // byte for byte
    expect(await blobToDataUrl(back.blob)).toBe(JPEG);
    // on the device it is a Blob row, never base64
    const rows = await createRunner(b.factory)(STORE_PHOTOS, 'readonly', (s) => s.getAll());
    expect(rows).toHaveLength(1);
    expect(isBlob(rows[0].blob)).toBe(true);
    expect(rows[0].dataUrl).toBeUndefined();
  });

  it('overwrite:false only fills the missing ones; a corrupt photo never stops the others', async () => {
    const d = device();
    const store = d.notePhotosFor('proyecto01');
    await store.put('keep00001', { dataUrl: JPEG, width: 10, height: 10 });
    const n = await writeNotePhotos(
      store,
      { keep00001: { dataUrl: SECOND, width: 10, height: 10 }, bad000001: { dataUrl: 'javascript:alert(1)', width: 10, height: 10 }, new000001: { dataUrl: SECOND, width: 10, height: 10 } },
      { overwrite: false }
    );
    expect(n).toBe(1);
    expect((await bytesOf((await store.get('keep00001')).blob)).length).toBe(BYTES.length); // untouched
    expect(await store.get('bad000001')).toBeNull();
    expect(await store.get('new000001')).not.toBeNull();
  });
});

describe('the backup document', () => {
  it('collect -> serialize -> parse carries the note photos of the flagged notes; the project itself only says photo:true', async () => {
    const p = withNote('Casa', 100, [{ id: NOTE, at: 1, text: 'Material dañado', photo: true }, { id: 'sinfoto01', at: 2, text: 'nota' }]);
    const a = device();
    await a.notePhotosFor(p.id).put(NOTE, { dataUrl: JPEG, width: 800, height: 600, at: 7 });
    const text = serializeBackup(await collectBackup({ ...base([p]), loadNotePhotos: (proj) => readNotePhotos(a.notePhotosFor(proj.id), proj.logbook) }));
    const raw = JSON.parse(text);
    expect(raw.notePhotos[p.id][NOTE].dataUrl).toBe(JPEG);
    expect(JSON.stringify(raw.projects)).not.toContain('data:image'); // the project JSON carries no picture
    const got = parseBackup(text);
    expect(got.notePhotos[p.id]).toEqual({ [NOTE]: { dataUrl: JPEG, width: 800, height: 600, at: 7 } });
    expect(got.projects[0].logbook.find((e) => e.id === NOTE).photo).toBe(true); // the link survives
  });

  it('untrusted photos are dropped: not JPEG, unknown notes, notes without the flag, projects not in the file', async () => {
    const p = withNote('Casa', 100, [{ id: NOTE, at: 1, text: 'a', photo: true }, { id: 'sinflag01', at: 2, text: 'b' }]);
    const raw = JSON.parse(serializeBackup(await collectBackup(base([p]))));
    raw.notePhotos = {
      [p.id]: {
        [NOTE]: { dataUrl: PNG, width: 10, height: 10 }, // PNG: refused
        sinflag01: { dataUrl: JPEG, width: 10, height: 10 }, // the note has no photo flag
        fantasma1: { dataUrl: JPEG, width: 10, height: 10 }, // no such note
        __proto__: { dataUrl: JPEG, width: 10, height: 10 },
      },
      ghost: { [NOTE]: { dataUrl: JPEG, width: 10, height: 10 } },
    };
    expect(parseBackup(JSON.stringify(raw)).notePhotos).toEqual({});
    raw.notePhotos[p.id][NOTE] = { dataUrl: JPEG, width: 800, height: 600 };
    expect(Object.keys(parseBackup(JSON.stringify(raw)).notePhotos[p.id])).toEqual([NOTE]);
    raw.notePhotos[p.id][NOTE] = { dataUrl: JPEG, width: 99999, height: 600 };
    expect(parseBackup(JSON.stringify(raw)).notePhotos).toEqual({});
  });

  it('an older backup (no notePhotos) still parses and restores', async () => {
    const p = withNote('Casa', 100, [{ id: NOTE, at: 1, text: 'a', photo: true }]);
    const raw = JSON.parse(serializeBackup(await collectBackup(base([p]))));
    delete raw.notePhotos;
    const got = parseBackup(JSON.stringify(raw));
    expect(got.notePhotos).toEqual({});
    const d = device();
    const empty = { settings: { region: null, lang: 'es' }, company: normalizeCompany({}), meta: { onboarded: false, drive: true }, logo: '', projects: [] };
    await expect(restoreBackup(empty, got, d)).resolves.toBeTruthy();
  });
});

describe('device A -> Drive -> device B', () => {
  it('a new device gets the project and the Blobs of its note photos back in IndexedDB BEFORE anything is shown', async () => {
    const p = withNote('Casa', 100, [{ id: NOTE, at: 1, text: 'Material dañado', photo: true }, { id: 'nota0002', at: 2, text: 'otra', photo: true }]);
    const a = device();
    await a.notePhotosFor(p.id).put(NOTE, { dataUrl: JPEG, width: 800, height: 600, at: 7 });
    await a.notePhotosFor(p.id).put('nota0002', { dataUrl: SECOND, width: 400, height: 300, at: 8 });
    const file = serializeBackup(await collectBackup({ ...base([p]), loadNotePhotos: (proj) => readNotePhotos(a.notePhotosFor(proj.id), proj.logbook) }));

    const b = device(); // the lost phone is replaced by an empty one
    const empty = { settings: { region: null, lang: 'es' }, company: normalizeCompany({}), meta: { onboarded: false, drive: true }, logo: '', projects: [] };
    const merged = await restoreBackup(empty, parseBackup(file), b);
    expect(merged.wonProjects).toEqual([p.id]);
    const saved = await b.projectStore.load();
    expect(saved[0].logbook.map((e) => e.photo)).toEqual([true, true]); // links intact
    for (const [id, want] of [[NOTE, BYTES], ['nota0002', BYTES.slice(0, 1500)]]) {
      const got = await createNotePhotoStore(idbNoteBackend(b.factory, p.id)).get(id); // a FRESH store: read from disk, not from cache
      expect([...(await bytesOf(got.blob))]).toEqual([...want]);
    }
    const rows = await createRunner(b.factory)(STORE_PHOTOS, 'readonly', (s) => s.getAll());
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => isBlob(r.blob) && r.dataUrl === undefined)).toBe(true);
  });

  it('a project kept from this device (newer) gets back only the Blobs it lost, never overwriting the ones it has', async () => {
    const note = { id: NOTE, at: 1, text: 'x', photo: true };
    const remote = withNote('Casa', 100, [note]);
    const a = device();
    await a.notePhotosFor(remote.id).put(NOTE, { dataUrl: JPEG, width: 800, height: 600 });
    const file = serializeBackup(await collectBackup({ ...base([remote]), loadNotePhotos: (proj) => readNotePhotos(a.notePhotosFor(proj.id), proj.logbook) }));

    const local = { ...remote, updatedAt: 500 }; // newer here: the backup does not win
    const lost = device();
    const empty = { settings: { region: 'CL', lang: 'es' }, company: normalizeCompany({ name: 'Mi' }), meta: { onboarded: true, drive: true }, logo: '', projects: [local] };
    await restoreBackup(empty, parseBackup(file), lost);
    expect(isBlob((await lost.notePhotosFor(remote.id).get(NOTE)).blob)).toBe(true); // refilled

    const has = device();
    await has.notePhotosFor(remote.id).put(NOTE, { dataUrl: SECOND, width: 10, height: 10 });
    await restoreBackup(empty, parseBackup(file), has);
    expect((await bytesOf((await has.notePhotosFor(remote.id).get(NOTE)).blob)).length).toBe(1500); // its own, untouched
  });
});
