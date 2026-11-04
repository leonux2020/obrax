// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import React, { act } from 'react';
import path from 'node:path';
import { normalizeLogo } from '../src/lib/logo.js';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/lib/i18n.jsx';
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

  it('the PDF uses the company logo first and the brand icon only as a fallback', () => {
    const src = read('lib/reportPdf.js');
    expect(src).toMatch(/rasterizeLogo\(company\.logo\)[\s\S]{0,160}brandLogo\(\)/);
  });
});
