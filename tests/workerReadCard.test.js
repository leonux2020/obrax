// @vitest-environment happy-dom
// "Zero Stress" worker file: an existing worker opens as a clean READ-ONLY card (no inputs, no boxes, no lines) with a pencil in the header;
// the pencil reveals the form (hydrated); cancelling returns to the card with the stored data; a new worker opens straight in edit mode.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import WorkerSheet from '../src/components/squadra/WorkerSheet.jsx';
import { normalizeWorker } from '../src/lib/workers.js';
import { DICT } from '../src/lib/dict.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host;
let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};
const typeInto = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

const FULL = {
  id: 'wk000001',
  name: 'Juan Pérez Soto',
  apodo: 'El Flaco',
  specialties: ['electrician', 'painter'],
  rating: 4,
  phone: '+56 9 1234 5678',
  email: 'juan@obra.cl',
  city: 'Rancagua',
  address: 'Calle 5 #123',
  document: '12.345.678-9',
  nationality: 'Chilena',
  sex: 'm',
  birthDate: '1985-03-02',
  bloodType: 'O+',
  limiting: 'Rodilla izquierda',
  allergies: 'Penicilina',
  emergencyName: 'María',
  emergencyPhone: '+56 9 8765 4321',
};

let onSave;
let onClose;
const open = async (worker, lang = 'es') => {
  onSave = vi.fn();
  onClose = vi.fn();
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang, regionCode: 'CL' }, React.createElement(WorkerSheet, { worker, projects: [], onSave, onDelete: () => {}, onClose })));
  });
  await flush();
};
const dialog = () => document.querySelector('[role="dialog"]');
const fields = () => dialog().querySelectorAll('input, textarea, select');

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('1) an existing worker opens READ-ONLY', () => {
  it('HARD TEST 1: no inputs, no textareas, no selects, no form; the card is there', async () => {
    await open(FULL);
    expect(fields()).toHaveLength(0);
    expect(q('worker-form')).toBeNull();
    expect(q('worker-card')).not.toBeNull();
    expect(q('worker-save')).toBeNull();
  });
  it('the pencil sits in the header (top right), is a clean icon button, and is labelled', async () => {
    await open(FULL);
    const pencil = q('worker-edit');
    expect(pencil.closest('[data-sheet-header]')).not.toBeNull();
    expect(pencil.getAttribute('aria-label')).toBe(DICT.es['squadra.edit']);
    expect(pencil.querySelector('[data-icon="pencil"]')).not.toBeNull();
    expect(pencil.className).not.toMatch(/\bborder\b|\bring\b|shadow/);
    expect(pencil.className).toContain('text-neutral-400');
  });
});

describe('2) the card: identity, contact, no labels, no lines', () => {
  it('the name is large with the nickname between first name and surname; the trades come right below in the accent colour', async () => {
    await open(FULL);
    const name = q('worker-card-name');
    expect(name.textContent).toBe('Juan “El Flaco” Pérez Soto');
    expect(name.className).toContain('text-xl');
    expect(name.className).toContain('text-neutral-100');
    expect(dialog().contains(name)).toBe(true);
    const trades = q('worker-card-specialties');
    expect(trades.textContent).toBe('Electricista · Pintor');
    expect(trades.className).toContain('text-brand/90');
    expect(name.compareDocumentPosition(trades) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q('stars').dataset.rating).toBe('4');
  });
  it('contact and place: phone, email and "Address, City" in ONE line, with quiet icons instead of labels', async () => {
    await open(FULL);
    expect(q('worker-card-phone').textContent).toBe('+56 9 1234 5678');
    expect(q('worker-card-email').textContent).toBe('juan@obra.cl');
    expect(q('worker-card-place').textContent).toBe('Calle 5 #123, Rancagua');
    expect(q('worker-card-phone').querySelector('a').getAttribute('href')).toBe('tel:+56912345678');
    expect(q('worker-card-email').querySelector('a').getAttribute('href')).toBe('mailto:juan@obra.cl');
    for (const id of ['phone', 'email', 'place']) {
      const icon = q(`worker-card-${id}`).querySelector('[role="img"]');
      expect(icon.className).toContain('text-neutral-500');
      expect(icon.querySelector('svg')).not.toBeNull();
    }
    expect(q('worker-card-place').querySelector('[data-icon="map-pin"]')).not.toBeNull();
    // no text labels: the words "Teléfono", "Correo electrónico", "Dirección base" are not visible text (only aria-labels)
    const text = q('worker-card-contact').textContent;
    for (const k of ['squadra.phone', 'squadra.email', 'squadra.address', 'squadra.city']) expect(text).not.toContain(DICT.es[k]);
  });
  it('NOT A SINGLE LINE OR BOX: no border / ring / divide / shadow / hr / grey backgrounds anywhere in the card', async () => {
    await open(FULL);
    const all = [q('worker-card'), ...q('worker-card').querySelectorAll('*')];
    const offenders = all.filter((el) => /(^|\s)(border|ring|divide|shadow|outline)(-|\s|$)|bg-(neutral|white\/|gray|zinc)/.test(String(el.getAttribute('class') || '')) || el.tagName === 'HR');
    expect(offenders.map((e) => e.getAttribute('class'))).toEqual([]);
    expect(q('worker-card').className).toContain('space-y-6'); // the margins separate the sections
  });
  it('the personal line and the safety section keep the data that must not be lost, without a frame', async () => {
    await open(FULL);
    expect(q('worker-card-personal').textContent).toBe('12.345.678-9 · Chilena · Hombre · 1985-03-02');
    expect(q('worker-card-blood').textContent).toBe('O+');
    expect(q('worker-card-limiting').textContent).toContain('Rodilla izquierda');
    expect(q('worker-card-allergies').textContent).toContain('Penicilina');
    expect(q('worker-card-emergency').textContent).toContain('María · +56 9 8765 4321');
    expect(q('worker-card-safety').querySelector('h3').className).toContain('text-orange-300');
  });
  it('the financial history is the last thing of the card, flat', async () => {
    await open(FULL);
    const card = q('worker-card');
    expect(card.lastElementChild).toBe(q('worker-ledger'));
    expect(q('worker-ledger').className).not.toMatch(/border|rounded/);
  });
});

describe('3) empty fields disappear (no blanks, no "N/A")', () => {
  it('a worker with only a name and a phone: one contact line, nothing else', async () => {
    await open({ id: 'wk000002', name: 'Pepe', phone: '123456' });
    expect(q('worker-card-phone')).not.toBeNull();
    for (const id of ['email', 'place']) expect(q(`worker-card-${id}`)).toBeNull();
    for (const id of ['trade', 'specialties', 'personal', 'safety', 'blood']) expect(q(`worker-card-${id}`)).toBeNull();
    expect(q('stars')).toBeNull();
    expect(q('worker-card').textContent).not.toMatch(/N\/A|undefined|null|—\s*—/);
    expect(q('worker-card-name').textContent).toBe('Pepe');
    expect(q('worker-card-apodo')).toBeNull();
  });
  it('a worker with nothing but a name: the card is just the name and the ledger', async () => {
    await open({ id: 'wk000003', name: 'Solo' });
    expect(q('worker-card-contact')).toBeNull();
    expect([...q('worker-card').children].map((c) => c.getAttribute('data-testid'))).toEqual(['worker-ledger']);
    expect([...q('worker-card').querySelectorAll('p')].every((p) => p.textContent.trim() !== '')).toBe(true);
  });
  it('address without city and city without address: no orphan comma', async () => {
    await open({ id: 'wk000004', name: 'A', address: 'Calle 5' });
    expect(q('worker-card-place').textContent).toBe('Calle 5');
    await open({ id: 'wk000005', name: 'B', city: 'Talca' });
    expect(q('worker-card-place').textContent).toBe('Talca');
    await open({ id: 'wk000006', name: 'C', address: '  ', city: ' ' });
    expect(q('worker-card-place')).toBeNull();
    expect(q('worker-card-contact')).toBeNull();
  });
});

describe('4) the pencil, the form and cancel', () => {
  it('HARD TEST 2: the pencil reveals the form with every field hydrated', async () => {
    await open(FULL);
    await click(q('worker-edit'));
    expect(q('worker-form')).not.toBeNull();
    expect(q('worker-card')).toBeNull();
    expect(q('worker-name').value).toBe('Juan Pérez Soto');
    expect(q('worker-apodo').value).toBe('El Flaco');
    expect(q('worker-phone').value).toBe('+56 9 1234 5678');
    expect(q('worker-email').value).toBe('juan@obra.cl');
    expect(q('worker-city').value).toBe('Rancagua');
    expect(q('worker-address').value).toBe('Calle 5 #123');
    expect(q('worker-document').value).toBe('12.345.678-9');
    expect(q('worker-spec-electrician').getAttribute('aria-pressed')).toBe('true');
    expect(q('worker-spec-painter').getAttribute('aria-pressed')).toBe('true');
    expect(q('worker-spec-mason').getAttribute('aria-pressed')).toBe('false');
    expect(q('worker-rating').dataset.rating).toBe('4');
    expect(q('worker-sex-m').getAttribute('aria-checked')).toBe('true');
    expect(q('worker-blood-O+').getAttribute('aria-checked')).toBe('true');
    expect(q('worker-limiting').value).toBe('Rodilla izquierda');
    expect(q('worker-allergies').value).toBe('Penicilina');
    expect(q('worker-em-name').value).toBe('María');
    expect(q('worker-edit')).toBeNull(); // the pencil is a read-mode control
  });
  it('HARD TEST 3: cancelling an edit returns to the clean card and loses nothing (the typed changes are discarded)', async () => {
    await open(FULL);
    await click(q('worker-edit'));
    await typeInto(q('worker-name'), 'Otro Nombre');
    await typeInto(q('worker-email'), '');
    await typeInto(q('worker-city'), 'Santiago');
    await click(q('worker-spec-mason'));
    await click(q('worker-cancel'));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled(); // back to the card, the sheet stays
    expect(fields()).toHaveLength(0);
    expect(q('worker-card-name').textContent).toBe('Juan “El Flaco” Pérez Soto');
    expect(q('worker-card-email').textContent).toBe('juan@obra.cl');
    expect(q('worker-card-place').textContent).toBe('Calle 5 #123, Rancagua');
    expect(q('worker-card-specialties').textContent).toBe('Electricista · Pintor');
    // and editing again starts from the stored data, not from the discarded typing
    await click(q('worker-edit'));
    expect(q('worker-name').value).toBe('Juan Pérez Soto');
    expect(q('worker-email').value).toBe('juan@obra.cl');
    expect(q('worker-city').value).toBe('Rancagua');
    expect(q('worker-spec-mason').getAttribute('aria-pressed')).toBe('false');
  });
  it('saving from the form sends the edited data (email included) with the same id', async () => {
    await open(FULL);
    await click(q('worker-edit'));
    await typeInto(q('worker-email'), 'nuevo@obra.cl');
    await act(async () => q('worker-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'wk000001', email: 'nuevo@obra.cl', name: 'Juan Pérez Soto' });
  });
  it('a NEW worker opens straight in edit mode (no pencil, no card) and its cancel closes the sheet', async () => {
    await open(null);
    expect(q('worker-form')).not.toBeNull();
    expect(q('worker-card')).toBeNull();
    expect(q('worker-edit')).toBeNull();
    expect(q('worker-name').value).toBe('');
    await click(q('worker-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('a failed unknown shape never breaks the card (legacy worker without arrays)', async () => {
    await open({ id: 'wk000007', name: 'Viejo' });
    expect(q('worker-card')).not.toBeNull();
    await open({ id: 'wk000008', name: 'Viejo 2', specialties: undefined, phone: null, email: undefined });
    expect(q('worker-card')).not.toBeNull();
  });
});

describe('5) the email is part of the file', () => {
  it('normalizeWorker keeps a clean email (trimmed, max 80, `correo` alias) and old files get ""', () => {
    expect(normalizeWorker({ name: 'A', email: '  a@b.cl ' }).email).toBe('a@b.cl');
    expect(normalizeWorker({ name: 'A', correo: 'x@y.cl' }).email).toBe('x@y.cl');
    expect(normalizeWorker({ name: 'A', email: 'x'.repeat(200) }).email).toHaveLength(80);
    expect(normalizeWorker({ name: 'A', email: '<script>' }).email).not.toMatch(/[<>]/);
    expect(normalizeWorker({ name: 'A' }).email).toBe('');
  });
  it('every language names the pencil and the email', () => {
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) for (const k of ['squadra.edit', 'squadra.email']) expect(DICT[l][k], `${l} ${k}`).toBeTruthy();
  });
});
