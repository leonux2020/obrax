// @vitest-environment happy-dom
// Logbook voice-editing and photo notes: the photo is a Blob in IndexedDB (never base64 / localStorage), thumbnail + full screen, edit.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App, { resetBoot } from '../src/App.jsx';
import { projectStore } from '../src/lib/projectStore.js';
import { receiptQueue } from '../src/lib/receiptQueue.js';
import { newProject } from '../src/lib/projects.js';
import { IDBFactory } from 'fake-indexeddb';
import { editNote } from '../src/components/workspace/LogBlock.jsx';
import { createNotePhotoStore, idbNoteBackend, memoryNoteBackend, normalizeNotePhoto, notePhotosFor } from '../src/lib/notePhotos.js';
import { createPhotoStore, idbBackend } from '../src/lib/photoStore.js';
import { openDb, STORE_PHOTOS, DB_VERSION } from '../src/lib/db.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';
import { DICT } from '../src/lib/dict.js';

var JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2Q==';

// the canvas pipeline does not exist in happy-dom: the compressor is replaced by a fixture, the rest (Blob, IndexedDB, UI) is real
vi.mock('../src/lib/notePhotos.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    prepareNotePhoto: vi.fn(async () => real.normalizeNotePhoto({ dataUrl: JPEG, width: 800, height: 600, at: 1 })),
  };
});

// happy-dom's Blob does not survive the structured clone of fake-indexeddb (a real browser keeps it): Node's Blob does
globalThis.Blob = NodeBlob;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
let host;
let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const qa = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)];
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush(10);
};
const typeInto = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const pop = async () => {
  await act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  });
  await flush(10);
};

beforeEach(() => {
  localStorage.clear();
  resetRegistry();
  resetToasts();
  window.history.replaceState(null, '');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

// ---- the real App --------------------------------------------------------------------------------------------------------------
async function mountApp() {
  resetBoot();
  await act(async () => {
    root.render(React.createElement(App, { splash: { hold: 0, fade: 0 } }));
    await new Promise((r) => setTimeout(r, 150));
  });
}
const seed = async (projects = []) => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
  for (const p of await projectStore.load()) await projectStore.remove(p.id);
  for (const r of await receiptQueue.list()) await receiptQueue.remove(r.id);
  for (const p of projects) await projectStore.save(p);
};

const active = (extra = {}) => ({
  ...newProject({ regionCode: 'CL', name: 'Casa Soto', client: 'Luis Soto', startDate: '2026-03-02' }),
  logbook: [{ id: 'log001', at: at(2026, 3, 3), text: 'Comprar clavos' }],
  ...extra,
});
class FakeRecognition {
  static all = [];
  constructor() {
    FakeRecognition.all.push(this);
  }
  start() {}
  stop() {
    queueMicrotask(() => this.onend?.());
  }
  abort() {}
  say(text) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
  }
}
const pickFile = async (input) => {
  const file = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush(20);
};
const typeIntoArea = (el, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const open = async (project) => {
  await seed([project]);
  await mountApp();
  await click(q('project-card'));
  return project;
};
const stored = async () => {
  await flush(400);
  return (await projectStore.load())[0];
};
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake-photo');
  URL.revokeObjectURL = vi.fn();
  window.webkitSpeechRecognition = FakeRecognition;
  FakeRecognition.all = [];
});
afterEach(() => {
  delete window.webkitSpeechRecognition;
});

describe('note photo store (Blob only, IndexedDB)', () => {
  it('saves the picture as a Blob row in project_photos: no data URL, scoped per project, invisible to the Cámara de Obra', async () => {
    const factory = new IDBFactory();
    const store = createNotePhotoStore(idbNoteBackend(factory, 'proyecto1'));
    const other = createNotePhotoStore(idbNoteBackend(factory, 'proyecto2'));
    await store.put('nota001', { dataUrl: JPEG, width: 800, height: 600, at: 5 });
    const got = await store.get('nota001');
    expect(got.blob).toBeInstanceOf(Blob);
    expect(got.blob.type).toBe('image/jpeg');
    expect(got).toMatchObject({ width: 800, height: 600 });
    // the raw row: a Blob, never a base64 string
    const db = await openDb(factory);
    const rows = await new Promise((resolve) => {
      const req = db.transaction(STORE_PHOTOS).objectStore(STORE_PHOTOS).getAll();
      req.onsuccess = () => resolve(req.result);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].blob).toBeInstanceOf(Blob);
    expect(rows[0].dataUrl).toBeUndefined();
    expect(JSON.stringify(Object.keys(rows[0]))).not.toContain('dataUrl');
    expect(rows[0].key).toBe('proyecto1:note:nota001');
    expect(DB_VERSION).toBe(5); // same schema as the Cámara de Obra: no new store, no upgrade
    expect(await other.get('nota001')).toBeNull(); // another project never sees it
    // the Cámara de Obra of the same project does not load note photos
    const camera = createPhotoStore(idbBackend(factory, 'proyecto1'));
    expect((await camera.load()).filter(Boolean)).toHaveLength(0);
    await store.remove('nota001');
    expect(await store.get('nota001')).toBeNull();
    await store.put('a1', { dataUrl: JPEG, width: 10, height: 10 });
    await store.put('a2', { dataUrl: JPEG, width: 10, height: 10 });
    await store.clear();
    expect(await store.get('a1')).toBeNull();
    expect(await store.get('a2')).toBeNull();
  });

  it('refuses what is not an image Blob (bad size, text, huge) and never touches localStorage', async () => {
    const store = createNotePhotoStore(memoryNoteBackend());
    await expect(store.put('n', { dataUrl: 'data:text/plain;base64,aGk=', width: 10, height: 10 })).rejects.toThrow();
    await expect(store.put('n', { dataUrl: JPEG, width: 0, height: 10 })).rejects.toThrow();
    await expect(store.put('n', { blob: new Blob([new Uint8Array(500_000)], { type: 'image/jpeg' }), width: 10, height: 10 })).rejects.toThrow();
    expect(normalizeNotePhoto(null)).toBeNull();
    await store.put('n', { dataUrl: JPEG, width: 10, height: 10 });
    expect(JSON.stringify({ ...localStorage })).not.toContain('data:image');
  });

  it('falls back to memory when IndexedDB fails (the feature degrades, it does not break)', async () => {
    const broken = { kind: 'indexeddb', get: async () => { throw new Error('x'); }, put: async () => { throw new Error('x'); }, remove: async () => {}, clear: async () => {} };
    const store = createNotePhotoStore(broken);
    await store.put('n', { dataUrl: JPEG, width: 10, height: 10 });
    expect((await store.get('n')).blob).toBeInstanceOf(Blob);
    expect(store.kind).toBe('memory');
  });

  it('editNote keeps / sets / clears the photo flag', () => {
    const list = [{ id: 'a1b2c3', at: 1, text: 'x', photo: true }, { id: 'd4e5f6', at: 2, text: 'y' }];
    expect(editNote(list, 'a1b2c3', 'nuevo')[0]).toEqual({ id: 'a1b2c3', at: 1, text: 'nuevo', photo: true });
    expect(editNote(list, 'a1b2c3', 'nuevo', false)[0]).toEqual({ id: 'a1b2c3', at: 1, text: 'nuevo' });
    expect(editNote(list, 'd4e5f6', 'nuevo', true)[1]).toEqual({ id: 'd4e5f6', at: 2, text: 'nuevo', photo: true });
  });
});

describe('📸 photo notes', () => {
  it('Dock 🎙️ panel: attach a photo, save; the note shows its thumbnail, opens full screen; the Blob is in IndexedDB and the project only says photo:true', async () => {
    const p = await open(active());
    await click(q('dock-log'));
    expect(q('log-photo').getAttribute('data-testid')).toBe('log-photo');
    expect(q('log-photo').className).toContain('min-h-[44px]');
    await pickFile(q('log-photo-input'));
    expect(q('log-photo-thumb')).not.toBeNull(); // the preview of what will be attached
    await typeIntoArea(q('log-input'), 'Material dañado en la entrega');
    await click(q('log-save'));
    expect(q('log-input')).toBeNull(); // sheet closed
    expect(q('ws-log').open).toBe(true);
    const first = qa('wlog-note')[0];
    expect(first.querySelector('[data-testid="wlog-text"]').textContent).toBe('Material dañado en la entrega');
    await flush(30);
    const thumb = first.querySelector('[data-testid^="wlog-thumb-"]');
    expect(thumb).not.toBeNull();
    expect(thumb.querySelector('img').getAttribute('src')).toBe('blob:fake-photo'); // object URL of the Blob, not a data URL
    expect(qa('wlog-note')[1].querySelector('[data-testid^="wlog-thumb-"]')).toBeNull(); // the old note has none
    // full screen
    await click(thumb);
    const box = q('photo-lightbox');
    expect(box).not.toBeNull();
    expect(box.getAttribute('role')).toBe('dialog');
    expect(q('photo-lightbox-img').getAttribute('src')).toBe('blob:fake-photo');
    await click(q('photo-lightbox-close'));
    expect(q('photo-lightbox')).toBeNull();
    // persistence: flag in the project, Blob in the note store
    const saved = await stored();
    const note = saved.logbook.find((e) => e.text === 'Material dañado en la entrega');
    expect(note.photo).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('data:image');
    const row = await notePhotosFor(p.id).get(note.id);
    expect(row.blob).toBeInstanceOf(Blob);
    expect(JSON.stringify({ ...localStorage })).not.toContain('data:image');
  });

  it('the photo can be removed from the pending note before saving; a photo-only note is saved with a default text', async () => {
    const p = await open(active());
    await click(q('dock-log'));
    await pickFile(q('log-photo-input'));
    await click(q('log-photo-remove'));
    expect(q('log-photo-thumb')).toBeNull();
    expect(q('log-save')).toBeNull();
    await pickFile(q('log-photo-input'));
    await click(q('log-save'));
    expect(qa('wlog-note')[0].querySelector('[data-testid="wlog-text"]').textContent).toBe('Foto adjunta');
    const saved = await stored();
    expect((await notePhotosFor(p.id).get(saved.logbook[0].id)).blob).toBeInstanceOf(Blob);
  });

  it('dictated note + photo: the dock mic ends the dictation and the note keeps the attached photo', async () => {
    const p = await open(active());
    await click(q('dock-log'));
    await pickFile(q('log-photo-input'));
    await click(q('log-mic'));
    await act(async () => FakeRecognition.all.at(-1).say('cemento mojado'));
    await click(q('log-mic'));
    await flush(30);
    const saved = await stored();
    expect(saved.logbook[0]).toMatchObject({ text: 'cemento mojado.', photo: true });
    expect((await notePhotosFor(p.id).get(saved.logbook[0].id)).blob).toBeInstanceOf(Blob);
  });

  it('edit mode: add a photo to a note, change it, remove it (persisted each time)', async () => {
    const p = await open(active());
    await click(q('ws-log').querySelector('summary'));
    await click(q('wlog-edit-log001'));
    expect(q('wlog-edit-thumb')).toBeNull();
    expect(q('wlog-photo').className).toContain('min-h-[44px]');
    await pickFile(q('wlog-photo-input'));
    expect(q('wlog-edit-thumb')).not.toBeNull();
    await click(q('wlog-save'));
    let saved = await stored();
    expect(saved.logbook[0]).toMatchObject({ id: 'log001', text: 'Comprar clavos', photo: true });
    expect((await notePhotosFor(p.id).get('log001')).blob).toBeInstanceOf(Blob);
    expect(q('wlog-thumb-log001')).not.toBeNull();
    // change
    await click(q('wlog-edit-log001'));
    expect(q('wlog-edit-thumb')).not.toBeNull();
    await pickFile(q('wlog-photo-input'));
    await click(q('wlog-save'));
    expect((await notePhotosFor(p.id).get('log001')).blob).toBeInstanceOf(Blob);
    // cancel after pressing "remove" changes nothing
    await click(q('wlog-edit-log001'));
    await click(q('wlog-photo-remove'));
    expect(q('wlog-edit-thumb')).toBeNull();
    await click(q('wlog-cancel'));
    expect(q('wlog-thumb-log001')).not.toBeNull();
    // remove for real
    await click(q('wlog-edit-log001'));
    await click(q('wlog-photo-remove'));
    await click(q('wlog-save'));
    expect(q('wlog-thumb-log001')).toBeNull();
    saved = await stored();
    expect(saved.logbook[0].photo).toBeUndefined();
    expect(await notePhotosFor(p.id).get('log001')).toBeNull();
  });

  it('deleting a note deletes its photo from IndexedDB', async () => {
    const p = active({ logbook: [{ id: 'log001', at: at(2026, 3, 3), text: 'Marco roto', photo: true }] });
    await notePhotosFor(p.id).put('log001', { dataUrl: JPEG, width: 10, height: 10 });
    await open(p);
    await click(q('ws-log').querySelector('summary'));
    await flush(30);
    expect(q('wlog-thumb-log001')).not.toBeNull(); // read back from the store
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await click(q('wlog-del-log001'));
    await flush(30);
    expect(await notePhotosFor(p.id).get('log001')).toBeNull();
    expect((await stored()).logbook).toHaveLength(0);
  });
});

describe('🎙️ voice while editing a note', () => {
  it('a 44px mic inside the editor: clean engine, the words are appended with a space; no keyboard needed', async () => {
    await open(active());
    await click(q('ws-log').querySelector('summary'));
    await click(q('wlog-edit-log001'));
    const mic = q('wlog-mic');
    expect(mic.className).toContain('h-11');
    expect(mic.className).toContain('w-11');
    await click(mic);
    const rec = FakeRecognition.all.at(-1);
    expect(rec).toMatchObject({ continuous: false, interimResults: false });
    expect(mic.dataset.listening).toBe('true');
    expect(q('wlog-input').readOnly).toBe(true);
    await act(async () => rec.say('y tornillos de 3 pulgadas'));
    expect(q('wlog-input').value).toBe('Comprar clavos y tornillos de 3 pulgadas');
    await click(mic); // stop
    await flush(20);
    expect(mic.dataset.listening).toBe('false');
    expect(q('wlog-input').value).toBe('Comprar clavos y tornillos de 3 pulgadas.');
    expect(q('wlog-input').readOnly).toBe(false);
    await click(q('wlog-save'));
    expect((await stored()).logbook[0].text).toBe('Comprar clavos y tornillos de 3 pulgadas.');
  });

  it('without Web Speech the editor says so, and cancelling stops a listening mic', async () => {
    await open(active());
    await click(q('ws-log').querySelector('summary'));
    await click(q('wlog-edit-log001'));
    delete window.webkitSpeechRecognition;
    await click(q('wlog-mic'));
    expect(q('wlog-mic-issue').textContent).toContain('no admite dictado');
    window.webkitSpeechRecognition = FakeRecognition;
    await click(q('wlog-mic'));
    expect(q('wlog-mic').dataset.listening).toBe('true');
    await click(q('wlog-cancel'));
    await flush(20);
    expect(q('wlog-input')).toBeNull();
    expect(q('ws-log').textContent).toContain('Comprar clavos');
  });

  it('the new texts exist in the six languages', () => {
    for (const lang of ['es', 'en', 'pt', 'fr', 'it', 'de']) {
      for (const key of ['ws.log.photo', 'ws.log.photoAdd', 'ws.log.photoChange', 'ws.log.photoRemove', 'ws.log.photoOpen', 'ws.log.photoOnly', 'ws.log.photoBusy']) {
        expect(DICT[lang][key], `${lang} ${key}`).toBeTruthy();
      }
    }
  });
});
