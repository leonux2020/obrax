// @vitest-environment happy-dom
// Ajustes > Empresa y profesional: the dual read/edit card, the signature canvas moved out of Google Sync, and the hard audit
// (no page scroll while drawing, a bounded signature that fits localStorage, Cancel never loses the previous signature).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProfileCard from '../src/components/ProfileCard.jsx';
import { EMPTY_COMPANY, companyEntity, normalizeCompany, professionalEntity, proFullName } from '../src/lib/draft.js';
import { SIGNATURE_LIMITS, exportSignature, normalizeInk } from '../src/lib/signature.js';
import { companyInfo } from '../src/lib/reports.js';
import { DICT } from '../src/lib/dict.js';
import { makeI18n } from '../src/lib/i18n.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const NEW_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SIG = { dataUrl: PNG, w: 120, h: 40 };
const COMPANY = { name: 'Aurora SpA', taxId: '76.123.456-7', address: 'Av. Providencia 123', city: 'Santiago', email: 'obra@aurora.cl', phone: '', proName: 'Ana', proLastName: 'Ruiz', proTitle: 'Ingeniera civil', proLicense: 'CIP 4521', signature: SIG };

const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 5)); });
const typeInto = (id, value) =>
  act(() => {
    const input = q(id);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

let host;
let root;
let saved;

const fakeCanvas = (onDataUrl = () => NEW_PNG) => {
  const ctx = new Proxy({}, { get: (_, k) => (k === 'canvas' ? {} : () => {}), set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function () {
    return onDataUrl(this);
  });
};
const draw = (canvas, points = [[10, 10], [60, 40], [120, 20]]) => {
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 150 });
  const ev = (type, x, y) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { clientX: x, clientY: y, pointerType: 'touch', pointerId: 1, button: 0 });
    act(() => canvas.dispatchEvent(e));
    return e;
  };
  const events = [ev('pointerdown', ...points[0])];
  for (const [x, y] of points.slice(1)) events.push(ev('pointermove', x, y));
  events.push(ev('pointerup', ...points[points.length - 1]));
  return events;
};

const mount = (company = COMPANY, logo = '') => {
  saved = [];
  act(() =>
    root.render(
      React.createElement(
        I18nProvider,
        { lang: 'es', regionCode: 'CL' },
        React.createElement(ProfileCard, { company, logo, onSave: async (data) => void saved.push(data) })
      )
    )
  );
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('data model: two logical entities over one stored record', () => {
  it('company = name, tax ID, address, email; professional = name, surname, title, licence and the Base64 signature', () => {
    const c = normalizeCompany(COMPANY);
    expect(companyEntity(c)).toMatchObject({ name: 'Aurora SpA', taxId: '76.123.456-7', address: 'Av. Providencia 123', email: 'obra@aurora.cl' });
    expect(professionalEntity(c)).toMatchObject({ name: 'Ana', lastName: 'Ruiz', title: 'Ingeniera civil', license: 'CIP 4521', signature: PNG });
    expect(typeof professionalEntity(c).signature).toBe('string');
    expect(proFullName(c)).toBe('Ana Ruiz');
  });

  it('a legacy record (full name in proName, no new fields) still loads and prints the same name', () => {
    const c = normalizeCompany({ name: 'Aurora', proName: 'Ana Ruiz Soto', signature: SIG });
    expect(c).toMatchObject({ address: '', proLastName: '', proTitle: '', proLicense: '', proName: 'Ana Ruiz Soto' });
    expect(proFullName(c)).toBe('Ana Ruiz Soto');
    expect(Object.keys(c).sort()).toEqual(Object.keys(EMPTY_COMPANY).sort());
    expect(normalizeCompany(null)).toEqual(EMPTY_COMPANY);
  });

  it('free text is sanitized and bounded', () => {
    const c = normalizeCompany({ address: '<b>Calle</b> ' + 'x'.repeat(300), proTitle: '<i>Ing</i>', proLicense: 'a'.repeat(200), proLastName: '<u>Ruiz</u>' });
    expect(c.address.length).toBeLessThanOrEqual(100);
    expect(c.proLicense.length).toBeLessThanOrEqual(40);
    for (const k of ['address', 'proTitle', 'proLastName']) expect(c[k]).not.toMatch(/[<>]/);
  });

  it('the documents carry the full name, the title / licence line and the address', () => {
    const { t, region } = makeI18n('es', 'CL');
    const info = companyInfo({ ...COMPANY, proTaxId: '12.345.678-5' }, region, t);
    expect(info.signer).toBe('Ana Ruiz');
    expect(info.signerLine).toBe('Ingeniera civil · CIP 4521 · RUT: 12.345.678-5');
    expect(info.details).toContain('Av. Providencia 123, Santiago');
  });
});

describe('read mode: two blocks, no lines, the signature in white at the end', () => {
  it('company block on top (large type), professional block below, signature last and inverted for the OLED ground', () => {
    mount(COMPANY, 'data:image/png;base64,AAAA');
    const card = q('settings-profile-card');
    const company = q('settings-profile-company');
    const pro = q('settings-profile-professional');
    expect(company.compareDocumentPosition(pro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q('settings-profile-name').className).toContain('text-2xl');
    expect(q('settings-profile-name').textContent).toBe('Aurora SpA');
    expect(q('settings-profile-tax').textContent).toBe('RUT 76.123.456-7');
    expect(q('settings-profile-address').textContent).toBe('Av. Providencia 123, Santiago');
    expect(q('settings-profile-pro').textContent).toBe('Ana Ruiz');
    expect(q('settings-profile-title').textContent).toBe('Ingeniera civil');
    expect(q('settings-profile-license').textContent).toBe('CIP 4521');
    const img = q('settings-profile-signature');
    expect(img.getAttribute('src')).toBe(PNG);
    expect(img.className).toContain('invert'); // black ink on transparent -> pure white on black
    expect(pro.lastElementChild.contains(img)).toBe(true); // the last thing of the card
    expect(card.contains(company) && card.contains(pro)).toBe(true);
    // no lines: no rules, no borders, no dividers inside the card (separation = margins and type hierarchy only)
    expect(card.querySelector('hr')).toBeNull();
    for (const el of [card, ...card.querySelectorAll('*')]) expect(String(el.getAttribute('class') || ''), el.tagName).not.toMatch(/\bborder|divide-|\bring\b/);
    expect(card.querySelector('input, textarea, select, canvas')).toBeNull();
  });

  it('empty fields vanish: no professional block and no signature when none is filled in', () => {
    mount({ name: 'Aurora' });
    expect(q('settings-profile-professional')).toBeNull();
    expect(q('settings-profile-signature')).toBeNull();
    expect(q('settings-profile-tax')).toBeNull();
  });

  it('ONE pencil at the top right opens ONE fluid form with both blocks; the pencil is gone while editing', async () => {
    mount();
    expect(host.querySelectorAll('[data-testid="settings-profile-edit"]')).toHaveLength(1);
    expect(q('settings-profile-edit').parentElement.className).toMatch(/right-1/);
    await click(q('settings-profile-edit'));
    expect(q('settings-profile-card')).toBeNull();
    expect(q('settings-profile-edit')).toBeNull();
    expect(host.querySelectorAll('form')).toHaveLength(1);
    expect(q('settings-form-company')).not.toBeNull();
    expect(q('settings-form-professional')).not.toBeNull();
    for (const id of ['settings-company-name', 'settings-company-tax', 'settings-company-address', 'settings-company-email', 'settings-pro-name', 'settings-pro-lastname', 'settings-pro-title', 'settings-pro-license'])
      expect(q(id), id).not.toBeNull();
    expect(q('settings-pro-lastname').value).toBe('Ruiz');
  });
});

describe('HARD AUDIT 1: the touch canvas never scrolls the page while drawing', () => {
  it('the canvas is touch-action:none and cancels touchstart / touchmove / pointer events', async () => {
    mount();
    await click(q('settings-profile-edit'));
    const canvas = q('signature-canvas');
    expect(canvas.className).toContain('touch-none');
    for (const type of ['touchstart', 'touchmove']) {
      const e = new Event(type, { bubbles: true, cancelable: true });
      act(() => canvas.dispatchEvent(e));
      expect(e.defaultPrevented, type).toBe(true);
    }
    const events = draw(canvas);
    expect(events[0].defaultPrevented).toBe(true); // pointerdown
    expect(events[1].defaultPrevented).toBe(true); // pointermove while the finger is down
  });
});

describe('HARD AUDIT 2: the signature stays small enough for localStorage', () => {
  const strokes = (w, h) => [[{ x: 0, y: 0 }, { x: w / 2, y: h }, { x: w, y: 0 }]];

  it('the exported PNG is capped at 480 x 220 px however large the drawing is (a pad is at most ~770 px wide)', () => {
    const seen = [];
    fakeCanvas((c) => (seen.push([c.width, c.height]), NEW_PNG));
    for (const [w, h] of [[1400, 600], [100, 40], [1000, 50]]) {
      const out = exportSignature(strokes(w, h));
      expect(out.w).toBeLessThanOrEqual(SIGNATURE_LIMITS.maxWidth);
      expect(out.h).toBeLessThanOrEqual(SIGNATURE_LIMITS.maxHeight);
    }
    for (const [w, h] of seen) {
      expect(w).toBeLessThanOrEqual(480);
      expect(h).toBeLessThanOrEqual(220);
    }
  });

  it('a heavy scribble is re-rendered at a smaller scale until it fits the character budget; a hopeless one is refused', () => {
    const heavy = 'data:image/png;base64,' + 'A'.repeat(SIGNATURE_LIMITS.maxChars + 10);
    let calls = 0;
    fakeCanvas(() => (++calls < 3 ? heavy : NEW_PNG));
    const out = exportSignature(strokes(400, 200));
    expect(calls).toBe(3);
    expect(out.dataUrl.length).toBeLessThanOrEqual(SIGNATURE_LIMITS.maxChars);
    vi.restoreAllMocks();
    fakeCanvas(() => heavy);
    expect(() => exportSignature(strokes(400, 200))).toThrow(/signature:store/);
  });

  it('what is stored is validated again: an oversized or non-PNG signature is dropped, and a maximal profile is a tiny part of the quota', () => {
    const big = { dataUrl: 'data:image/png;base64,' + 'A'.repeat(SIGNATURE_LIMITS.maxChars), w: 400, h: 100 };
    expect(normalizeInk(big)).toBeNull();
    expect(normalizeInk({ dataUrl: 'data:image/svg+xml;base64,AAAA', w: 10, h: 10 })).toBeNull();
    expect(normalizeCompany({ ...COMPANY, signature: big }).signature).toBeNull();
    const max = { dataUrl: 'data:image/png;base64,' + 'A'.repeat(SIGNATURE_LIMITS.maxChars - 30), w: 480, h: 220 };
    const json = JSON.stringify(normalizeCompany({ ...COMPANY, signature: max }));
    expect(json.length).toBeLessThan(70_000); // ~1.4 % of a 5 MB localStorage
  });

  it('the on-screen bitmap is bounded too (device pixel ratio capped at 3)', () => {
    expect(readFileSync('src/components/SignaturePad.jsx', 'utf8')).toMatch(/Math\.min\(3, window\.devicePixelRatio/);
  });
});

describe('HARD AUDIT 3: Cancel restores the previous signature; nothing is lost by accident', () => {
  it('the stored signature shows on the pad; Clear + Cancel leaves the stored signature and writes nothing', async () => {
    mount();
    await click(q('settings-profile-edit'));
    expect(q('pro-signature-current').getAttribute('src')).toBe(PNG);
    expect(q('pro-signature-clear').className).toContain('text-neutral-400');
    await click(q('pro-signature-clear'));
    expect(q('pro-signature-current')).toBeNull();
    await click(q('settings-profile-cancel'));
    expect(saved).toHaveLength(0);
    expect(q('settings-profile-signature').getAttribute('src')).toBe(PNG); // restored
    await click(q('settings-profile-edit'));
    expect(q('pro-signature-current').getAttribute('src')).toBe(PNG); // and the next edit starts from it again
  });

  it('drawing a new signature and cancelling keeps the old one', async () => {
    fakeCanvas();
    mount();
    await click(q('settings-profile-edit'));
    draw(q('signature-canvas'));
    expect(q('pro-signature-current')).toBeNull(); // the new ink replaces the preview on screen only
    await click(q('settings-profile-cancel'));
    expect(saved).toHaveLength(0);
    expect(q('settings-profile-signature').getAttribute('src')).toBe(PNG);
  });

  it('Save with an untouched pad keeps the stored signature exactly (editing text never wipes the ink)', async () => {
    mount();
    await click(q('settings-profile-edit'));
    await typeInto('settings-pro-title', 'Arquitecta');
    await click(q('settings-profile-save'));
    expect(saved).toHaveLength(1);
    expect(saved[0].signature).toEqual(SIG);
    expect(saved[0].proTitle).toBe('Arquitecta');
    expect(q('settings-profile-title').textContent).toBe('Arquitecta'); // refreshed read card
  });

  it('Clear + Save removes it on purpose; draw + Save stores the new transparent PNG', async () => {
    mount();
    await click(q('settings-profile-edit'));
    await click(q('pro-signature-clear'));
    await click(q('settings-profile-save'));
    expect(saved[0].signature).toBeNull();
    expect(q('settings-profile-signature')).toBeNull();

    fakeCanvas();
    await click(q('settings-profile-edit'));
    expect(q('pro-signature-current')).toBeNull();
    draw(q('signature-canvas'));
    await click(q('settings-profile-save'));
    expect(saved[1].signature).toMatchObject({ dataUrl: NEW_PNG });
    expect(saved[1].signature.w).toBeLessThanOrEqual(480);
    expect(q('settings-profile-signature').getAttribute('src')).toBe(NEW_PNG);
  });

  it('a signature that cannot be exported keeps the form open with an error and the old signature intact', async () => {
    mount(); // happy-dom has no 2D context: exportSignature throws signature:store
    await click(q('settings-profile-edit'));
    const ctx = new Proxy({}, { get: (_, k) => (k === 'canvas' ? {} : () => {}), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
    draw(q('signature-canvas'));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    await click(q('settings-profile-save'));
    expect(q('settings-profile-error')).not.toBeNull();
    expect(saved).toHaveLength(0);
    expect(q('settings-profile-form')).not.toBeNull();
  });
});

describe('the signature is gone from Google Sync', () => {
  it('SettingsView has no signature logic at all', () => {
    const view = readFileSync('src/components/SettingsView.jsx', 'utf8');
    expect(view).not.toMatch(/signature|Signature|signing|settings\.sign/);
    expect(view).toMatch(/<ProfileCard/);
  });

  it('the new copy exists in the six languages and the obsolete "settings.sign" is removed', () => {
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) {
      for (const k of ['profile.address', 'profile.address.ph', 'profile.pro.firstName', 'profile.pro.lastName', 'profile.pro.title', 'profile.pro.license', 'profile.sign.label', 'profile.sign.clear', 'profile.err.save'])
        expect(DICT[l][k], `${l}:${k}`).toBeTruthy();
      expect(DICT[l]['settings.sign'], l).toBeUndefined();
    }
  });
});
