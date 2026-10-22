import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createProjectStore, idbProjectBackend, memoryProjectBackend } from '../src/lib/projectStore.js';
import { createPhotoStore, idbBackend, migrateLegacyPhotos } from '../src/lib/photoStore.js';
import { newProject } from '../src/lib/projects.js';
import { openDb, STORE_LEGACY_PHOTOS } from '../src/lib/db.js';
import { PHOTO_SLOTS } from '../src/lib/photos.js';

const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const variant = (k) => {
  const at = JPEG.indexOf('//////') + 40;
  return JPEG.slice(0, at) + 'ABCD'[k % 4] + JPEG.slice(at + 1);
};
const photo = (slot, at = 1) => ({ slot, dataUrl: variant(slot), width: 1200, height: 900, at });
const LOGO = `data:image/png;base64,${'iVBORw0KGgo'.repeat(40)}AAAA`;
const COMPANY = { name: 'Constructora Aurora SpA', taxId: '76.123.456-7', phone: '', email: '', city: 'Santiago' };

describe('multi-project store (IndexedDB)', () => {
  it('persists several client jobs with their embedded company snapshot and logo', async () => {
    const factory = new IDBFactory();
    const store = createProjectStore(idbProjectBackend(factory));
    const a = newProject({ regionCode: 'CL', name: 'Casa Roble', client: 'Ana', startDate: '2026-10-01', endDate: '2026-12-01', company: COMPANY, logo: LOGO, now: 100 });
    const b = newProject({ regionCode: 'MX', name: 'Bodega', client: 'Luis', now: 200 });
    await store.save(a);
    await store.save(b);

    const reloaded = createProjectStore(idbProjectBackend(factory)); // "restart"
    const list = await reloaded.load();
    expect(reloaded.kind).toBe('indexeddb');
    expect(list.map((p) => p.id)).toEqual([b.id, a.id]); // newest first
    const back = list.find((p) => p.id === a.id);
    expect(back.company.name).toBe('Constructora Aurora SpA');
    expect(back.company.logo).toBe(LOGO); // base64 survives the round trip
    expect([back.startDate, back.endDate]).toEqual(['2026-10-01', '2026-12-01']);
    expect(back.draft.project).toEqual({ name: 'Casa Roble', client: 'Ana' });
    expect(list.find((p) => p.id === b.id).draft.regionCode).toBe('MX');
  });

  it('update and delete', async () => {
    const store = createProjectStore(idbProjectBackend(new IDBFactory()));
    const p = newProject({ regionCode: 'CL', name: 'Uno', now: 1 });
    await store.save(p);
    await store.save({ ...p, endDate: '2026-11-30', updatedAt: 50 });
    let list = await store.load();
    expect(list).toHaveLength(1);
    expect(list[0].endDate).toBe('2026-11-30');
    await store.remove(p.id);
    list = await store.load();
    expect(list).toHaveLength(0);
  });

  it('never trusts stored data and falls back to memory', async () => {
    const factory = new IDBFactory();
    const backend = idbProjectBackend(factory);
    await backend.put({ id: 'garbage1', draft: { regionCode: 'ZZ' } });
    await backend.put(newProject({ regionCode: 'CL', name: 'Ok', now: 1 }));
    expect(await createProjectStore(backend).load()).toHaveLength(1);

    const broken = { kind: 'indexeddb', getAll: async () => { throw new Error('x'); }, put: async () => { throw new Error('x'); }, remove: async () => {} };
    const mem = createProjectStore(broken);
    await mem.save(newProject({ regionCode: 'CL', now: 2 }));
    expect(mem.kind).toBe('memory');
    expect(await mem.load()).toHaveLength(1);
    await expect(createProjectStore(memoryProjectBackend()).save({ id: '!' })).rejects.toThrow();
  });
});

describe('photos are scoped per project (4 slots each)', () => {
  it('two projects keep their own 4 photos without mixing', async () => {
    const factory = new IDBFactory();
    const a = createPhotoStore(idbBackend(factory, 'proyectoa1'));
    const b = createPhotoStore(idbBackend(factory, 'proyectob2'));
    for (let s = 0; s < 4; s += 1) await a.save(photo(s, 10 + s));
    await b.save(photo(1, 99));
    await b.save(photo(3, 98));

    const aSlots = await createPhotoStore(idbBackend(factory, 'proyectoa1')).load();
    const bSlots = await createPhotoStore(idbBackend(factory, 'proyectob2')).load();
    expect(aSlots.every(Boolean)).toBe(true);
    expect(aSlots.map((p) => p.at)).toEqual([10, 11, 12, 13]);
    expect(bSlots.map((p) => p && p.at)).toEqual([null, 99, null, 98]);
    expect(PHOTO_SLOTS).toHaveLength(4);
  });

  it('replace/remove/clear only touch the owning project', async () => {
    const factory = new IDBFactory();
    const a = createPhotoStore(idbBackend(factory, 'proyectoa1'));
    const b = createPhotoStore(idbBackend(factory, 'proyectob2'));
    for (let s = 0; s < 4; s += 1) {
      await a.save(photo(s, 1));
      await b.save(photo(s, 2));
    }
    await a.save({ ...photo(0), at: 777 });
    await a.remove(1);
    expect((await a.load()).filter(Boolean)).toHaveLength(3);
    expect((await b.load()).filter(Boolean)).toHaveLength(4);
    await a.clear();
    expect((await a.load()).filter(Boolean)).toHaveLength(0);
    expect((await b.load()).filter(Boolean)).toHaveLength(4);
    expect((await b.load())[0].at).toBe(2);
  });
});

describe('migration from the single-project version (DB v1)', () => {
  it('opening a v1 database upgrades it and moves legacy photos into the first project', async () => {
    const factory = new IDBFactory();
    // Build a genuine v1 database exactly like the previous release did.
    await new Promise((resolve, reject) => {
      const req = factory.open('obrax', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'slot' });
      req.onsuccess = () => {
        const tx = req.result.transaction('photos', 'readwrite');
        for (let s = 0; s < 4; s += 1) tx.objectStore('photos').put(photo(s, 40 + s));
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const moved = await migrateLegacyPhotos(factory, 'primerproyecto');
    expect(moved).toBe(4);
    const slots = await createPhotoStore(idbBackend(factory, 'primerproyecto')).load();
    expect(slots.map((p) => p.at)).toEqual([40, 41, 42, 43]);
    // legacy rows are gone, another project sees nothing, and running it again is harmless
    expect((await createPhotoStore(idbBackend(factory, 'otroproyecto')).load()).filter(Boolean)).toHaveLength(0);
    expect(await migrateLegacyPhotos(factory, 'primerproyecto')).toBe(0);
    const db = await openDb(factory);
    expect(db.objectStoreNames.contains(STORE_LEGACY_PHOTOS)).toBe(true);
    expect(db.objectStoreNames.contains('projects')).toBe(true);
    expect(db.objectStoreNames.contains('company')).toBe(true);
  });

  it('a fresh install (no legacy store) migrates nothing', async () => {
    expect(await migrateLegacyPhotos(new IDBFactory(), 'x1234567')).toBe(0);
  });
});
