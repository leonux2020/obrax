// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import React, { act } from 'react';
import path from 'node:path';
import { normalizeLogo } from '../src/lib/logo.js';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/lib/i18n.jsx';
import SignatureField from '../src/components/SignatureField.jsx';
import { default as StepReportModule } from '../src/components/steps/StepReport.jsx';
import { newDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { buildClientModel } from '../src/lib/reports.js';
import { makeI18n } from '../src/lib/i18n.jsx';
import { buildSignature } from '../src/lib/signature.js';
import { DICT } from '../src/lib/dict.js';
import { LANGS } from '../src/lib/regions.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const NOW = 1_700_000_000_000;
const read = (rel) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');

function setup({ signed = false, stale = false, company } = {}) {
  const d = newDraft('CL');
  d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
  const result = computeAll(d, NOW);
  const total = result.quote.total;
  const signature = signed ? buildSignature({ ink: { dataUrl: PNG, w: 120, h: 40 }, name: 'Ana Ruiz', taxId: '11.111.111-1', total: stale ? total + 1000 : total, now: NOW }) : null;
  const i = makeI18n('es', 'CL');
  const co = company ?? { name: 'Obra SA', taxId: '76.123.456-7', phone: '', email: '', city: '', logo: PNG };
  const model = buildClientModel({ draft: { ...d, signature }, result, company: co, region: i.region, t: i.t, num: i.num, unit: i.unit, date: i.date });
  return { model, signature, total, i };
}

let host;
let root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const mount = (props, lang = 'es') =>
  act(() => {
    root.render(React.createElement(I18nProvider, { lang, regionCode: 'CL' }, React.createElement(SignatureField, { onChange: () => {}, pricedAt: NOW, ...props })));
  });
const box = () => host.querySelector('[data-testid="signature-box"]');
const sheet = () => document.querySelector('[role="dialog"]');

describe('client signature box: the box itself is the trigger', () => {
  it('empty state: only a subtle bordered box with a faint hint, and no button to sign', () => {
    const { model, total } = setup();
    mount({ model, signature: null, total });
    expect(box().className).toContain('border-white/10');
    expect(host.querySelector('[data-testid="signature-hint"]').textContent).toBe('Doble toque para firmar');
    expect(host.querySelector('[data-testid="signature-hint"]').className).toContain('text-white/30');
    expect(host.querySelectorAll('button')).toHaveLength(0);
    expect(sheet()).toBeNull();
  });

  it('a single click does not open anything; a double click opens the full-screen canvas with name and ID', () => {
    const { model, total } = setup();
    mount({ model, signature: null, total });
    act(() => box().dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(sheet()).toBeNull();
    act(() => box().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    const dialog = sheet();
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector('canvas')).not.toBeNull();
    expect(dialog.textContent).toContain('Nombre del Cliente');
    expect(dialog.textContent).toContain('ID:');
    expect(dialog.className).toContain('h-[100dvh]'); // full screen
    expect(dialog.className).toContain('border-white/10');
    expect(dialog.querySelector('[data-testid="signature-remove"]')).toBeNull(); // nothing to remove yet
  });

  it('two quick touch taps open it, two slow taps or two far taps do not', () => {
    const { model, total } = setup();
    mount({ model, signature: null, total });
    const tap = (x, y, timeStamp) => {
      const e = new Event('pointerup', { bubbles: true });
      Object.assign(e, { pointerType: 'touch', clientX: x, clientY: y });
      Object.defineProperty(e, 'timeStamp', { value: timeStamp });
      act(() => box().dispatchEvent(e));
    };
    tap(10, 10, 1000);
    tap(10, 10, 1900); // too slow
    expect(sheet()).toBeNull();
    tap(10, 10, 3000);
    tap(200, 80, 3100); // too far apart
    expect(sheet()).toBeNull();
    tap(50, 50, 5000);
    tap(55, 52, 5200);
    expect(sheet()).not.toBeNull();
  });

  it('keyboard users can open it with Enter', () => {
    const { model, total } = setup();
    mount({ model, signature: null, total });
    expect(box().getAttribute('tabindex')).toBe('0');
    act(() => box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(sheet()).not.toBeNull();
  });

  it('signed: shows the ink and the client data; the sheet offers to remove the signature', () => {
    const { model, signature, total } = setup({ signed: true });
    let received;
    mount({ model, signature, total, onChange: (v) => { received = v; } });
    expect(host.querySelector('[data-testid="signature-preview"]')).not.toBeNull();
    expect(host.textContent).toContain('Ana Ruiz');
    expect(host.textContent).toContain('11.111.111-1');
    expect(host.querySelector('[data-testid="signature-hint"]')).toBeNull();
    act(() => box().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    const remove = sheet().querySelector('[data-testid="signature-remove"]');
    expect(remove).not.toBeNull();
    act(() => remove.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(received).toBeNull();
    expect(sheet()).toBeNull();
  });

  it('stale signature: faint on screen, with a notice, and not on the model (so not in the PDF)', () => {
    const { model, signature, total } = setup({ signed: true, stale: true });
    expect(model.signature).toBeNull();
    mount({ model, signature, total });
    expect(host.querySelector('[data-testid="signature-stale"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="signature-preview"]').className).toContain('opacity-30');
  });

  it('hint exists in all six languages and the old button strings are gone', () => {
    for (const l of LANGS) {
      expect(DICT[l]['sign.hint'], l).toBeTruthy();
      expect(DICT[l]['sign.cta']).toBeUndefined();
    }
    expect(DICT.es['sign.hint']).toBe('Doble toque para firmar');
    const { model, total } = setup();
    for (const l of LANGS) {
      const html = renderToStaticMarkup(React.createElement(I18nProvider, { lang: l, regionCode: 'CL' }, React.createElement(SignatureField, { model, signature: null, total, pricedAt: NOW, onChange: () => {} })));
      expect(html).toContain(DICT[l]['sign.hint']);
    }
  });
});

describe('contractor data is read-only and comes from the company profile', () => {
  it('the model carries logo, name and tax ID of the profile snapshot', () => {
    const { model } = setup();
    expect(model.company.logo).toBe(PNG);
    expect(model.company.name).toBe('Obra SA');
    expect(model.signCompanyData).toEqual(['Obra SA', expect.stringContaining('76.123.456-7')]);
    expect(setup({ company: { name: '', taxId: '', logo: '' } }).model.company.empty).toBe(true);
    expect(setup({ company: { name: '', taxId: '', logo: PNG } }).model.company.empty).toBe(false);
    expect(normalizeLogo('javascript:alert(1)')).toBe(''); // the stored snapshot only ever holds validated image data URLs
  });

  it('the on-screen contractor block has no buttons, links or handlers', () => {
    const src = read('components/steps/StepReport.jsx');
    const start = src.indexOf('function CompanyBlock');
    const block = src.slice(start, src.indexOf('function Heading'));
    expect(block).not.toMatch(/<(button|Button|a\b|input|select)/);
    expect(block).not.toMatch(/\bon[A-Z][A-Za-z]+=/);
    expect(block).toContain('company-block');
    const contractor = src.slice(src.indexOf('data-testid="contractor-sign"') - 40, src.indexOf('<SignatureField'));
    expect(contractor).not.toMatch(/<(button|Button|a\b|input)|\bon[A-Z][A-Za-z]+=/);
    // nothing in the summary can edit the company any more
    expect(src).not.toContain('onEditCompany');
    expect(src).not.toContain('company.configure');
  });

  it('the PDF uses the company logo first and the brand icon only as a fallback', () => {
    const src = read('lib/reportPdf.js');
    expect(src).toMatch(/rasterizeLogo\(company\.logo\)[\s\S]{0,160}brandLogo\(\)/);
    expect(typeof StepReportModule).toBe('function');
  });
});
