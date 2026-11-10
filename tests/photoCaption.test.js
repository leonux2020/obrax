// @vitest-environment happy-dom
// "Fotos de Obra" are PHOTO-FIRST: the picture is saved at once and a light drop-up offers an optional caption (typed or dictated, the same engine as the
// logbook). The caption lives in the photo object (IndexedDB), is editable later under every photo, wins merges by its edit time and travels to Drive as the
// `description` of the file (inside the atomic upload, or as a metadata-only update for a file that is already there).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import { DICT } from '../src/lib/dict.js';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { createDriveClient } from '../src/lib/drive.js';
import { collectDossierImages, syncDossier } from '../src/lib/driveExport.js';
import { mergePhotoSlots } from '../src/lib/merge.js';
import { createPhotoStore, memoryBackend } from '../src/lib/photoStore.js';
import { PHOTO_CAPTION_MAX, cleanCaption, describePhoto, diffPhotos, emptySlots, normalizePhoto, putPhoto } from '../src/lib/photos.js';
import { q, click, flush } from './helpers/appHarness.js';

vi.mock('../src/lib/photos.js', async (orig) => ({ ...(await orig()), compressImage: async () => ({ dataUrl: JPEG_MOCK(), width: 1080, height: 810, at: 5 }) }));
function JPEG_MOCK() {
  return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
}
const JPEG = JPEG_MOCK();
const photo = (slot, extra = {}) => ({ slot, dataUrl: JPEG, width: 1080, height: 810, at: 1, ...extra });
const withPhotos = (...list) => {
  const a = emptySlots();
  for (const p of list) a[p.slot] = p;
  return a;
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;

describe('the caption in the photo object', () => {
  it('cleanCaption: strips markup / control characters, one line, trimmed, at most 280; non-strings = ""', () => {
    expect(cleanCaption('  <b>Armadura</b>\n\n eje   B  ')).toBe('bArmadura/b eje B');
    expect(cleanCaption('x'.repeat(500))).toHaveLength(PHOTO_CAPTION_MAX);
    for (const bad of [undefined, null, 5, {}, [], NaN, '', '   ']) expect(cleanCaption(bad)).toBe('');
  });
  it('normalizePhoto keeps a clean description and its edit time; legacy photos stay exactly as they were', () => {
    const p = normalizePhoto(photo(2, { description: ' Muro  norte ', descAt: 99 }));
    expect(p.description).toBe('Muro norte');
    expect(p.descAt).toBe(99);
    const legacy = normalizePhoto(photo(2));
    expect('description' in legacy).toBe(false);
    expect('descAt' in legacy).toBe(false);
    expect('description' in normalizePhoto(photo(2, { description: '   ', descAt: 'x' }))).toBe(false); // nothing invented from junk
  });
  it('describePhoto sets, replaces and clears the caption without touching the picture; empty slot / bad index = untouched', () => {
    const base = withPhotos(photo(3));
    const a = describePhoto(base, 3, 'Losa lista', 10);
    expect(a[3]).toMatchObject({ description: 'Losa lista', descAt: 10, dataUrl: JPEG, at: 1 });
    const b = describePhoto(a, 3, '', 20);
    expect('description' in b[3]).toBe(false);
    expect(b[3].descAt).toBe(20); // clearing is an edit too
    expect(describePhoto(base, 4, 'x')[4]).toBeNull();
    for (const bad of [-1, 12, 1.5, NaN, undefined]) expect(describePhoto(base, bad, 'x')).toEqual(base);
    expect(base[3].description).toBeUndefined(); // the original was not mutated
  });
  it('putPhoto keeps the description; diffPhotos reports a caption edit as a change (so the project is stamped and synced)', () => {
    const put = putPhoto(emptySlots(), 1, photo(1, { description: 'Vista general' }));
    expect(put[1].description).toBe('Vista general');
    const before = withPhotos(photo(1));
    expect(diffPhotos(before, before).changed).toBe(false);
    expect(diffPhotos(before, describePhoto(before, 1, 'nuevo texto')).changed).toBe(true);
    expect(diffPhotos(describePhoto(before, 1, 'a'), describePhoto(before, 1, '')).changed).toBe(true);
  });
  it('the local store round trip keeps the caption (and drops a corrupt one)', async () => {
    const store = createPhotoStore(memoryBackend());
    await store.save(photo(5, { description: 'Tuberías', descAt: 7 }));
    expect((await store.load())[5]).toMatchObject({ description: 'Tuberías', descAt: 7 });
    await store.save(photo(6, { description: { bad: true } }));
    expect('description' in (await store.load())[6]).toBe(false);
  });
});

describe('merging two devices: the newest caption wins', () => {
  const one = (extra) => withPhotos(photo(0, extra));
  it('same picture, different captions: the newer edit wins and says where it came from', () => {
    const local = one({ description: 'viejo', descAt: 10 });
    const remote = one({ description: 'nuevo', descAt: 20 });
    const r = mergePhotoSlots(local, remote);
    expect(r.slots[0].description).toBe('nuevo');
    expect(r.fromRemote).toHaveLength(1);
    expect(r.localAhead).toBe(false);
    const r2 = mergePhotoSlots(remote, local);
    expect(r2.slots[0].description).toBe('nuevo');
    expect(r2.localAhead).toBe(true); // this device is ahead: the merged whole goes back up
    expect(r2.fromRemote).toHaveLength(0);
  });
  it('a caption removed later wins over an older text; equal times settle the same way on both devices; identical captions change nothing', () => {
    expect('description' in mergePhotoSlots(one({ description: 'a', descAt: 1 }), one({ descAt: 2 })).slots[0]).toBe(false);
    const x = one({ description: 'corto', descAt: 5 });
    const y = one({ description: 'corto y más', descAt: 5 });
    expect(mergePhotoSlots(x, y).slots[0].description).toBe(mergePhotoSlots(y, x).slots[0].description);
    const same = mergePhotoSlots(one({ description: 'igual', descAt: 1 }), one({ description: 'igual', descAt: 9 }));
    expect(same.fromRemote).toHaveLength(0);
    expect(same.localAhead).toBe(false);
  });
});

describe('Drive: the caption travels as the description of the file', () => {
  const bytes = (n) => Uint8Array.from({ length: n }, (_, i) => 65 + (i % 26));
  const client = (drive) => createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl });
  const item = (name, description, n = 50) => ({ name, mimeType: 'image/jpeg', ...(description === undefined ? {} : { description }), load: async () => bytes(n) });
  const run = (drive, images) => syncDossier({ client: client(drive), title: 'Obra Norte', documents: async () => [], images });
  const patches = (drive) => drive.calls.filter((c) => c.method === 'PATCH' && !/uploadType=media/.test(c.url));
  const fileNamed = (drive, name) => [...drive.files.values()].find((f) => f.name === name);

  it('collectDossierImages: camera photos carry their caption (""), the other photos carry none (undefined)', async () => {
    const items = await collectDossierImages(
      { logbook: [{ id: 'n1', photo: true, text: 'x', at: 1 }], expenses: [] },
      { cameraPhotos: async () => [photo(0, { description: 'Con texto' }), photo(1)], notePhoto: async () => ({ blob: new Blob([bytes(5)]) }) },
    );
    expect(items.map((i) => i.description)).toEqual(['Con texto', '', undefined]);
  });
  it('a NEW photo is born with its description in the SAME single request (atomic: no PATCH afterwards)', async () => {
    const drive = createFakeDrive();
    await run(drive, [item('Obra_1.jpg', 'Armadura del eje B'), item('Obra_2.jpg', '')]);
    const [a, b] = drive.created.filter((c) => c.name.startsWith('Obra_'));
    expect(a.description).toBe('Armadura del eje B');
    expect(b.description).toBeUndefined(); // no caption = no field
    expect(patches(drive)).toHaveLength(0);
    expect(fileNamed(drive, 'Obra_1.jpg').description).toBe('Armadura del eje B');
  });
  it('a caption edited after the upload updates the metadata ONLY: the picture is not sent again, the file keeps its place', async () => {
    const drive = createFakeDrive();
    await run(drive, [item('Obra_1.jpg', 'Primera versión')]);
    const id = fileNamed(drive, 'Obra_1.jpg').id;
    const mediaBefore = drive.calls.filter((c) => /uploadType/.test(c.url)).length;
    const stats = await run(drive, [item('Obra_1.jpg', 'Texto corregido en la oficina')]);
    expect(stats).toMatchObject({ uploaded: 0, unchanged: 1, failed: 0 });
    expect(drive.calls.filter((c) => /uploadType/.test(c.url)).length).toBe(mediaBefore); // no new upload at all
    expect(patches(drive)).toHaveLength(1);
    expect(JSON.parse(patches(drive)[0].body)).toEqual({ description: 'Texto corregido en la oficina' });
    expect(fileNamed(drive, 'Obra_1.jpg')).toMatchObject({ id, description: 'Texto corregido en la oficina' });
    // an unchanged caption costs nothing; a removed one is removed in Drive too
    await run(drive, [item('Obra_1.jpg', 'Texto corregido en la oficina')]);
    expect(patches(drive)).toHaveLength(1);
    await run(drive, [item('Obra_1.jpg', '')]);
    expect(fileNamed(drive, 'Obra_1.jpg').description).toBe('');
  });
  it('photos that carry no caption (logbook / receipts) never get their Drive text touched', async () => {
    const drive = createFakeDrive();
    await run(drive, [item('Bitacora_1.jpg', undefined)]);
    fileNamed(drive, 'Bitacora_1.jpg').description = 'escrito a mano en Drive';
    await run(drive, [item('Bitacora_1.jpg', undefined)]);
    expect(patches(drive)).toHaveLength(0);
    expect(fileNamed(drive, 'Bitacora_1.jpg').description).toBe('escrito a mano en Drive');
  });
  it('a failing caption update never fails the photo; a client without setDescription is fine too', async () => {
    const drive = createFakeDrive();
    await run(drive, [item('Obra_1.jpg', 'a')]);
    const real = client(drive);
    const flaky = { ...real, setDescription: async () => { throw Object.assign(new Error('x'), { status: 500 }); } };
    const stats = await syncDossier({ client: flaky, title: 'Obra Norte', documents: async () => [], images: [item('Obra_1.jpg', 'b')] });
    expect(stats).toMatchObject({ failed: 0, unchanged: 1 });
    const { setDescription: _drop, ...bare } = real;
    await expect(syncDossier({ client: bare, title: 'Obra Norte', documents: async () => [], images: [item('Obra_1.jpg', 'c')] })).resolves.toMatchObject({ failed: 0 });
  });
  it('listFiles reports the description; setDescription refuses a malformed id and trims what it sends', async () => {
    const drive = createFakeDrive();
    await run(drive, [item('Obra_1.jpg', 'Visible')]);
    const c = client(drive);
    const folder = [...drive.files.values()].find((f) => f.name === 'Obra Norte').id;
    expect((await c.listFiles(folder)).get('Obra_1.jpg').description).toBe('Visible');
    await expect(c.setDescription('../x', 'a')).rejects.toMatchObject({ code: 'bad_response' });
    const id = fileNamed(drive, 'Obra_1.jpg').id;
    await c.setDescription(id, `  ${'z '.repeat(900)}  `);
    expect(fileNamed(drive, 'Obra_1.jpg').description.length).toBeLessThanOrEqual(1000);
  });
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

describe('SnapGrid: capture -> optional caption -> edit later', () => {
  let host;
  let root;
  let latest;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    latest = null;
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete window.webkitSpeechRecognition;
  });
  const Stateful = ({ initial, projectId }) => {
    const [photos, setPhotos] = useState(initial);
    latest = photos;
    return h(SnapGrid, { photos, setPhotos, projectId });
  };
  let SnapGrid;
  let n = 0;
  const mount = async (initial = emptySlots()) => {
    SnapGrid ??= (await import('../src/components/SnapGrid.jsx')).default;
    n += 1;
    await act(async () => root.render(h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(Stateful, { initial, projectId: `cap${n}` }))));
  };
  const capture = async (slot = 0) => {
    await click(q(`snap-${slot}`));
    const input = q('snap-input');
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' })], configurable: true });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await flush(20);
  };
  const type = (el, value) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('right after the capture a light sheet opens over the thumbnail: textarea of 2 rows, the exact placeholder, a big mic, ONE button', async () => {
    await mount();
    await capture(0);
    expect(latest[0]).toMatchObject({ slot: 0, dataUrl: JPEG }); // the photo is ALREADY saved, before any text
    const box = q('photo-caption');
    expect(box).not.toBeNull();
    expect(q('photo-caption-thumb').getAttribute('src')).toBe(JPEG);
    const area = q('photo-caption-input');
    expect(area.tagName).toBe('TEXTAREA');
    expect(area.getAttribute('rows')).toBe('2');
    expect(area.getAttribute('placeholder')).toBe('Descripción breve del avance (opcional)');
    expect(area.getAttribute('maxlength')).toBe(String(PHOTO_CAPTION_MAX));
    const mic = q('photo-caption-mic');
    expect(mic.className).toContain('h-14'); // 56 px: big and thumb-friendly
    expect(mic.querySelector('svg')).not.toBeNull();
    expect(q('photo-caption-save').textContent).toBe('Guardar sin texto');
    expect(q('photo-caption-save').className).toContain('min-h-[52px]');
  });
  it('"Guardar sin texto" is an instant exit: sheet closed, photo kept, no caption, nothing else written', async () => {
    await mount();
    await capture(2);
    const t0 = performance.now();
    await click(q('photo-caption-save'));
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(q('photo-caption')).toBeNull();
    expect(latest[2].dataUrl).toBe(JPEG);
    expect('description' in latest[2]).toBe(false);
    expect(q('snap-caption-text-2').textContent).toBe('Añadir descripción'); // the quiet invitation under the photo
  });
  it('typing a caption: the button becomes "Guardar", Enter saves, the text shows under the photo and survives a reload of the store', async () => {
    await mount();
    await capture(1);
    await type(q('photo-caption-input'), 'Armadura del eje B lista');
    expect(q('photo-caption-save').textContent).toBe('Guardar');
    await act(async () => q('photo-caption-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await flush(20);
    expect(q('photo-caption')).toBeNull();
    expect(latest[1].description).toBe('Armadura del eje B lista');
    expect(latest[1].descAt).toBeGreaterThan(0);
    expect(q('snap-caption-text-1').textContent).toBe('Armadura del eje B lista');
  });
  it('the textarea sanitizes as you type: markup out, never more than the limit', async () => {
    await mount();
    await capture(0);
    await type(q('photo-caption-input'), `<script>${'a'.repeat(400)}`);
    const v = q('photo-caption-input').value;
    expect(v).not.toMatch(/[<>]/);
    expect(v.length).toBeLessThanOrEqual(PHOTO_CAPTION_MAX);
  });
  it('dictation: the SAME engine as the logbook (mic on, words land in the field, save stays blocked while listening)', async () => {
    window.webkitSpeechRecognition = FakeRecognition;
    FakeRecognition.all = [];
    await mount();
    await capture(0);
    await click(q('photo-caption-mic'));
    expect(q('photo-caption-mic').dataset.listening).toBe('true');
    expect(q('photo-caption-listening')).not.toBeNull();
    expect(q('photo-caption-save').disabled).toBe(true);
    await act(async () => FakeRecognition.all.at(-1).say('zanja terminada hasta el eje tres'));
    await click(q('photo-caption-mic')); // stop
    await flush(20);
    expect(q('photo-caption-mic').dataset.listening).toBe('false');
    expect(q('photo-caption-input').value).toContain('zanja terminada hasta el eje tres');
    await click(q('photo-caption-save'));
    expect(latest[0].description).toContain('zanja terminada');
  });
  it('a browser without dictation says so, quietly, and typing still works', async () => {
    await mount();
    await capture(0);
    await click(q('photo-caption-mic'));
    expect(q('photo-caption-issue').textContent).toBe(DICT.es['log.dictateUnsupported']);
    await type(q('photo-caption-input'), 'A mano');
    await click(q('photo-caption-save'));
    expect(latest[0].description).toBe('A mano');
  });
  it('edit later: the pencil row under the photo reopens the sheet prefilled; saving updates it, emptying it removes the caption', async () => {
    await mount(withPhotos(photo(4, { description: 'Texto de campo', descAt: 1 })));
    expect(q('snap-caption-text-4').textContent).toBe('Texto de campo');
    const row = q('snap-caption-4');
    expect(row.querySelector('svg[data-icon="pencil"]')).not.toBeNull();
    expect(row.className).toContain('min-h-[44px]'); // a real touch target
    await click(row);
    expect(q('photo-caption-input').value).toBe('Texto de campo');
    expect(q('photo-caption-save').textContent).toBe('Guardar');
    await type(q('photo-caption-input'), 'Texto corregido con calma');
    await click(q('photo-caption-save'));
    expect(latest[4].description).toBe('Texto corregido con calma');
    await click(q('snap-caption-4'));
    await type(q('photo-caption-input'), '');
    expect(q('photo-caption-save').textContent).toBe('Quitar descripción');
    await click(q('photo-caption-save'));
    expect('description' in latest[4]).toBe(false);
    expect(q('snap-caption-text-4').textContent).toBe('Añadir descripción');
  });
  it('saving an unchanged caption writes nothing (the state object is the same one)', async () => {
    await mount(withPhotos(photo(0, { description: 'Igual', descAt: 1 })));
    const before = latest;
    await click(q('snap-caption-0'));
    await click(q('photo-caption-save'));
    expect(latest).toBe(before);
  });
  it('the gallery shows the caption under the picture', async () => {
    await mount(withPhotos(photo(0, { description: 'Muro norte' }), photo(1)));
    await click(q('snap-view-0'));
    expect(q('lightbox-description').textContent).toBe('Muro norte');
  });
  it('Zero-Stress markup: no new borders / grey fills / tracking in the caption pieces', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/PhotoCaption.jsx', 'utf8').replace(/data-outline-icon/g, ''); // (an icon marker, not a CSS outline)
    expect(src).not.toMatch(/\bborder\b|\boutline\b|bg-gray|bg-neutral|tracking-/);
    expect(src).toContain('active:scale-95');
  });
});

describe('texts', () => {
  it('every caption string exists in the six languages and the placeholder is the requested one', () => {
    for (const lang of ['es', 'en', 'pt', 'fr', 'it', 'de']) {
      for (const k of ['title', 'ph', 'save', 'skip', 'edit', 'add', 'clear']) expect(DICT[lang][`photo.caption.${k}`], `${lang} ${k}`).toBeTruthy();
    }
    expect(DICT.es['photo.caption.ph']).toBe('Descripción breve del avance (opcional)');
    expect(DICT.es['photo.caption.skip']).toBe('Guardar sin texto');
  });
});
