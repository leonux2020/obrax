// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { wipeLocalData } from '../src/lib/session.js';
import { createProjectStore, idbProjectBackend } from '../src/lib/projectStore.js';
import { newProject } from '../src/lib/projects.js';
import { DB_NAME } from '../src/lib/db.js';

const names = async (factory) => (await factory.databases()).map((d) => d.name);

describe('wipeLocalData (Cerrar sesión)', () => {
  it('empties localStorage and sessionStorage completely', async () => {
    localStorage.setItem('cp.user.v1', '{}');
    localStorage.setItem('anything.else', '1');
    sessionStorage.setItem('cp.oauth.state', 'abc');
    const r = await wipeLocalData({ factory: null });
    expect(r.storage).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('deletes the IndexedDB database with its projects, and a fresh store starts empty', async () => {
    const factory = new IDBFactory();
    const store = createProjectStore(idbProjectBackend(factory));
    await store.save(newProject({ regionCode: 'CL', name: 'Casa' }));
    expect((await store.load()).length).toBe(1);
    expect(await names(factory)).toContain(DB_NAME);
    const r = await wipeLocalData({ factory, local: null, session: null });
    expect(r.indexedDb).toBe(true);
    expect(await names(factory)).not.toContain(DB_NAME);
    expect((await createProjectStore(idbProjectBackend(factory)).load()).length).toBe(0);
  });

  it('tells Google to forget the auto sign-in and survives a step that throws', async () => {
    let disabled = 0;
    const google = { accounts: { id: { disableAutoSelect: () => { disabled += 1; } } } };
    const bad = { clear: () => { throw new Error('quota'); } };
    const r = await wipeLocalData({ local: bad, session: null, factory: null, google });
    expect(disabled).toBe(1);
    expect(r).toEqual({ storage: false, indexedDb: true, google: true }); // the failed step did not stop the others
  });

  it('the app never writes back while signing out (pagehide flush and debounced save are guarded)', () => {
    const app = fs.readFileSync('src/App.jsx', 'utf8');
    expect(app).toContain('!wipingRef.current && projectStore.save(active)');
    expect(app).toContain('!wipingRef.current && projectStore.save(activeRef.current)');
    expect(app).toContain('await wipeLocalData();');
  });
});
