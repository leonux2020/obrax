// @vitest-environment happy-dom
// Progress photos as an immersive gallery: a filled tile opens a full-screen carousel that skips the empty tiles, deleting is hidden behind
// an Edit mode, and the photo panel trades its x for the Edit toggle (it closes the native way).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import { DICT } from '../src/lib/dict.js';
import SnapGrid from '../src/components/SnapGrid.jsx';
import { PhotoSheet } from '../src/components/ProjectWorkspace.jsx';
import { emptySlots } from '../src/lib/photos.js';
import { q, click } from './helpers/appHarness.js';

const qa = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)];

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const photo = (slot) => ({ slot, dataUrl: JPEG, width: 1080, height: 810, at: 1 });
const withPhotos = (...slots) => {
  const a = emptySlots();
  for (const s of slots) a[s] = photo(s);
  return a;
};

describe('photo gallery, edit mode and native close', () => {
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
  const Stateful = ({ initial, sheet = false }) => {
    const [photos, setPhotos] = useState(initial);
    return sheet ? h(PhotoSheet, { photos, setPhotos, projectId: 'p1', onClose: () => {} }) : h(SnapGrid, { photos, setPhotos, projectId: 'p1' });
  };
  const mount = (initial, sheet = false) => act(async () => root.render(h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(Stateful, { initial, sheet }))));
  const press = (el, key) => act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));

  it('tapping a filled tile opens the full-screen gallery on THAT photo; an empty tile still goes to the camera (no gallery)', async () => {
    await mount(withPhotos(1, 4, 7));
    expect(q('photo-lightbox')).toBeNull();
    await click(q('snap-view-4'));
    const box = q('photo-lightbox');
    expect(box).not.toBeNull();
    expect(box.className).toContain('fixed inset-0');
    expect(box.parentElement).toBe(document.body); // portal: nothing under it hears its gestures
    expect(box.dataset.index).toBe('1');
    expect(q('lightbox-counter').textContent).toBe('2 / 3');
    // an empty tile never opens the gallery: it asks for the camera
    await press(box, 'Escape');
    expect(q('photo-lightbox')).toBeNull();
    expect(q('snap-0')).not.toBeNull(); // empty tile = camera button
    expect(q('snap-view-0')).toBeNull(); // ... and has no viewer
  });

  it('the carousel holds ONLY the captured photos (empty tiles are skipped) and moves with arrows / keys', async () => {
    await mount(withPhotos(2, 5, 9));
    await click(q('snap-view-2'));
    expect(qa('lightbox-slide-2').length + qa('lightbox-slide-5').length + qa('lightbox-slide-9').length).toBe(3);
    expect([...q('lightbox-strip').children]).toHaveLength(3); // no slide for the 9 empty tiles
    expect(q('lightbox-counter').textContent).toBe('1 / 3');
    expect(q('lightbox-prev').disabled).toBe(true);
    await click(q('lightbox-next'));
    expect(q('lightbox-counter').textContent).toBe('2 / 3');
    expect(q('lightbox-caption').textContent).toBe('Avance 6'); // slot 5, not slot 3
    await press(q('photo-lightbox'), 'ArrowRight');
    expect(q('lightbox-counter').textContent).toBe('3 / 3');
    expect(q('lightbox-next').disabled).toBe(true);
    await press(q('photo-lightbox'), 'ArrowLeft');
    expect(q('lightbox-counter').textContent).toBe('2 / 3');
    // native swipe: a scroll-snap strip
    expect(q('lightbox-strip').className).toMatch(/snap-x/);
    expect(q('lightbox-strip').className).toMatch(/snap-mandatory/);
  });

  it('a single photo shows no arrows; the gallery has no close button (Escape / back / swipe down / the dark area close it)', async () => {
    await mount(withPhotos(3));
    await click(q('snap-view-3'));
    expect(q('lightbox-prev')).toBeNull();
    expect(q('photo-lightbox').querySelector('[data-sheet-close]')).toBeNull();
    expect([...q('photo-lightbox').querySelectorAll('button')]).toHaveLength(0);
    await click(q('lightbox-slide-3')); // the dark area around the photo
    expect(q('photo-lightbox')).toBeNull();
    await click(q('snap-view-3'));
    const touch = (type, y) => act(async () => { const e = new Event(type, { bubbles: true }); e[type === 'touchend' ? 'changedTouches' : 'touches'] = [{ clientX: 100, clientY: y }]; q('photo-lightbox').dispatchEvent(e); });
    await touch('touchstart', 100);
    await touch('touchend', 300);
    expect(q('photo-lightbox')).toBeNull();
  });

  it('deleting is hidden by default: no red badge on any photo until the Edit mode is on (grid alone: its own toggle)', async () => {
    await mount(withPhotos(0, 1, 2));
    expect(qa('snap-remove-0').length + qa('snap-remove-1').length + qa('snap-remove-2').length).toBe(0);
    expect(host.querySelectorAll('[data-testid^="snap-remove-"]')).toHaveLength(0);
    await click(q('photo-edit-toggle'));
    expect(host.querySelectorAll('[data-testid^="snap-remove-"]')).toHaveLength(3); // one per PHOTO, none on empty tiles
    expect(q('snap-remove-0').className).toContain('border-red-500');
    expect(q('snap-edit-hint')).not.toBeNull();
    await click(q('photo-edit-toggle'));
    expect(host.querySelectorAll('[data-testid^="snap-remove-"]')).toHaveLength(0);
  });

  it('the photo panel: the header action is the Edit toggle (pencil), NOT a close x; edit mode reveals the badges and deleting works', async () => {
    await mount(withPhotos(0, 6), true);
    const dialog = q('photo-sheet').closest('[role="dialog"]');
    expect(dialog.className).toContain('h-[85vh]');
    expect(dialog.getAttribute('data-swipe-close')).toBe('true'); // swipe down closes it
    expect(dialog.querySelector('[data-sheet-close]')).toBeNull(); // no x
    expect(dialog.textContent).not.toContain('×');
    const toggle = q('photo-edit-toggle');
    expect(dialog.querySelector('h2').nextElementSibling.contains(toggle)).toBe(true); // top right, where the x used to be
    expect(toggle.getAttribute('aria-label')).toBe('Editar fotos');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.querySelector('svg[data-icon="pencil"]')).not.toBeNull();
    expect(qa('snap-remove-0')).toHaveLength(0);
    await click(toggle);
    expect(q('photo-edit-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(q('photo-edit-toggle').getAttribute('aria-label')).toBe('Terminar edición');
    expect(q('photo-edit-toggle').querySelector('svg[data-icon="check"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-testid^="snap-remove-"]')).toHaveLength(2);
    await click(q('snap-remove-0'));
    expect(q('snap-view-0')).toBeNull();
    expect(q('snap-0')).not.toBeNull(); // the tile is empty again
    await click(q('snap-remove-6')); // last one: nothing left to edit, the mode switches itself off
    expect(q('photo-edit-toggle').disabled).toBe(true);
    expect(q('photo-edit-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('closing the panel is native: Escape closes the sheet, and the sheet is a back-stack layer (no close button needed)', () => {
    const sheet = readFileSync('src/components/BottomSheet.jsx', 'utf8');
    expect(sheet).toContain('useBackLayer(onClose)');
    expect(sheet).toContain("e.key === 'Escape'");
    const lb = readFileSync('src/components/PhotoLightbox.jsx', 'utf8');
    expect(lb).toContain('useBackLayer(onClose)');
  });

  it('the new texts exist in the six languages (placeholders aside) and are not left in Spanish', () => {
    for (const k of ['photo.edit', 'photo.editDone', 'photo.viewer', 'photo.prev', 'photo.next', 'photo.editHint']) {
      for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) expect(DICT[l][k], `${l}:${k}`).toBeTruthy();
      for (const l of ['en', 'fr', 'it', 'de']) expect(DICT[l][k], `${l}:${k}`).not.toBe(DICT.es[k]);
    }
    expect(DICT.it['photo.edit']).toBe('Modifica foto');
  });
});
