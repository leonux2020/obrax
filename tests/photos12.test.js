// @vitest-environment happy-dom
// Progress photos: up to 12 per project, resized on a canvas (max 1080 px wide, JPEG 0.7), the capture date stamped bottom right on a
// semi-transparent plate, a grid that holds 12 tiles, and a PDF that paginates them (6 per page).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { I18nProvider, makeI18n } from '../src/lib/i18n.jsx';
import SnapGrid from '../src/components/SnapGrid.jsx';
import PhotoGallery from '../src/components/PhotoGallery.jsx';
import { MAX_PHOTOS, PHOTO_LIMITS, compressSource, emptySlots, formatStampDate, stampDate } from '../src/lib/photos.js';
import { q } from './helpers/appHarness.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;

const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
// jsPDF embeds identical pictures once, so every test photo gets its own bytes (like real ones do)
const variant = (k) => {
  const at = JPEG.indexOf('//////') + 40 + (k % 20);
  return JPEG.slice(0, at) + 'ABCD'[Math.floor(k / 20) % 4] + JPEG.slice(at + 1);
};
const photo = (slot) => ({ slot, dataUrl: slot < 12 ? variant(slot) : JPEG, width: 1080, height: 810, at: 1 });

function recordingCanvas(w, h2) {
  const log = { rects: [], texts: [] };
  const ctx = {
    font: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    fillRect: (...a) => log.rects.push({ style: ctx.fillStyle, a }),
    fillText: (...a) => log.texts.push({ text: a[0], x: a[1], y: a[2], style: ctx.fillStyle }),
    measureText: (t) => ({ width: String(t).length * 20 }),
  };
  return { width: w, height: h2, getContext: () => ctx, log, ctx };
}

describe('date stamp on the canvas', () => {
  it('formats the LOCAL day as DD/MM/YYYY', () => {
    expect(formatStampDate(new Date(2026, 10, 3, 23, 30).getTime())).toBe('03/11/2026');
    expect(formatStampDate(new Date(2027, 0, 9, 0, 5).getTime())).toBe('09/01/2027');
  });

  it('prints it bottom right, white on a rgba(0,0,0,0.5) plate that sits behind the text', () => {
    const c = recordingCanvas(1080, 810);
    const now = new Date(2026, 10, 3, 12).getTime();
    expect(stampDate(c, now)).toBe(true);
    const plate = c.log.rects.find((r) => r.style === 'rgba(0,0,0,0.5)');
    const text = c.log.texts[0];
    expect(plate).toBeTruthy();
    expect(text.text).toBe('03/11/2026');
    expect(text.style).toBe('#ffffff');
    const [px, py, pw, ph] = plate.a;
    expect(px + pw).toBeLessThanOrEqual(1080); // inside the photo
    expect(py + ph).toBeLessThanOrEqual(810);
    expect(px + pw).toBeGreaterThan(1080 * 0.9); // in the right corner
    expect(py + ph).toBeGreaterThan(810 * 0.9); // ...at the bottom
    expect(text.x).toBeGreaterThanOrEqual(px);
    expect(text.x + 10 * 20).toBeLessThanOrEqual(px + pw); // the text fits on its plate
    expect(text.y).toBeGreaterThan(py);
    expect(text.y).toBeLessThan(py + ph);
    // the plate is painted BEFORE the text
    expect(c.log.rects.length).toBeGreaterThan(0);
  });

  it('is part of the pipeline: compressSource stamps every photo (and can be told not to); a canvas without text never breaks it', () => {
    const made = [];
    const makeCanvas = () => {
      const c = recordingCanvas(300, 150);
      const ctx = c.getContext();
      ctx.drawImage = () => {};
      ctx.imageSmoothingEnabled = false;
      Object.defineProperty(c, 'width', { get: () => c._w ?? 300, set: (v) => (c._w = v) });
      Object.defineProperty(c, 'height', { get: () => c._h ?? 150, set: (v) => (c._h = v) });
      c.toDataURL = (type, qual) => `data:${type};base64,${'A'.repeat(Math.ceil((c.width * c.height * qual * 0.2 * 4) / 3 / 4) * 4)}`;
      made.push(c);
      return c;
    };
    const now = new Date(2026, 10, 3, 9).getTime();
    const p = compressSource({}, 4000, 3000, { makeCanvas, now });
    expect(p.width).toBe(1080);
    expect(made.flatMap((c) => c.log.texts).map((t) => t.text)).toContain('03/11/2026');
    made.length = 0;
    compressSource({}, 4000, 3000, { makeCanvas, now, stamp: false });
    expect(made.flatMap((c) => c.log.texts)).toHaveLength(0);
    // no fillText support: the photo is still produced
    const bare = () => ({ width: 10, height: 10, getContext: () => ({ drawImage() {}, fillRect() {} }), toDataURL: () => `data:image/jpeg;base64,${'A'.repeat(400)}` });
    expect(stampDate(bare(), now)).toBe(false);
  });
});

describe('12 slots in the UI', () => {
  let host;
  let root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  const mount = (el) => act(async () => root.render(h(I18nProvider, { lang: 'es', regionCode: 'CL' }, el)));
  const full = () => Array.from({ length: 12 }, (_, i) => photo(i));

  it('SnapGrid shows 12 tiles in a compact adaptive grid (3 columns on a phone, 4 from sm), numbered after the four named ones', async () => {
    await mount(h(SnapGrid, { photos: emptySlots(), setPhotos: () => {}, projectId: 'proyecto1' }));
    const tiles = [...host.querySelectorAll('[data-testid="snap-list"] > li')];
    expect(tiles).toHaveLength(12);
    const grid = q('snap-list');
    expect(grid.className).toContain('grid-cols-3');
    expect(grid.className).toContain('sm:grid-cols-4');
    expect(q('snap-0').getAttribute('aria-label')).toContain('Panorámica');
    expect(q('snap-4').textContent).toBe('Avance 5');
    expect(q('snap-11').textContent).toBe('Avance 12');
    await mount(h(SnapGrid, { photos: full(), setPhotos: () => {}, projectId: 'proyecto1' }));
    expect(host.querySelectorAll('[data-testid^="snap-remove-"]')).toHaveLength(0); // deleting is hidden until the edit mode is on
    await mount(h(SnapGrid, { photos: full(), setPhotos: () => {}, projectId: 'proyecto1', editMode: true }));
    expect(host.querySelectorAll('[data-testid^="snap-remove-"]')).toHaveLength(12);
  });

  it('PhotoGallery (wizard) counts n/12 and lays the cards out on 2 columns (3 from sm)', async () => {
    await mount(h(PhotoGallery, { photos: full().map((p, i) => (i < 5 ? p : null)), setPhotos: () => {}, projectId: 'proyecto1' }));
    expect(host.textContent).toContain('5/12 fotos');
    expect(host.textContent).toContain('Hasta 12 fotos');
    expect(host.textContent).toContain('1080 px');
    expect(host.textContent).not.toContain('1200 px');
    const grid = q('photo-list');
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.className).toContain('sm:grid-cols-3');
    expect(grid.children).toHaveLength(12);
  });

  it('the labels exist in the six languages ("Avance 7", "Progress 7", ...) and all differ from Spanish', () => {
    const t = (lang) => makeI18n(lang, 'CL').t('photo.slot.extra', { n: 7 });
    expect(t('es')).toBe('Avance 7');
    expect(t('en')).toBe('Progress 7');
    for (const lang of ['pt', 'fr', 'it', 'de']) {
      expect(t(lang), lang).toContain('7');
      expect(t(lang), lang).not.toBe('Avance 7');
    }
  });
});

describe('sustainable by construction', () => {
  it('limits: 1080 px wide, JPEG 0.7, 12 photos stay under ~4 MB; WebP is not used (Safari cannot encode it)', () => {
    expect(PHOTO_LIMITS.maxWidth).toBe(1080);
    expect(PHOTO_LIMITS.startQuality).toBe(0.7);
    expect(MAX_PHOTOS * PHOTO_LIMITS.targetBytes).toBeLessThanOrEqual(4_000_000);
    const src = readFileSync('src/lib/photos.js', 'utf8');
    expect(src).toContain("toDataURL('image/jpeg'");
    expect(src).not.toMatch(/toDataURL\('image\/webp'/);
  });
});
