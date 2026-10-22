import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { BRAND, buildManifest, buildIconSvg } from '../src/brand/icon.js';
import {
  MAX_PHOTOS,
  PHOTO_SLOTS,
  PHOTO_LIMITS,
  fitSize,
  dataUrlBytes,
  isValidPhotoDataUrl,
  normalizePhoto,
  normalizePhotos,
  emptySlots,
  countPhotos,
  firstFreeSlot,
  putPhoto,
  removePhoto,
  photosForReport,
  compressImage,
  PhotoError,
} from '../src/lib/photos.js';
import { createPhotoStore, memoryBackend } from '../src/lib/photoStore.js';
import { newDraft, newPartida, normalizeDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { calcFloor } from '../src/lib/calc.js';
import { buildClientModel, buildTechModel } from '../src/lib/reports.js';
import { renderClientPdf, renderTechPdf, pdfMoneyFormatter } from '../src/lib/pdf.js';
import { makeI18n } from '../src/lib/i18n.jsx';
import { DICT } from '../src/lib/dict.js';

// A valid (1x1) JPEG data URL: enough for the PDF engine, which embeds the bytes as-is.
const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
// jsPDF de-duplicates identical images, so each slot gets a distinct (still valid) variant.
const variant = (k) => {
  const at = JPEG.indexOf('//////') + 40;
  return JPEG.slice(0, at) + 'ABCD'[k % 4] + JPEG.slice(at + 1);
};
const photo = (slot, extra = {}) => ({ slot, dataUrl: variant(slot), width: 1200, height: 800, at: 1, ...extra });

describe('Obrax branding', () => {
  it('uses the new name everywhere it is defined', () => {
    expect(BRAND.name).toBe('Obrax');
    expect(BRAND.shortName).toBe('Obrax');
    const m = buildManifest();
    expect(m.name).toBe('Obrax');
    expect(m.short_name).toBe('Obrax');
    expect(m.id).toBe('com.obrax.app');
    expect(m.icons.length).toBeGreaterThanOrEqual(4);
    expect(DICT.es['app.name']).toBe('Obrax');
    expect(DICT.en['app.name']).toBe('Obrax');
  });
  it('index.html carries the requested title and brand meta', () => {
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('<title>Obrax - Cubicación &amp; Presupuestos de Obra</title>');
    expect(html).toContain('content="Obrax"');
    expect(BRAND.title).toBe('Obrax - Cubicación & Presupuestos de Obra');
  });
  it('keeps the embedded construction logo (helmet, blueprint grid, measuring tape)', () => {
    const svg = buildIconSvg();
    expect(svg).toContain('<svg');
    expect(svg).toContain('aria-label="Obrax"');
  });
  it('no source file still uses the old brand', () => {
    const files = ['index.html', 'package.json', 'public/robots.txt', 'src/lib/dict.js', 'src/lib/pdf.js', 'src/brand/icon.js'];
    for (const f of files) {
      const text = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
      expect(/cubicador/i.test(text), f).toBe(false);
    }
  });
});

describe('floor screed shares cement with slabs and walls', () => {
  it('adds cement and sand only when the screed option is on', () => {
    const off = calcFloor({ length: 5, width: 4, screed: 0 });
    const on = calcFloor({ length: 5, width: 4, screed: 1 });
    expect(off.lines.some((l) => l.id === 'cement_bag')).toBe(false);
    const cement = on.lines.find((l) => l.id === 'cement_bag').qty;
    expect(cement).toBeCloseTo(20 * 0.04 * 16, 6);
    expect(on.lines.find((l) => l.id === 'sand').qty).toBeCloseTo(20 * 0.04 * 1.1, 6);
  });

  it('aggregates cement of radier + masonry + floor screed into ONE purchase line', () => {
    const d = newDraft('CL', 'project');
    const slab = newPartida('slab');
    slab.dims = { ...slab.dims, length: 6, width: 4 };
    const wall = newPartida('masonry');
    wall.dims = { ...wall.dims, length: 10, height: 2.4 };
    const floor = newPartida('floor');
    floor.dims = { ...floor.dims, length: 6, width: 4, screed: 1 };
    d.partidas = [slab, wall, floor];
    const r = computeAll(d, 1_700_000_000_000);
    expect(r.valid).toBe(true);
    const cement = r.quote.items.filter((i) => i.id === 'cement_bag');
    expect(cement).toHaveLength(1);
    expect(Object.keys(cement[0].shares).sort()).toEqual(['0', '1', '2']);
    expect(Number.isInteger(cement[0].packs)).toBe(true);
    const separate = d.partidas.map((p) => {
      const q = computeAll({ ...d, partidas: [p] }, 1_700_000_000_000).quote.items.find((i) => i.id === 'cement_bag');
      return q ? q.packs : 0;
    });
    expect(cement[0].packs).toBeLessThanOrEqual(separate.reduce((s, v) => s + v, 0));
  });
});

describe('photo limits and validation', () => {
  it('allows at most 4 photos per project', () => {
    expect(MAX_PHOTOS).toBe(4);
    expect(PHOTO_SLOTS).toEqual(['panoramic', 'existing', 'details', 'logistics']);
    let slots = emptySlots();
    for (let i = 0; i < 10; i += 1) slots = putPhoto(slots, i, photo(i % 4));
    expect(slots).toHaveLength(4);
    expect(countPhotos(slots)).toBe(4);
    expect(firstFreeSlot(slots)).toBe(-1);
    // out of range slots are ignored
    expect(countPhotos(putPhoto(emptySlots(), 4, photo(0)))).toBe(0);
    expect(countPhotos(putPhoto(emptySlots(), -1, photo(0)))).toBe(0);
    expect(countPhotos(putPhoto(emptySlots(), 1.5, photo(0)))).toBe(0);
  });

  it('replacing keeps the count; removing frees the slot', () => {
    let slots = putPhoto(emptySlots(), 2, photo(2, { at: 1 }));
    slots = putPhoto(slots, 2, photo(2, { at: 99 }));
    expect(countPhotos(slots)).toBe(1);
    expect(slots[2].at).toBe(99);
    slots = removePhoto(slots, 2);
    expect(countPhotos(slots)).toBe(0);
    expect(firstFreeSlot(slots)).toBe(0);
  });

  it('fitSize caps the longest side at 1200 px, keeps the ratio and never upscales', () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 1200, height: 900 });
    expect(fitSize(3000, 4000)).toEqual({ width: 900, height: 1200 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(0, 10)).toEqual({ width: 0, height: 0 });
    expect(fitSize(1200, 1200)).toEqual({ width: 1200, height: 1200 });
  });

  it('size budget is ~150 KB per image', () => {
    expect(PHOTO_LIMITS.maxSide).toBe(1200);
    expect(PHOTO_LIMITS.targetBytes).toBeGreaterThanOrEqual(120_000);
    expect(PHOTO_LIMITS.targetBytes).toBeLessThanOrEqual(150_000);
    expect(dataUrlBytes(`data:image/jpeg;base64,${'A'.repeat(400)}`)).toBe(300);
  });

  it('rejects hostile or oversized stored photos', () => {
    expect(isValidPhotoDataUrl(JPEG)).toBe(true);
    expect(isValidPhotoDataUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isValidPhotoDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isValidPhotoDataUrl('javascript:alert(1)')).toBe(false);
    expect(isValidPhotoDataUrl(`data:image/jpeg;base64,${'A'.repeat(600_000)}`)).toBe(false);
    expect(normalizePhoto(photo(0, { width: 99999 }))).toBeNull();
    expect(normalizePhoto(photo(0, { height: -3 }))).toBeNull();
    expect(normalizePhoto(photo(7))).toBeNull();
    expect(normalizePhoto(null)).toBeNull();
    expect(normalizePhotos('nope')).toEqual(emptySlots());
    const slots = normalizePhotos([photo(0), photo(0, { at: 5 }), photo(1, { dataUrl: 'x' }), photo(9), null, 3, photo(3)]);
    expect(slots.map((s) => !!s)).toEqual([true, false, false, true]);
    expect(slots[0].at).toBe(1); // first valid photo of a slot wins
  });

  it('labels photos for the reports in slot order', () => {
    const { t } = makeI18n('es', 'CL');
    let slots = putPhoto(emptySlots(), 3, photo(3));
    slots = putPhoto(slots, 0, photo(0));
    const list = photosForReport(slots, t);
    expect(list.map((p) => p.label)).toEqual(['Panorámica', 'Logística / acceso']);
  });

  it('compressImage refuses non-images and absurd sizes before decoding', async () => {
    await expect(compressImage({ type: 'application/pdf', size: 10 })).rejects.toMatchObject({ code: 'type' });
    await expect(compressImage({ type: 'image/jpeg', size: PHOTO_LIMITS.maxInputBytes + 1 })).rejects.toBeInstanceOf(PhotoError);
    await expect(compressImage(null)).rejects.toMatchObject({ code: 'type' });
  });
});

describe('photo persistence', () => {
  it('stores, reloads and deletes photos', async () => {
    const store = createPhotoStore(memoryBackend());
    await store.save(photo(0));
    await store.save(photo(2));
    expect(countPhotos(await store.load())).toBe(2);
    await store.remove(0);
    expect((await store.load()).map((p) => !!p)).toEqual([false, false, true, false]);
    await store.clear();
    expect(countPhotos(await store.load())).toBe(0);
  });

  it('refuses invalid photos and never returns more than 4 on load', async () => {
    const store = createPhotoStore(memoryBackend());
    await expect(store.save({ slot: 0, dataUrl: 'evil', width: 1, height: 1 })).rejects.toThrow();
    const backend = memoryBackend();
    for (let i = 0; i < 10; i += 1) await backend.put({ ...photo(i % 4), slot: i });
    const loaded = await createPhotoStore(backend).load();
    expect(loaded).toHaveLength(4);
  });

  it('degrades to memory if IndexedDB fails', async () => {
    const broken = {
      kind: 'indexeddb',
      getAll: async () => {
        throw new Error('boom');
      },
      put: async () => {
        throw new Error('boom');
      },
      remove: async () => {
        throw new Error('boom');
      },
      clear: async () => {
        throw new Error('boom');
      },
    };
    const store = createPhotoStore(broken);
    await store.save(photo(1));
    expect(store.kind).toBe('memory');
    expect(countPhotos(await store.load())).toBe(1);
  });
});

describe('draft keeps the client-photo toggle', () => {
  it('defaults ON (photos reach the client PDF) and only an explicit choice can switch them off', () => {
    expect(newDraft('CL').attachPhotos).toBe(true);
    expect(newDraft('CL').photosChoice).toBe(false);
    // drafts saved before the choice existed stored `false` as a mere default: photos are on again
    expect(normalizeDraft({ regionCode: 'CL', attachPhotos: false }, 'CL').attachPhotos).toBe(true);
    expect(normalizeDraft({ regionCode: 'CL' }, 'CL').attachPhotos).toBe(true);
    // once the user touched the switch, it is taken literally
    expect(normalizeDraft({ regionCode: 'CL', attachPhotos: false, photosChoice: true }, 'CL').attachPhotos).toBe(false);
    expect(normalizeDraft({ regionCode: 'CL', attachPhotos: true, photosChoice: true }, 'CL').attachPhotos).toBe(true);
    expect(normalizeDraft({ regionCode: 'CL', attachPhotos: 'no', photosChoice: true }, 'CL').attachPhotos).toBe(true); // junk is not a "no"
    expect(normalizeDraft({ regionCode: 'CL', photosChoice: 'yes' }, 'CL').photosChoice).toBe(false);
  });
});

describe('PDFs with field photos', () => {
  function ctx() {
    const d = newDraft('CL');
    d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
    const result = computeAll(d, 1_700_000_000_000);
    const i = makeI18n('es', 'CL');
    const company = { name: 'Constructora Aurora SpA', taxId: '76.123.456-7', phone: '', email: '', city: '' };
    const money = pdfMoneyFormatter(i.region);
    const base = { draft: d, result, company, region: i.region, t: i.t, num: i.num, unit: i.unit, date: i.date };
    let slots = emptySlots();
    for (let s = 0; s < 4; s += 1) slots = putPhoto(slots, s, photo(s));
    return { base, i, money, photos: photosForReport(slots, i.t) };
  }
  const raw = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
  const images = (s) => (s.match(/\/Subtype \/Image/g) || []).length;

  it('technical dossier always embeds the 2x2 evidence grid', async () => {
    const { base, i, money, photos } = ctx();
    const doc = await renderTechPdf(buildTechModel({ ...base, money }), { t: i.t, money, photos });
    const s = raw(doc);
    expect(images(s)).toBe(4);
    expect(s).toContain('Registro visual en terreno');
    for (const label of ['Panor', 'Estructura existente', 'Encuentros', 'Log']) expect(s).toContain(label);
  });

  it('technical dossier without photos has no grid', async () => {
    const { base, i, money } = ctx();
    const s = raw(await renderTechPdf(buildTechModel({ ...base, money }), { t: i.t, money }));
    expect(images(s)).toBe(0);
    expect(s).not.toContain('Registro visual');
  });

  it('client budget has photos only when attached, and stays confidential', async () => {
    const { base, money, photos } = ctx();
    const model = buildClientModel(base);
    const without = raw(await renderClientPdf(model, { money, photos: [], photosTitle: 'Registro fotografico' }));
    expect(images(without)).toBe(0);
    const withPhotos = raw(await renderClientPdf(model, { money, photos, photosTitle: 'Registro fotografico' }));
    expect(images(withPhotos)).toBe(4);
    const lower = withPhotos.toLowerCase();
    for (const chain of ['sodimac', 'easy', 'construmart']) expect(lower.includes(chain), chain).toBe(false);
    expect(lower).not.toContain('sobrantes');
  });

  it('a corrupt photo never breaks the document', async () => {
    const { base, i, money, photos } = ctx();
    const bad = photos.map((p, k) => (k === 1 ? { ...p, dataUrl: 'data:image/jpeg;base64,AAAA' } : p));
    const doc = await renderTechPdf(buildTechModel({ ...base, money }), { t: i.t, money, photos: bad });
    expect(raw(doc).startsWith('%PDF')).toBe(true);
  });
});

describe('dictionary', () => {
  it('has every photo key in both languages with matching parameters', () => {
    const keys = Object.keys(DICT.es).filter((k) => k.startsWith('photo.'));
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const k of keys) {
      expect(DICT.en[k], k).toBeTruthy();
      const params = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
      expect(params(DICT.en[k]), k).toBe(params(DICT.es[k]));
    }
    expect(Object.keys(DICT.es).sort()).toEqual(Object.keys(DICT.en).sort());
  });
});
