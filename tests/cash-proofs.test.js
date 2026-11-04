// @vitest-environment happy-dom
// "Anticipi e pagamenti del cliente" Zero Stress: how they paid is ONE tap (Contanti / Bonifico / Assegno), the proof (cheque,
// transfer slip) is a photo kept in IndexedDB like the logbook photos, the note is a quiet optional extra and the % shortcuts are secondary.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import CashBlock from '../src/components/workspace/CashBlock.jsx';
import { CLIENT_PAYMENT_METHODS, normalizePayments } from '../src/lib/ledger.js';
import { newProject, normalizeProject } from '../src/lib/projects.js';
import { normalizeNotePhoto } from '../src/lib/notePhotos.js';
import { paymentPhotosFor } from '../src/lib/paymentPhotos.js';
import { DICT } from '../src/lib/dict.js';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2Q==';

// the canvas compressor does not exist in happy-dom: replaced by a fixture; the store, Blob and UI are real
vi.mock('../src/lib/paymentPhotos.js', async (importOriginal) => {
  const real = await importOriginal();
  const { normalizeNotePhoto: norm } = await import('../src/lib/notePhotos.js');
  return { ...real, preparePaymentPhoto: vi.fn(async () => norm({ dataUrl: JPEG, width: 800, height: 600, at: 1 })) };
});

globalThis.Blob = NodeBlob;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
let host;
let root;
const q = (id) => host.querySelector(`[data-testid="${id}"]`) ?? document.querySelector(`[data-testid="${id}"]`);
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
const keys = async (s) => {
  for (const k of s) await click(q(`pad-${k}`));
};
const pickFile = async (input) => {
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'cheque.jpg', { type: 'image/jpeg' })], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush(20);
};

let spy;
function Harness({ projectId, lang = 'es' }) {
  const [payments, set] = useState([]);
  spy.payments = payments;
  return h(I18nProvider, { lang, regionCode: 'CL' }, h(CashBlock, { projectId, total: 100000, payments, onChange: set, open: true, onToggle: () => {} }));
}
const mount = async (projectId = 'proj-cash', lang = 'es') => {
  spy = {};
  await act(async () => {
    root.render(h(Harness, { projectId, lang }));
  });
  await flush();
};
const addPayment = async (digits) => {
  await click(q('cash-amount'));
  await keys(digits);
  await click(q('pad-done'));
  await click(q('cash-add'));
};

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

describe('payment method chips (zero typing)', () => {
  it('three one-tap chips with an icon each: Efectivo / Transferencia / Cheque (Contanti / Bonifico / Assegno in Italian)', async () => {
    await mount();
    const chips = CLIENT_PAYMENT_METHODS.map((m) => q(`cash-method-${m}`));
    expect(chips.map((c) => c.textContent)).toEqual(['Efectivo', 'Transferencia', 'Cheque']);
    for (const c of chips) {
      expect(c.getAttribute('role')).toBe('radio');
      expect(c.querySelector('svg[data-outline-icon="true"]')).not.toBeNull();
      expect(c.className).toMatch(/min-h-\[44px\]/); // a real touch target, but a slim pill (no giant squares)
      expect(c.className).not.toMatch(/\bborder\b/); // no borders between the options
    }
    expect(chips[0].querySelector('rect[width="20"][height="12"]')).not.toBeNull(); // Banknote
    expect(chips[1].querySelector('path[d^="M12 2 20 7"]')).not.toBeNull(); // Landmark
    expect(chips[2].querySelector('path[d^="M4 2v20"]')).not.toBeNull(); // Receipt
    expect(chips.every((c) => c.getAttribute('aria-checked') === 'false')).toBe(true);
    for (const [m, label] of [['cash', 'Contanti'], ['transfer', 'Bonifico'], ['check', 'Assegno']]) expect(DICT.it[`ws.cash.m.${m}`]).toBe(label);
  });

  it('a tap selects (one at a time), a second tap clears; the payment is saved with it and the history row shows it', async () => {
    await mount();
    await click(q('cash-method-transfer'));
    expect(q('cash-method-transfer').getAttribute('aria-checked')).toBe('true');
    await click(q('cash-method-check'));
    expect(q('cash-method-transfer').getAttribute('aria-checked')).toBe('false');
    expect(q('cash-method-check').getAttribute('aria-checked')).toBe('true');
    await addPayment('5000');
    expect(spy.payments[0]).toMatchObject({ amount: 5000, method: 'check' });
    expect(q(`cash-row-${spy.payments[0].id}`).querySelector('[data-testid="cash-method-tag"]').textContent).toBe('Cheque');
    expect(q('cash-method-check').getAttribute('aria-checked')).toBe('false'); // the form resets
    await click(q('cash-method-cash'));
    await click(q('cash-method-cash')); // toggled off again
    await addPayment('300');
    expect(spy.payments[0].method).toBeUndefined();
    expect(q(`cash-row-${spy.payments[0].id}`).querySelector('[data-testid="cash-method-tag"]')).toBeNull();
  });

  it('the free note is optional and secondary: hidden behind a quiet button, and no keyboard is needed to register a payment', async () => {
    await mount();
    expect(q('cash-note')).toBeNull();
    expect(q('cash-note-open').textContent).toContain('(opcional)');
    await addPayment('1000');
    expect(spy.payments).toHaveLength(1);
    expect(spy.payments[0].note).toBe('');
    await click(q('cash-note-open'));
    await typeInto(q('cash-note'), 'anticipo inicial');
    await addPayment('2000');
    expect(spy.payments[0].note).toBe('anticipo inicial');
    expect(q('cash-note')).toBeNull(); // closed again
  });
});

describe('photo of the proof', () => {
  it('a camera button (capture=environment) prepares a photo; the payment is registered at once and the Blob is written to the IndexedDB scope in the background', async () => {
    await mount('proj-p1');
    const input = q('cash-photo-input');
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.getAttribute('accept')).toBe('image/*');
    expect(q('cash-photo').querySelector('svg path[d^="M14.5 4h-5"]')).not.toBeNull(); // Camera
    expect(q('cash-photo').className).toMatch(/min-h-\[44px\]/);
    expect(q('cash-photo-preview')).toBeNull();
    await pickFile(input);
    expect(q('cash-photo-preview')).not.toBeNull();
    expect(q('cash-photo').textContent).toBe('Cambiar foto');
    await addPayment('7000');
    const [p] = spy.payments;
    expect(p).toMatchObject({ amount: 7000, photo: true });
    const row = await paymentPhotosFor('proj-p1').get(p.id);
    expect(row.blob).toBeInstanceOf(Blob);
    expect(q('cash-photo-preview')).toBeNull(); // the form resets
    // the history row has a thumbnail that opens the viewer full screen
    expect(q(`cash-thumb-${p.id}`).dataset.pending).toBeUndefined();
    await click(q(`cash-thumb-${p.id}`));
    expect(q('photo-lightbox')).not.toBeNull();
    expect(q('photo-lightbox-img').getAttribute('src')).toMatch(/^blob:/);
    await click(q('photo-lightbox-close'));
    expect(q('photo-lightbox')).toBeNull();
  });

  it('the pending photo can be removed before saving; a payment without photo has no thumbnail', async () => {
    await mount('proj-p2');
    await pickFile(q('cash-photo-input'));
    await click(q('cash-photo-remove'));
    expect(q('cash-photo-preview')).toBeNull();
    expect(q('cash-photo').textContent).toBe('Foto del comprobante');
    await addPayment('900');
    expect(spy.payments[0].photo).toBeUndefined();
    expect(q(`cash-thumb-${spy.payments[0].id}`)).toBeNull();
  });

  it('deleting a payment deletes its photo from the store', async () => {
    await mount('proj-p3');
    await pickFile(q('cash-photo-input'));
    await addPayment('1200');
    const id = spy.payments[0].id;
    expect(await paymentPhotosFor('proj-p3').get(id)).not.toBeNull();
    await click(q(`cash-del-${id}`));
    expect(spy.payments).toHaveLength(0);
    expect(await paymentPhotosFor('proj-p3').get(id)).toBeNull();
  });

  it('the payment photos have their own scope: the logbook and receipts never see them', async () => {
    const { notePhotosFor } = await import('../src/lib/notePhotos.js');
    await paymentPhotosFor('proj-scope').put('abc', { dataUrl: JPEG, width: 8, height: 8, at: 1 });
    expect(await paymentPhotosFor('proj-scope').get('abc')).not.toBeNull();
    expect(await notePhotosFor('proj-scope').get('abc')).toBeNull();
    expect(normalizeNotePhoto({ dataUrl: JPEG, width: 8, height: 8 })).not.toBeNull();
  });
});

describe('percentage shortcuts: clean and secondary', () => {
  it('[25 %] [50 %] [75 %] [Saldo] are borderless pill chips that do not compete with the amount or the confirm button', async () => {
    await mount();
    const row = q('cash-quick');
    const btns = [...row.querySelectorAll('button')];
    expect(btns.map((b) => b.textContent)).toEqual(['25 %', '50 %', '75 %', 'Saldo']);
    for (const b of btns) {
      expect(b.className).toContain('border-none');
      expect(b.className).toContain('rounded-full');
      expect(b.className).toContain('bg-neutral-900');
      expect(b.className).toContain('text-xs');
      expect(b.className).toContain('font-medium');
      expect(b.className).not.toMatch(/font-(bold|extrabold|black|semibold)/);
      expect(b.className).not.toMatch(/border-brand|text-brand|border-2|border-emerald/);
      expect(b.className).toMatch(/min-h-\[44px\]/); // still a real touch target
    }
    // the confirm button is the loud one
    expect(q('cash-add').className).toContain('bg-brand'); // solid, filled: no outline
    expect(q('cash-add').className).toMatch(/font-(semibold|medium)/);
    await click(q('cash-quick-0.5'));
    expect(q('cash-amount').textContent).toContain('50.000');
  });
});

describe('model', () => {
  it('normalizePayments keeps a valid method and the photo flag, drops junk; old payments load as before', () => {
    const [a, b, c, d] = normalizePayments([
      { id: 'aaaa1', amount: 10, at: 1, method: 'check', photo: true },
      { id: 'aaaa2', amount: 20, at: 2, method: 'bitcoin', photo: 'yes' },
      { id: 'aaaa3', amount: 30, at: 3 },
      { id: 'aaaa4', amount: 40, at: 4, method: 'transfer' },
    ]);
    expect(a).toMatchObject({ method: 'check', photo: true });
    expect(b.method).toBeUndefined();
    expect(b.photo).toBeUndefined();
    expect(c).toEqual({ id: 'aaaa3', amount: 30, at: 3, note: '' });
    expect(d.method).toBe('transfer');
  });

  it('a project keeps method + photo through a JSON round trip (storage / backup)', () => {
    const p = { ...newProject({ regionCode: 'CL', name: 'X' }), payments: [{ id: 'pay001', amount: 500, at: 5, note: '', method: 'cash', photo: true }] };
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.payments[0]).toMatchObject({ method: 'cash', photo: true });
  });

  it('every new string exists in the six languages', () => {
    const keys = ['ws.cash.m.cash', 'ws.cash.m.transfer', 'ws.cash.m.check', 'ws.cash.method', 'ws.cash.noteAdd', 'ws.cash.photoAdd', 'ws.cash.photoChange', 'ws.cash.photoOpen', 'ws.cash.photoRemove'];
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) for (const k of keys) expect(DICT[l][k], `${l}:${k}`).toBeTruthy();
  });
});

describe('Phase 10: the client payments view has no borders and saves at once', () => {
  it('top indicators: "Manca" leads, the quote and what was collected are quiet text, none of them in a bordered box', async () => {
    await mount();
    const panel = q('cash-panel');
    const dd = (id) => q(id);
    for (const c of ['text-lg', 'font-medium', 'text-neutral-200']) expect(dd('cash-pending').className).toContain(c);
    for (const id of ['cash-total', 'cash-paid']) expect(dd(id).closest('div').className).toMatch(/text-xs text-neutral-500|flex/);
    expect(panel.querySelector('dl').className).not.toMatch(/grid-cols-3/);
    for (const el of panel.querySelectorAll('dl, dl *')) expect(el.className?.toString() || '').not.toMatch(/\bborder\b/);
  });

  it('nothing in the panel carries a border (amount, chips, methods, optionals, rows)', async () => {
    await mount();
    await click(q('cash-note-open'));
    await addPayment('1000');
    const bad = [...q('cash-panel').querySelectorAll('*')].filter((el) => /(^|\s)border(-[trblxy])?(\s|$)|border-white|border-neutral/.test(el.getAttribute('class') || '') && !/border-none|border-transparent|border-l-2 border-\[#e8c35f\]/.test(el.getAttribute('class') || ''));
    expect(bad.map((e) => e.getAttribute('class'))).toEqual([]);
  });

  it('the amount is a big light number on a soft fill, with no border', async () => {
    await mount();
    expect(q('cash-amount').className).toMatch(/bg-neutral-900\/50/);
    expect(q('cash-amount').className).not.toMatch(/\bborder\b/);
    expect(q('cash-amount').querySelector('span:last-child').className).toMatch(/text-3xl font-light/);
  });

  it('the chip in use changes tone and goes back to quiet when the amount is typed by hand', async () => {
    await mount();
    await click(q('cash-quick-0.5'));
    expect(q('cash-quick-0.5').getAttribute('aria-pressed')).toBe('true');
    expect(q('cash-quick-0.5').className).toContain('bg-white/10');
    expect(q('cash-quick-0.25').className).toContain('text-neutral-400');
    await click(q('cash-amount'));
    await keys('7');
    await click(q('pad-done'));
    expect(q('cash-quick-0.5').getAttribute('aria-pressed')).toBe('false');
  });

  it('methods are a segmented control: only the active segment is lit (bg-white/10, off-white text: never pure white on OLED)', async () => {
    await mount();
    expect(q('cash-methods').className).toMatch(/rounded-full bg-neutral-900/);
    await click(q('cash-method-transfer'));
    expect(q('cash-method-transfer').className).toContain('bg-white/10 text-neutral-100');
    expect(q('cash-method-cash').className).not.toContain('bg-white/10');
  });

  it('photo and note live in ONE quiet row (icon + text-xs), right above the register button', async () => {
    await mount();
    const photo = q('cash-photo');
    const note = q('cash-note-open');
    expect(photo.parentElement).toBe(note.parentElement);
    for (const b of [photo, note]) {
      expect(b.className).toMatch(/text-xs text-neutral-400/);
      expect(b.className).not.toMatch(/\bborder\b/);
      expect(b.querySelector('svg')).not.toBeNull();
    }
    expect(photo.parentElement.nextElementSibling).toBe(q('cash-add'));
  });

  it('registering is optimistic: the row, the totals and a clean form are there in the same tick, and the view goes to the history', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    await mount();
    await click(q('cash-amount'));
    await keys('2500');
    await click(q('pad-done'));
    await act(async () => q('cash-add').click()); // no awaiting of anything else
    expect(spy.payments).toHaveLength(1);
    expect(q(`cash-row-${spy.payments[0].id}`)).not.toBeNull();
    expect(q('cash-amount').textContent).toContain('—'); // the form is clean again
    await flush(10);
    expect(scrolled).toHaveBeenCalled();
    expect(scrolled.mock.contexts[0]).toBe(q('cash-history'));
    delete Element.prototype.scrollIntoView;
  });

  it('a photo that the device refuses does not lose the payment: it only loses its photo flag', async () => {
    await mount('proj-fail');
    await pickFile(q('cash-photo-input'));
    const spyPut = vi.spyOn(paymentPhotosFor('proj-fail'), 'put').mockRejectedValue(new Error('quota'));
    await addPayment('1500');
    await flush(20);
    expect(spy.payments).toHaveLength(1);
    expect(spy.payments[0].amount).toBe(1500);
    expect(spy.payments[0].photo).toBeUndefined();
    spyPut.mockRestore();
  });
});
