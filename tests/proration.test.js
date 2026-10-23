import { describe, it, expect } from 'vitest';
import { newDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { buildClientModel, buildTechModel, clientBreakdownRows, clientSummaryText } from '../src/lib/reports.js';
import { renderClientPdf, renderTechPdf, pdfMoneyFormatter, pdfSafe } from '../src/lib/pdf.js';
import { createReportPdf } from '../src/lib/reportPdf.js';
import { makeI18n } from '../src/lib/i18n.jsx';
import { documentCompany, newProject } from '../src/lib/projects.js';
import { DICT } from '../src/lib/dict.js';
import { LANGS } from '../src/lib/regions.js';

const NOW = 1_700_000_000_000;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const raw = (pdf) => Buffer.from(pdf.output('arraybuffer')).toString('latin1');

function setup({ region = 'CL', lang = 'es', contingency = 0, profit = 0, transport, showBreakdown = true, company = { name: 'Obra SA', taxId: '', phone: '', email: '', city: '' } } = {}) {
  const d = { ...newDraft(region), showBreakdown };
  d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
  d.finance = { ...d.finance, contingency, profit, ...(transport === undefined ? {} : { transport }) };
  const result = computeAll(d, NOW);
  const i = makeI18n(lang, region);
  const base = { draft: d, result, company, region: i.region, t: i.t, num: i.num, unit: i.unit, date: i.date };
  return { d, result, i, base, money: pdfMoneyFormatter(i.region, i.locale) };
}

const close = (a, b, region) => expect(Math.abs(a - b)).toBeLessThan(10 ** -(region.digits ?? 0) / 2 + 1e-9);

describe('client PDF: Imprevistos + Utilidad are prorated into Materials and Labor', () => {
  const combos = [[0, 0], [5, 0], [0, 15], [10, 20], [7, 13], [30, 100]];
  for (const region of ['CL', 'US', 'MX', 'AR']) {
    for (const [c, p] of combos) {
      it(`${region} contingency ${c}% profit ${p}%: rows add up to the subtotal and subtotal + tax = total`, () => {
        const { base, result } = setup({ region, contingency: c, profit: p });
        const q = result.quote;
        const m = buildClientModel(base);
        const sum = m.breakdown.rows.reduce((s, r) => s + r.amount, 0);
        close(sum, q.subtotal, base.region);
        close(m.subtotal + m.tax, m.total, base.region);
        expect(m.breakdown.rows.every((r) => r.amount >= 0)).toBe(true);
        // transport and machinery keep their real amounts; only materials + labor absorb the overhead
        const mats = m.breakdown.rows[0].amount;
        const labor = m.breakdown.rows[1].amount;
        close(mats + labor, q.materials + q.labor + q.contingency + q.profit, base.region);
        if (c + p > 0) expect(mats).toBeGreaterThan(q.materials);
        else expect(mats).toBe(q.materials);
        // the chapters already carry the overhead and add up to the subtotal too
        close(m.chapters.reduce((s, ch) => s + ch.amount, 0), q.subtotal, base.region);
      });
    }
  }

  it('materials / labor keep their relative proportion (overhead split by weight)', () => {
    const { result } = setup({ contingency: 10, profit: 20 });
    const q = result.quote;
    const [mat, lab] = clientBreakdownRows(q, getRegionFor('CL'));
    expect(mat.amount / lab.amount).toBeCloseTo(q.materials / q.labor, 1);
  });

  it('edge: no labor and no materials still balances (everything goes to materials)', () => {
    const region = getRegionFor('CL');
    const q = { materials: 0, labor: 0, transport: 0, machinery: 0, subtotal: 100, tax: 19, total: 119 };
    const rows = clientBreakdownRows(q, region);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(100);
  });

  it('transport row is still omitted at 0 and the rows still add up', () => {
    const { base, result } = setup({ contingency: 10, profit: 10, transport: 0 });
    const m = buildClientModel(base);
    expect(m.breakdown.rows.map((r) => r.label)).not.toContain(base.t('bd.transport'));
    close(m.breakdown.rows.reduce((s, r) => s + r.amount, 0), result.quote.subtotal, base.region);
  });

  it('never exposes "Utilidad" / "Imprevistos" (any language) in the client model, summary text or PDF', async () => {
    for (const lang of LANGS.map((l) => l.code ?? l)) {
      const { base, money, i } = setup({ lang, contingency: 10, profit: 20 });
      const m = buildClientModel(base);
      const banned = ['fin.contingency', 'fin.profit', 'bd.overhead'].map((k) => DICT[lang]?.[k]).filter(Boolean);
      const json = JSON.stringify(m);
      const text = clientSummaryText(m, money, 'CUBRAX');
      const pdf = raw(await renderClientPdf(m, { money }));
      for (const word of banned) for (const hay of [json, text, pdf]) expect(hay.toLowerCase()).not.toContain(pdfSafe(word).toLowerCase());
      expect(i.t('bd.overhead')).not.toBe(''); // (defensive: dictionary access keeps working)
    }
    for (const w of ['Utilidad', 'Imprevistos', 'Gastos generales']) {
      const { base, money } = setup({ contingency: 10, profit: 20 });
      const pdf = raw(await renderClientPdf(buildClientModel(base), { money }));
      expect(pdf).not.toContain(w);
    }
  });
});

describe('technical report is unchanged: real, transparent margins', () => {
  it('shows contingency and profit separately and the technical PDF names them', async () => {
    const { base, result, money, i } = setup({ contingency: 10, profit: 20 });
    const tech = buildTechModel({ ...base, money });
    expect(tech.costs.contingency).toBe(result.quote.contingency);
    expect(tech.costs.profit).toBe(result.quote.profit);
    expect(tech.costs.contingency).toBeGreaterThan(0);
    expect(tech.costs.profit).toBeGreaterThan(0);
    const pdf = raw(await renderTechPdf(tech, { money, t: i.t, num: i.num, photos: [] }));
    expect(pdf).toContain(pdfSafe(i.t('fin.contingency')));
    expect(pdf).toContain(pdfSafe(i.t('fin.profit')));
  });
});

describe('contractor signature follows the profile', () => {
  const sigA = { dataUrl: PNG, w: 120, h: 40 };
  const sigB = { dataUrl: PNG.replace('AAAAA', 'BBBBB'), w: 90, h: 30 };

  it('documentCompany: profile signature wins; snapshot one is the fallback; no signature stays null', () => {
    const snap = { name: 'Aurora', signature: sigA };
    expect(documentCompany(snap, { signature: sigB }).signature).toEqual(sigB);
    expect(documentCompany(snap, { signature: null }).signature).toEqual(sigA);
    expect(documentCompany({ name: 'Aurora', signature: null }, { signature: sigB }).signature).toEqual(sigB);
    expect(documentCompany({ name: 'Aurora', signature: null }, { signature: null }).signature).toBeNull();
    expect(documentCompany(snap, { signature: sigA })).toBe(snap); // nothing to change: same object
    expect(documentCompany(snap, { signature: sigB }).name).toBe('Aurora');
  });

  it('a project created before the signature existed prints the profile signature in the preview model and in the PDF', async () => {
    const early = newProject({ regionCode: 'CL', company: { name: 'Aurora' } }); // snapshot without signature
    expect(early.company.signature).toBeNull();
    const company = documentCompany(early.company, { signature: sigA });
    const { base } = setup({ company });
    expect(buildClientModel(base).contractorSignature).toEqual(sigA);
    const withIt = await createReportPdf('client', { draft: base.draft, result: base.result, company, i18n: makeI18n('es', 'CL'), photos: [] });
    const without = await createReportPdf('client', { draft: base.draft, result: base.result, company: early.company, i18n: makeI18n('es', 'CL'), photos: [] });
    const images = (s) => (s.match(/\/Subtype \/Image/g) || []).length;
    expect(images(raw(withIt.doc))).toBeGreaterThan(images(raw(without.doc)));
  });
});

function getRegionFor(code) {
  return makeI18n('es', code).region;
}
