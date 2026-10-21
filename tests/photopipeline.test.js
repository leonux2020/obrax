import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  MAX_PHOTOS,
  PHOTO_LIMITS,
  PHOTO_SLOTS,
  PhotoError,
  compressImage,
  compressSource,
  compressVideoFrame,
  dataUrlBytes,
  emptySlots,
  loadImageElement,
  normalizePhoto,
  photosForReport,
  putPhoto,
  shouldUseLiveCamera,
} from '../src/lib/photos.js';
import { createPhotoStore, idbBackend } from '../src/lib/photoStore.js';
import { newDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { buildClientModel, buildTechModel } from '../src/lib/reports.js';
import { renderClientPdf, renderTechPdf, pdfMoneyFormatter } from '../src/lib/pdf.js';
import { makeI18n } from '../src/lib/i18n.jsx';

// ---- fake canvas environment ---------------------------------------------------------------------
// bytesPerPixelAtQ1 controls how "heavy" the pretend JPEG is: bytes = w*h*q*factor.
function fakeEnv(factor = 0.12) {
  const canvases = [];
  const makeCanvas = () => {
    const calls = { toDataURL: [], draws: [], smoothingAtDraw: [] };
    const canvas = {
      _w: 300, // DOM default: what an unsized canvas would be
      _h: 150,
      sized: false,
      calls,
      get width() { return this._w; },
      set width(v) { this._w = v; this.sized = true; },
      get height() { return this._h; },
      set height(v) { this._h = v; },
      getContext() {
        const ctx = {
          imageSmoothingEnabled: false,
          imageSmoothingQuality: 'low',
          fillStyle: '',
          fillRect() {},
          drawImage: (src, x, y, w, h) => {
            calls.draws.push({ w, h, src });
            calls.smoothingAtDraw.push([ctx.imageSmoothingEnabled, ctx.imageSmoothingQuality]);
          },
        };
        return ctx;
      },
      toDataURL(type, q) {
        calls.toDataURL.push([type, q]);
        const bytes = Math.round(this._w * this._h * q * factor);
        const n = Math.ceil((bytes * 4) / 3 / 4) * 4;
        return `data:${type};base64,${'A'.repeat(n)}`;
      },
    };
    canvases.push(canvas);
    return canvas;
  };
  return { makeCanvas, canvases };
}

describe('canvas compression pipeline', () => {
  it('4000x3000 -> proportional 1200x900, JPEG 0.82 first, ~100-160 KB', () => {
    const { makeCanvas, canvases } = fakeEnv();
    const photo = compressSource({ id: 'src' }, 4000, 3000, { makeCanvas, now: 7 });
    expect(photo.width).toBe(1200);
    expect(photo.height).toBe(900);
    expect(photo.at).toBe(7);
    const encoded = canvases.find((c) => c.calls.toDataURL.length);
    expect(encoded.calls.toDataURL[0]).toEqual(['image/jpeg', 0.82]);
    expect(photo.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(photo.bytes).toBeGreaterThanOrEqual(100_000);
    expect(photo.bytes).toBeLessThanOrEqual(160_000);
    expect(dataUrlBytes(photo.dataUrl)).toBe(photo.bytes);
  });

  it('sets canvas.width/height explicitly on every canvas (never the 300x150 default)', () => {
    const { makeCanvas, canvases } = fakeEnv();
    compressSource({}, 4000, 3000, { makeCanvas });
    expect(canvases.length).toBeGreaterThan(0);
    for (const c of canvases) {
      expect(c.sized).toBe(true);
      expect([c.width, c.height]).not.toEqual([300, 150]);
    }
  });

  it('enables high-quality smoothing before every drawImage', () => {
    const { makeCanvas, canvases } = fakeEnv();
    compressSource({}, 5000, 3750, { makeCanvas });
    for (const c of canvases) {
      expect(c.calls.draws.length).toBeGreaterThan(0);
      for (const s of c.calls.smoothingAtDraw) expect(s).toEqual([true, 'high']);
    }
  });

  it('downscales in halving steps (no single huge jump that aliases)', () => {
    const { makeCanvas, canvases } = fakeEnv();
    compressSource({}, 4800, 3600, { makeCanvas });
    const widths = canvases.map((c) => c.calls.draws.map((d) => d.w)).flat();
    // 4800 -> 2400 -> (final) 1200: the first draw is the intermediate half-size step
    expect(widths[0]).toBe(2400);
    expect(widths).toContain(1200);
    // every draw shrinks by < 2x relative to its own source, except the exact halving steps
    expect(Math.max(...widths)).toBeLessThanOrEqual(2400);
  });

  it('keeps portrait proportions and never upscales small images', () => {
    const p = compressSource({}, 3000, 4000, { makeCanvas: fakeEnv().makeCanvas });
    expect([p.width, p.height]).toEqual([900, 1200]);
    const small = compressSource({}, 800, 600, { makeCanvas: fakeEnv().makeCanvas });
    expect([small.width, small.height]).toEqual([800, 600]);
    const wide = compressSource({}, 6000, 1000, { makeCanvas: fakeEnv().makeCanvas });
    expect([wide.width, wide.height]).toEqual([1200, 200]);
  });

  it('heavy images lower the quality and then the size until they fit', () => {
    const { makeCanvas, canvases } = fakeEnv(0.4); // pretend very detailed content
    const photo = compressSource({}, 4000, 3000, { makeCanvas });
    expect(photo.bytes).toBeLessThanOrEqual(PHOTO_LIMITS.acceptBytes);
    const qualities = canvases.flatMap((c) => c.calls.toDataURL.map((x) => x[1]));
    expect(Math.min(...qualities)).toBeGreaterThanOrEqual(PHOTO_LIMITS.minQuality);
    expect(qualities[0]).toBe(0.82);
    expect(photo.width).toBeLessThan(1200); // had to shrink
    expect(photo.width / photo.height).toBeCloseTo(4 / 3, 1);
  });

  it('rejects empty/undecodable sources with a decode error', () => {
    expect(() => compressSource({}, 0, 0, { makeCanvas: fakeEnv().makeCanvas })).toThrow(PhotoError);
  });

  it('compressImage validates type and size, then runs the shared pipeline', async () => {
    const env = { makeCanvas: fakeEnv().makeCanvas, decode: async () => ({ source: {}, width: 3200, height: 2400, close() {} }) };
    await expect(compressImage({ type: 'application/pdf', size: 10 }, 1, env)).rejects.toMatchObject({ code: 'type' });
    await expect(compressImage({ type: 'image/png', size: PHOTO_LIMITS.maxInputBytes + 1 }, 1, env)).rejects.toMatchObject({ code: 'size' });
    await expect(compressImage(null, 1, env)).rejects.toMatchObject({ code: 'type' });
    const ok = await compressImage({ type: 'image/jpeg', size: 5_000_000 }, 99, env);
    expect([ok.width, ok.height]).toEqual([1200, 900]);
    expect(normalizePhoto(ok)).not.toBeNull();
  });

  it('live camera frame uses the same compressor (video intrinsic size)', () => {
    const env = { makeCanvas: fakeEnv().makeCanvas };
    const p = compressVideoFrame({ videoWidth: 1920, videoHeight: 1080 }, 5, env);
    expect([p.width, p.height]).toEqual([1200, 675]);
    expect(() => compressVideoFrame({ videoWidth: 0, videoHeight: 0 }, 5, env)).toThrow(PhotoError);
    expect(() => compressVideoFrame(null, 5, env)).toThrow(PhotoError);
  });
});

describe('image decoding waits before measuring', () => {
  it('awaits img.decode() so naturalWidth is real when measured', async () => {
    class FakeImage {
      constructor() { this.naturalWidth = 0; this.naturalHeight = 0; }
      set src(v) { this._src = v; }
      decode() {
        return new Promise((resolve) =>
          setTimeout(() => {
            this.naturalWidth = 4032;
            this.naturalHeight = 3024;
            resolve();
          }, 5)
        );
      }
    }
    const img = await loadImageElement('blob:x', FakeImage);
    expect([img.naturalWidth, img.naturalHeight]).toEqual([4032, 3024]);
  });

  it('falls back to onload when decode() is missing or rejects', async () => {
    class NoDecode {
      constructor() { this.naturalWidth = 0; this.naturalHeight = 0; }
      set src(v) {
        setTimeout(() => {
          this.naturalWidth = 640;
          this.naturalHeight = 480;
          this.onload();
        }, 5);
      }
    }
    expect((await loadImageElement('x', NoDecode)).naturalWidth).toBe(640);
    class RejectingDecode extends NoDecode {
      decode() { return Promise.reject(new Error('EncodingError')); }
    }
    expect((await loadImageElement('x', RejectingDecode)).naturalHeight).toBe(480);
  });

  it('reports decode errors for broken images', async () => {
    class Broken {
      set src(v) { setTimeout(() => this.onerror(), 1); }
    }
    await expect(loadImageElement('x', Broken)).rejects.toMatchObject({ code: 'decode' });
    class Empty {
      constructor() { this.naturalWidth = 0; this.naturalHeight = 0; }
      set src(v) { setTimeout(() => this.onload(), 1); }
    }
    await expect(loadImageElement('x', Empty)).rejects.toMatchObject({ code: 'decode' });
  });
});

describe('dual camera pipeline selection', () => {
  const gum = { mediaDevices: { getUserMedia: () => {} } };
  const mm = (coarse) => () => ({ matches: coarse });
  it('desktop with getUserMedia -> live in-app camera', () => {
    expect(shouldUseLiveCamera(gum, mm(false))).toBe(true);
  });
  it('phones/tablets (coarse pointer) -> native capture="environment" input', () => {
    expect(shouldUseLiveCamera(gum, mm(true))).toBe(false);
  });
  it('no getUserMedia / insecure origin -> clean fallback to file upload', () => {
    expect(shouldUseLiveCamera({}, mm(false))).toBe(false);
    expect(shouldUseLiveCamera({ mediaDevices: {} }, mm(false))).toBe(false);
    expect(shouldUseLiveCamera(undefined, mm(false))).toBe(false);
  });
});

// ---- IndexedDB persistence (real IndexedDB semantics via fake-indexeddb) --------------------------
const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const variant = (k) => {
  const at = JPEG.indexOf('//////') + 40;
  return JPEG.slice(0, at) + 'ABCD'[k % 4] + JPEG.slice(at + 1);
};
const photo = (slot) => ({ slot, dataUrl: variant(slot), width: 1200, height: 900, at: 100 + slot });

describe('four photo slots persist in IndexedDB', () => {
  it('slots are the four named evidence areas', () => {
    expect(MAX_PHOTOS).toBe(4);
    expect([...PHOTO_SLOTS]).toEqual(['panoramic', 'existing', 'details', 'logistics']);
  });

  it('saves Panoramica/Estructura/Encuentros/Logistica and restores them after a reload', async () => {
    const factory = new IDBFactory();
    const store = createPhotoStore(idbBackend(factory));
    for (let s = 0; s < 4; s += 1) await store.save(photo(s));
    expect(store.kind).toBe('indexeddb');

    // "reload": brand-new store + new connection over the same database
    const reloaded = createPhotoStore(idbBackend(factory));
    const slots = await reloaded.load();
    expect(reloaded.kind).toBe('indexeddb');
    expect(slots.every(Boolean)).toBe(true);
    slots.forEach((p, i) => {
      expect(p.slot).toBe(i);
      expect(p.dataUrl).toBe(variant(i));
      expect(p.at).toBe(100 + i);
    });
  });

  it('replace keeps 4 max, remove clears one slot, clear empties all', async () => {
    const factory = new IDBFactory();
    const store = createPhotoStore(idbBackend(factory));
    for (let s = 0; s < 4; s += 1) await store.save(photo(s));
    await store.save({ ...photo(2), dataUrl: variant(3), at: 999 }); // replace slot 2
    let slots = await store.load();
    expect(slots.filter(Boolean)).toHaveLength(4);
    expect(slots[2].at).toBe(999);
    await store.remove(1);
    slots = await store.load();
    expect(slots.filter(Boolean)).toHaveLength(3);
    expect(slots[1]).toBeNull();
    await store.clear();
    expect((await store.load()).filter(Boolean)).toHaveLength(0);
  });

  it('a fifth slot can never be stored', async () => {
    const store = createPhotoStore(idbBackend(new IDBFactory()));
    await expect(store.save(photo(4))).rejects.toThrow();
    expect((await store.load()).filter(Boolean)).toHaveLength(0);
  });
});

describe('persisted photos reach both PDFs', () => {
  const raw = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
  const images = (s) => (s.match(/\/Subtype \/Image/g) || []).length;

  it('after an IndexedDB round-trip: technical always, client only when toggled', async () => {
    const factory = new IDBFactory();
    const store = createPhotoStore(idbBackend(factory));
    for (let s = 0; s < 4; s += 1) await store.save(photo(s));
    const slots = await createPhotoStore(idbBackend(factory)).load();

    const d = newDraft('CL');
    d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
    const result = computeAll(d, 1_700_000_000_000);
    const i = makeI18n('es', 'CL');
    const money = pdfMoneyFormatter(i.region, i.locale);
    const base = { draft: d, result, company: { name: 'Obra', taxId: '', phone: '', email: '', city: '' }, region: i.region, t: i.t, num: i.num, unit: i.unit, date: i.date };
    const photos = photosForReport(slots, i.t);
    expect(photos.map((p) => p.label)).toEqual(PHOTO_SLOTS.map((k) => i.t(`photo.slot.${k}`)));
    expect(photos[0].label).toBe('Panorámica');

    const tech = raw(await renderTechPdf(buildTechModel({ ...base, money }), { t: i.t, num: i.num, money, photos }));
    expect(images(tech)).toBe(4);

    const model = buildClientModel(base);
    const off = raw(await renderClientPdf(model, { money, photos: d.attachPhotos ? photos : [], photosTitle: i.t('photo.pdfClientTitle') }));
    expect(images(off)).toBe(0);
    const on = raw(await renderClientPdf(model, { money, photos, photosTitle: i.t('photo.pdfClientTitle') }));
    expect(images(on)).toBe(4);
  });

  it('empty slots never produce an empty grid', () => {
    expect(photosForReport(emptySlots(), (k) => k)).toEqual([]);
    expect(photosForReport(putPhoto(emptySlots(), 2, photo(2)), (k) => k)).toHaveLength(1);
  });
});
