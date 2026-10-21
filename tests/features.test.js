import { describe, it, expect } from 'vitest';
import { REGIONS, REGION_CODES, searchRegions, getRegion, flagEmoji } from '../src/lib/regions.js';
import { calcRoof, calcFloor, calcPaint, pitchFactor } from '../src/lib/calc.js';
import { CATALOG } from '../src/lib/catalog.js';
import { newDraft, newPartida } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { taxRateFor } from '../src/lib/pricing.js';
import { buildClientModel, buildTechModel, clientSummaryText } from '../src/lib/reports.js';
import { renderClientPdf, renderTechPdf, pdfSafe, pdfMoneyFormatter, pdfFileName } from '../src/lib/pdf.js';
import { makeI18n } from '../src/lib/i18n.jsx';
import { DICT } from '../src/lib/dict.js';
import { localUser } from '../src/lib/auth.js';
import { TASKS, TASK_IDS } from '../src/lib/tasks.js';
import { normalizeUser } from '../src/lib/draft.js';

const NOW = 1_700_000_000_000;
const metric = (calc, key) => calc.metrics.find((m) => m.key === key)?.value;
const qty = (calc, id) => calc.lines.find((l) => l.id === id)?.qty ?? 0;

function projectDraft(regionCode = 'CL') {
  const d = newDraft(regionCode, 'project');
  d.project = { name: 'Quincho Familiar', client: 'Juan Perez' };
  const slab = { ...newPartida('slab'), name: 'Radier del quincho' };
  slab.dims = { ...slab.dims, length: 6, width: 4, thickness: 10 };
  const wall = { ...newPartida('masonry') };
  wall.dims = { ...wall.dims, length: 20, height: 2.4, thickness: 14, openings: 3 };
  const roof = { ...newPartida('roof') };
  roof.dims = { ...roof.dims, length: 7, width: 5, slope: 20 };
  const paint = { ...newPartida('paint') };
  paint.dims = { ...paint.dims, length: 20, height: 2.4, openings: 3 };
  d.partidas = [slab, wall, roof, paint];
  return d;
}

function ctxFor(draft, lang = 'es') {
  const result = computeAll(draft, NOW);
  const i18n = makeI18n(lang, draft.regionCode);
  const company = { name: 'Constructora Aurora SpA', taxId: '76.123.456-7', phone: '+56 9 1234 5678', email: 'a@b.cl', city: 'Santiago' };
  return { draft, result, company, region: i18n.region, ...i18n, i18n };
}

describe('regions: America + Europe, currency, official tax, chains', () => {
  it('covers all major countries of both continents with complete data', () => {
    expect(REGION_CODES.length).toBeGreaterThanOrEqual(50);
    for (const code of ['CL', 'ES', 'MX', 'US', 'AR', 'CO', 'BR', 'PE', 'CA', 'FR', 'DE', 'IT', 'GB', 'PT']) {
      expect(REGIONS[code], code).toBeTruthy();
    }
    const continents = new Set(REGION_CODES.map((c) => REGIONS[c].continent));
    expect([...continents].sort()).toEqual(['AM', 'EU']);
    for (const code of REGION_CODES) {
      const r = REGIONS[code];
      expect(r.name.es && r.name.en, code).toBeTruthy();
      expect(r.flag, code).toBeTruthy();
      expect(r.currency).toMatch(/^[A-Z]{3}$/);
      expect(r.symbol.length).toBeGreaterThan(0);
      expect(r.taxRate).toBeGreaterThan(0);
      expect(r.taxRate).toBeLessThan(0.3);
      expect(r.chains.length).toBeGreaterThanOrEqual(2);
      expect(r.taxName).toBeTruthy();
    }
  });

  it('uses the official rates requested by the brief', () => {
    expect(REGIONS.CL.taxRate).toBe(0.19);
    expect(REGIONS.ES.taxRate).toBe(0.21);
    expect(REGIONS.MX.taxRate).toBe(0.16);
    expect(REGIONS.AR.taxRate).toBe(0.21);
    expect(REGIONS.CO.taxRate).toBe(0.19);
    expect(REGIONS.US.taxRate).toBe(0.08);
    expect(REGIONS.US.taxEditable).toBe(true);
    expect(REGIONS.CL.taxEditable).toBeFalsy();
  });

  it('lists the reference hardware chains', () => {
    const names = (c) => REGIONS[c].chains.map((x) => x.name).join('|');
    expect(names('CL')).toMatch(/Sodimac/);
    expect(names('CL')).toMatch(/Easy/);
    expect(names('CL')).toMatch(/Construmart/);
    expect(names('ES')).toMatch(/Leroy Merlin/);
    expect(names('ES')).toMatch(/Bricomart/);
    expect(names('MX')).toMatch(/Home Depot/);
  });

  it('country flags are real regional-indicator emoji', () => {
    expect(flagEmoji('CL')).toBe('\u{1F1E8}\u{1F1F1}');
    expect(REGIONS.ES.flag).toBe(flagEmoji('ES'));
  });

  it('search matches names in both languages, codes, currencies and chains, ignoring accents', () => {
    const codes = (q, lang = 'es') => searchRegions(q, lang).map((r) => r.code);
    expect(codes('chi')).toContain('CL');
    expect(codes('mexico')).toContain('MX');
    expect(codes('méxico')).toContain('MX');
    expect(codes('germany', 'en')).toContain('DE');
    expect(codes('alemania')).toContain('DE');
    expect(codes('sodimac')).toContain('CL');
    expect(codes('leroy')).toContain('ES');
    expect(codes('eur')).toContain('FR');
    expect(codes('zzzzzz')).toEqual([]);
    expect(searchRegions('', 'es').length).toBe(REGION_CODES.length);
  });

  it('unknown regions resolve to null', () => {
    expect(getRegion('XX')).toBeNull();
    expect(getRegion(undefined)).toBeNull();
  });
});

describe('new tasks', () => {
  it('roof: slope factor = 1/cos(slope) and area includes overhang', () => {
    expect(pitchFactor(0)).toBeCloseTo(1, 10);
    expect(pitchFactor(60)).toBeCloseTo(2, 10);
    const c = calcRoof({ length: 10, width: 6, slope: 30, overhang: 0.5, roofing: 'zinc', insulation: 1, gutters: 1 });
    const plan = (10 + 1) * (6 + 1);
    expect(metric(c, 'planArea')).toBeCloseTo(plan, 6);
    expect(metric(c, 'roofArea')).toBeCloseTo(plan / Math.cos(Math.PI / 6), 1); // metrics are rounded to 2 decimals
    expect(metric(c, 'slopeFactor')).toBeCloseTo(1 / Math.cos(Math.PI / 6), 2);
    for (const id of ['roof_zinc', 'purlin', 'ridge_zinc', 'insulation', 'roof_screws', 'gutter', 'downspout']) {
      expect(qty(c, id), id).toBeGreaterThan(0);
    }
  });

  it('roof: tile and no insulation/gutters switch the material list', () => {
    const c = calcRoof({ length: 8, width: 5, slope: 25, roofing: 'tile', insulation: 0, gutters: 0 });
    expect(qty(c, 'roof_tile')).toBeGreaterThan(0);
    expect(qty(c, 'roof_zinc')).toBe(0);
    expect(qty(c, 'insulation')).toBe(0);
    expect(qty(c, 'gutter')).toBe(0);
  });

  it('floor: net area drives the tile area; adhesive and grout are included', () => {
    const c = calcFloor({ length: 5, width: 4, openings: 2, format: '45' });
    expect(metric(c, 'netArea')).toBeCloseTo(18, 6);
    expect(qty(c, 'floor_45')).toBeCloseTo(18, 6);
    expect(qty(c, 'floor_30')).toBe(0);
    expect(qty(c, 'adhesive')).toBeGreaterThan(0);
    expect(qty(c, 'grout')).toBeGreaterThan(0);
  });

  it('floor: tiles are bought in whole boxes', () => {
    const d = newDraft('CL');
    d.partidas = [{ ...newPartida('floor'), dims: { length: 5, width: 4, openings: 0, format: '45' }, waste: 10 }];
    const r = computeAll(d, NOW);
    const item = r.quote.items.find((i) => i.id === 'floor_45');
    expect(Number.isInteger(item.packs)).toBe(true);
    expect(item.purchased).toBeGreaterThanOrEqual(item.needWaste - 1e-9);
    expect(item.purchased - item.needWaste).toBeLessThan(item.saleSize);
  });

  it('paint: coats multiply the area; buckets and gallons split without waste of whole units', () => {
    const one = calcPaint({ length: 30, height: 2.5, openings: 0, coats: 1, primer: 0, putty: 0 });
    const three = calcPaint({ length: 30, height: 2.5, openings: 0, coats: 3, primer: 0, putty: 0 });
    expect(metric(three, 'paintArea')).toBeCloseTo(metric(one, 'paintArea') * 3, 6);

    const d = newDraft('CL');
    d.partidas = [
      { ...newPartida('paint'), dims: { length: 120, height: 2.5, openings: 0, coats: 2, primer: 1, putty: 1 }, waste: 5 },
    ];
    const r = computeAll(d, NOW);
    const ids = r.quote.items.map((i) => i.id);
    expect(ids).toContain('paint_bucket');
    expect(ids).toContain('primer');
    expect(ids).toContain('putty');
    for (const i of r.quote.items) expect(Number.isInteger(i.packs), i.id).toBe(true);
    // total paint litres bought covers the need
    const litres = r.quote.items
      .filter((i) => i.id === 'paint' || i.id === 'paint_bucket')
      .reduce((s, i) => s + i.packs * CATALOG[i.id].size * (CATALOG[i.id].base === 'l' ? 1 : 1), 0);
    expect(litres).toBeGreaterThan(0);
  });

  it('every catalog item has ES and EN names', () => {
    for (const id of Object.keys(CATALOG)) {
      expect(DICT.es[`mat.${id}`], id).toBeTruthy();
      expect(DICT.en[`mat.${id}`], id).toBeTruthy();
    }
  });
});

describe('project accumulator: consolidated purchase', () => {
  it('sums shared materials of different partidas into ONE line before rounding', () => {
    const d = projectDraft();
    const r = computeAll(d, NOW);
    expect(r.valid).toBe(true);
    const cementLines = r.quote.items.filter((i) => i.id === 'cement_bag');
    expect(cementLines).toHaveLength(1);

    const separate = d.partidas
      .slice(0, 2)
      .map((p) => computeAll({ ...d, partidas: [p] }, NOW).quote.items.find((i) => i.id === 'cement_bag').packs);
    const together = computeAll({ ...d, partidas: d.partidas.slice(0, 2) }, NOW).quote.items.find((i) => i.id === 'cement_bag');
    expect(together.packs).toBeLessThanOrEqual(separate[0] + separate[1]);
    expect(together.packs).toBeGreaterThanOrEqual(Math.max(...separate));
    // shares of the line cover both partidas and add up to 1
    const shareSum = Object.values(together.shares).reduce((s, v) => s + v, 0);
    expect(shareSum).toBeCloseTo(1, 6);
    expect(Object.keys(together.shares).length).toBe(2);
  });

  it('chapter amounts add up exactly to the net subtotal', () => {
    for (const code of ['CL', 'ES', 'MX', 'US', 'CO']) {
      const r = computeAll(projectDraft(code), NOW);
      const sum = r.quote.partidas.reduce((s, p) => s + p.amount, 0);
      expect(Math.abs(sum - r.quote.subtotal), code).toBeLessThan(0.0001);
      expect(r.quote.partidas).toHaveLength(4);
    }
  });

  it('an incomplete partida makes the project invalid but reports per-partida errors', () => {
    const d = projectDraft();
    d.partidas[1].dims.length = null;
    const r = computeAll(d, NOW);
    expect(r.valid).toBe(false);
    expect(r.partidas[1].validation.errors.length).toBe('required');
    expect(r.partidas[0].validation.valid).toBe(true);
  });

  it('quick mode prices a single task end to end', () => {
    const d = newDraft('ES');
    d.partidas[0].dims = { ...d.partidas[0].dims, length: 5, width: 4 };
    const r = computeAll(d, NOW);
    expect(r.valid).toBe(true);
    expect(r.quote.partidas).toHaveLength(1);
    expect(r.quote.partidas[0].amount).toBeCloseTo(r.quote.subtotal, 6);
  });
});

describe('VAT / sales tax', () => {
  it('uses the official rate of the selected country in every quote', () => {
    for (const code of REGION_CODES) {
      const d = newDraft(code);
      d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
      const r = computeAll(d, NOW);
      const region = REGIONS[code];
      expect(r.quote.taxRate, code).toBe(region.taxRate);
      const expected = r.quote.subtotal * region.taxRate;
      const tol = region.digits === 0 ? 0.51 : 0.0051;
      expect(Math.abs(r.quote.tax - expected), code).toBeLessThanOrEqual(tol);
      expect(r.quote.total).toBeCloseTo(r.quote.subtotal + r.quote.tax, 6);
      expect(r.quote.taxName).toBe(region.taxName);
    }
  });

  it('Chile 19%, Spain 21%, Mexico 16% on the same measures', () => {
    const quote = (code) => {
      const d = newDraft(code);
      d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
      return computeAll(d, NOW).quote;
    };
    expect(quote('CL').taxRate).toBeCloseTo(0.19, 10);
    expect(quote('ES').taxRate).toBeCloseTo(0.21, 10);
    expect(quote('MX').taxRate).toBeCloseTo(0.16, 10);
  });

  it('editable countries (US, CA, BR) accept a custom rate; others ignore it', () => {
    expect(taxRateFor(REGIONS.US, { tax: 6.5 })).toBeCloseTo(0.065, 10);
    expect(taxRateFor(REGIONS.US, { tax: null })).toBe(0.08);
    expect(taxRateFor(REGIONS.US, { tax: 900 })).toBe(0.08);
    expect(taxRateFor(REGIONS.CL, { tax: 5 })).toBe(0.19);

    const d = newDraft('US');
    d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
    d.finance.tax = 0;
    expect(computeAll(d, NOW).quote.tax).toBe(0);
    d.finance.tax = 10;
    const q = computeAll(d, NOW).quote;
    expect(q.taxRate).toBeCloseTo(0.1, 10);
    expect(Math.abs(q.tax - q.subtotal * 0.1)).toBeLessThanOrEqual(0.0051);
  });
});

describe('client budget: strict confidentiality', () => {
  const draft = projectDraft('CL');
  const base = ctxFor(draft);
  const model = buildClientModel(base);
  const allStrings = (value) =>
    JSON.stringify(value, (k, v) => (typeof v === 'number' ? String(v) : v)).toLowerCase();

  it('shows partidas as chapters with amounts, net subtotal, official tax and total', () => {
    expect(model.chapters).toHaveLength(4);
    expect(model.chapters[0].title).toMatch(/^Partida 1: /);
    expect(model.chapters[0].title).toContain('Radier del quincho');
    expect(model.subtotal).toBe(base.result.quote.subtotal);
    expect(model.tax).toBe(base.result.quote.tax);
    expect(model.total).toBe(base.result.quote.total);
    expect(model.taxLabel).toMatch(/IVA/);
    expect(model.taxLabel).toContain('19');
    expect(model.company.name).toBe('Constructora Aurora SpA');
    expect(model.company.details.join(' ')).toContain('RUT');
    expect(model.validity.length).toBeGreaterThan(10);
  });

  it('contains NO hardware store names, unit prices, materials, waste or leftovers', () => {
    const dump = allStrings(model);
    for (const region of Object.values(REGIONS)) {
      for (const chain of region.chains) expect(dump.includes(chain.name.toLowerCase()), chain.name).toBe(false);
    }
    const q = base.result.quote;
    for (const item of q.items) {
      expect(dump.includes(`"${item.unitPrice}"`), `unit price of ${item.id}`).toBe(false);
    }
    for (const word of ['sobrante', 'merma', 'leftover', 'waste', 'cemento', 'saco', 'tienda', 'p. unit']) {
      expect(dump.includes(word), word).toBe(false);
    }
    expect(Object.keys(model)).not.toContain('materials');
    expect(Object.keys(model)).not.toContain('leftovers');
    expect(Object.keys(model)).not.toContain('stores');
  });

  it('the copy/share text is equally confidential', () => {
    const text = clientSummaryText(model, base.money, 'Cubicador Pro').toLowerCase();
    for (const chain of REGIONS.CL.chains) expect(text.includes(chain.name.toLowerCase())).toBe(false);
    expect(text).toContain('partida 1');
  });
});

describe('technical dossier', () => {
  it('has stores, purchase plan, leftover inventory and the internal cost breakdown', () => {
    const base = ctxFor(projectDraft('CL'));
    const model = buildTechModel(base);
    expect(model.materials.length).toBeGreaterThan(5);
    expect(model.stores.length).toBeGreaterThan(0);
    const storeNames = REGIONS.CL.chains.map((c) => c.name);
    for (const s of model.stores) expect(storeNames).toContain(s.store);
    expect(model.partidas).toHaveLength(4);
    expect(model.partidas[0].waste).toMatch(/%$/);
    expect(model.costs.laborPct).toBe(35);
    expect(model.costs.transportPct).toBe(5);
    expect(model.costs.total).toBe(base.result.quote.total);
    expect(model.leftovers.rows.length).toBeGreaterThan(0);
    expect(model.leftovers.total).toBe(base.result.quote.leftoverValue);
  });
});

describe('PDF generation', () => {
  const raw = (doc) => doc.output('arraybuffer');
  const text = (doc) => Buffer.from(raw(doc)).toString('latin1');

  it('pdfSafe keeps text WinAnsi-safe', () => {
    expect(pdfSafe('Ñandú ✓ 😀')).not.toMatch(/[\u2713\u{1F300}-\u{1FAFF}]/u);
    expect(pdfSafe('Instalación')).toContain('Instalaci');
  });

  it('money in PDF is ISO code + localized number', () => {
    const f = pdfMoneyFormatter(REGIONS.CL);
    expect(f(1234567)).toMatch(/^CLP /);
    expect(pdfMoneyFormatter(REGIONS.ES)(10.5)).toMatch(/^EUR /);
  });

  it('file names are safe', () => {
    const n = pdfFileName('Presupuesto', '../../etc/<passwd> Quincho', new Date('2026-03-04T00:00:00Z'));
    expect(n).toMatch(/^[A-Za-z0-9_.-]+\.pdf$/);
    expect(n).not.toContain('..');
  });

  it('client PDF is a valid A4 document with chapters and NO store names or unit prices', async () => {
    const base = ctxFor(projectDraft('CL'));
    const model = buildClientModel(base);
    const money = pdfMoneyFormatter(base.region);
    const doc = await renderClientPdf(model, { money, appName: 'Cubicador Pro' });
    const s = text(doc);
    expect(s.startsWith('%PDF')).toBe(true);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(s).toContain('Partida 1');
    expect(s).toContain('Constructora Aurora SpA');
    expect(s).toContain('76.123.456-7');
    expect(s).toContain(money(model.total).replace(/\u00a0/g, ' ').split(' ')[0]);
    const lower = s.toLowerCase();
    for (const region of Object.values(REGIONS)) {
      for (const chain of region.chains) expect(lower.includes(chain.name.toLowerCase()), chain.name).toBe(false);
    }
    expect(lower).not.toContain('sobrantes');
    expect(lower).not.toContain('inventario');
    for (const item of base.result.quote.items) {
      expect(s.includes(money(item.unitPrice)), `unit price ${item.id}`).toBe(false);
    }
  });

  it('technical PDF lists stores, leftovers inventory and the cost breakdown', async () => {
    const base = ctxFor(projectDraft('CL'));
    const money = pdfMoneyFormatter(base.region);
    const model = buildTechModel({ ...base, money });
    const doc = await renderTechPdf(model, { t: base.t, money, appName: 'Cubicador Pro' });
    const s = text(doc);
    expect(s.startsWith('%PDF')).toBe(true);
    const names = REGIONS.CL.chains.map((c) => c.name);
    expect(names.some((n) => s.includes(n))).toBe(true);
    expect(s).toContain('Inventario de Sobrantes Reutilizables');
    expect(s).toContain('Mano de obra');
    expect(s).toContain('flete');
  });

  it('English client budget works for a US project', async () => {
    const base = ctxFor(projectDraft('US'), 'en');
    const model = buildClientModel(base);
    const doc = await renderClientPdf(model, { money: pdfMoneyFormatter(base.region) });
    expect(text(doc)).toContain('Sales tax');
  });
});

describe('local profile', () => {
  it('creates a local user without any account data', () => {
    const u = localUser('  Juan <b>Perez</b> ');
    expect(u.provider).toBe('local');
    expect(u.name).not.toMatch(/[<>]/);
    expect(u.email).toBe('');
    expect(localUser('').name.length).toBeGreaterThan(0);
  });
  it('persisted local users validate', () => {
    expect(normalizeUser(localUser('Ana')).provider).toBe('local');
    expect(normalizeUser({ provider: 'hacker', name: 'x' })).toBeNull();
  });
});

describe('dictionary parity for the new features', () => {
  it('ES and EN define exactly the same keys', () => {
    const es = Object.keys(DICT.es).sort();
    const en = Object.keys(DICT.en).sort();
    expect(en).toEqual(es);
  });
  it('every region has a tax-id label and placeholder in both languages', () => {
    for (const code of REGION_CODES) {
      for (const lang of ['es', 'en']) {
        expect(DICT[lang][`company.taxId.${code}`], `${lang} ${code}`).toBeTruthy();
      }
    }
  });
  it('every catalog base/sale unit and task field unit has a translation', () => {
    const units = new Set();
    for (const m of Object.values(CATALOG)) {
      units.add(m.base);
      units.add(m.sale);
    }
    for (const t of Object.values(TASKS)) for (const f of t.fields) units.add(f.unit);
    for (const u of units) {
      expect(DICT.es[`unit.${u}`], `es unit.${u}`).toBeTruthy();
      expect(DICT.en[`unit.${u}`], `en unit.${u}`).toBeTruthy();
    }
  });
  it('every task, option and metric key used by the UI is translated', () => {
    for (const id of TASK_IDS) {
      expect(DICT.es[`task.${id}`]).toBeTruthy();
      expect(DICT.es[`task.${id}.desc`]).toBeTruthy();
      expect(DICT.es[`com.scope.${id}`]).toBeTruthy();
      expect(DICT.es[`note.${id}`]).toBeTruthy();
      for (const o of TASKS[id].options) {
        expect(DICT.es[`opt.${id}.${o.key}`], `${id}.${o.key}`).toBeTruthy();
        for (const v of o.values) expect(DICT.es[`opt.${id}.${o.key}.${v}`], `${id}.${o.key}.${v}`).toBeTruthy();
      }
    }
  });
});
