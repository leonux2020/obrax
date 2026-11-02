import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { newDraft, newPartida, normalizeDraft } from '../src/lib/draft.js';
import { defaultDims, TASK_IDS } from '../src/lib/tasks.js';
import { computeAll } from '../src/lib/engine.js';
import { spanDays, toISODay } from '../src/lib/schedule.js';
import { MACHINE_IDS, MACHINES, machineryRate } from '../src/lib/machinery.js';
import { HSE, ERGO_IDS, PPE_IDS, WASTE_IDS, hseFor, hseKeys } from '../src/lib/hse.js';
import { buildClientModel, buildTechModel } from '../src/lib/reports.js';
import { renderTechPdf, pdfMoneyFormatter } from '../src/lib/pdf.js';
import { makeI18n } from '../src/lib/i18n.jsx';
import { DICT } from '../src/lib/dict.js';
import { LANGS } from '../src/lib/regions.js';
import { buildSignature, isSignatureCurrent } from '../src/lib/signature.js';

const NOW = 1_700_000_000_000;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const DIMS = {
  slab: { length: 8, width: 5, thickness: 12 },
  masonry: { length: 10, height: 3.2 },
  roof: { length: 9, width: 6 },
  paint: { length: 20, height: 2.6 },
  floor: { length: 5, width: 4 },
  drywall: { length: 6, height: 2.5 },
};
function project(tasks, patch = {}) {
  const d = newDraft('CL', 'project');
  d.partidas = tasks.map((task) => {
    const p = newPartida(task);
    p.dims = { ...defaultDims(task), ...(DIMS[task] ?? {}) };
    return p;
  });
  return { ...d, ...patch };
}

describe('schedule: manual calendar (no theoretical planner)', () => {
  it('spanDays is the plain subtraction of two ISO days; invalid, missing or reversed dates give null', () => {
    expect(spanDays('2026-11-02', '2026-11-16')).toBe(14);
    expect(spanDays('2026-11-02', '2026-11-02')).toBe(0);
    expect(spanDays('2026-02-27', '2026-03-02')).toBe(3);
    expect(spanDays('', '2026-11-16')).toBeNull();
    expect(spanDays('2026-11-02', '')).toBeNull();
    expect(spanDays('2026-11-10', '2026-11-01')).toBeNull();
    expect(spanDays('2026-02-30', '2026-03-05')).toBeNull();
  });

  it('computeAll no longer carries a crew plan: no schedule, no HH; just the calendar days the user typed', () => {
    const d = project(['slab', 'roof']);
    const r = computeAll(d, NOW, { timeline: { startDate: '2026-11-02', endDate: '2026-11-12' } });
    expect(r.schedule).toBeUndefined();
    expect(r.siteDays).toBe(10);
    expect(computeAll(d, NOW).siteDays).toBeNull();
    expect(Object.keys(d)).not.toContain('crew');
  });
});

describe('major machinery: suggested, priced and added as an indirect cost', () => {
  it('suggests a mixer for a real slab and scaffolding for a roof, never hand tools', () => {
    const r = computeAll(project(['slab', 'roof']), NOW);
    const ids = r.machinery.items.map((i) => i.id);
    expect(ids).toContain('mixer');
    expect(ids).toContain('scaffold');
    expect(ids.every((id) => MACHINE_IDS.includes(id))).toBe(true);
    expect(Object.keys(MACHINES).some((k) => /shovel|trowel|barrow|hammer|pala|llana/i.test(k))).toBe(false);
  });

  it('a small slab does not need a mixer and a low wall does not need scaffolding', () => {
    const d = project(['slab', 'masonry']);
    d.partidas[0].dims = { ...d.partidas[0].dims, length: 2, width: 1.5, thickness: 8 };
    d.partidas[1].dims = { ...d.partidas[1].dims, height: 2.4 };
    expect(computeAll(d, NOW).machinery.items).toHaveLength(0);
    expect(computeAll(d, NOW).quote.machinery).toBe(0);
  });

  it('the rental lands in the quote: subtotal includes it and chapters still add up exactly', () => {
    const d = project(['slab', 'roof', 'paint']);
    const on = computeAll(d, NOW);
    const off = computeAll({ ...d, machinery: { include: false, excluded: [] } }, NOW);
    expect(on.quote.machinery).toBeGreaterThan(0);
    expect(off.quote.machinery).toBe(0);
    expect(on.quote.subtotal - off.quote.subtotal).toBe(on.quote.machinery);
    expect(on.quote.subtotal).toBe(on.quote.materials + on.quote.labor + on.quote.transport + on.quote.machinery);
    expect(on.quote.partidas.reduce((s, c) => s + c.amount, 0)).toBe(on.quote.subtotal);
  });

  it('every machine can be excluded individually', () => {
    const d = project(['slab', 'roof']);
    const all = computeAll(d, NOW);
    const noScaffold = computeAll({ ...d, machinery: { include: true, excluded: ['scaffold'] } }, NOW);
    expect(noScaffold.machinery.items.find((i) => i.id === 'scaffold').included).toBe(false);
    expect(noScaffold.machinery.items.find((i) => i.id === 'mixer').included).toBe(true);
    expect(noScaffold.quote.machinery).toBeLessThan(all.quote.machinery);
    expect(noScaffold.quote.partidas.reduce((s, c) => s + c.amount, 0)).toBe(noScaffold.quote.subtotal);
  });

  const timeline = (days) => ({ startDate: '2026-11-02', endDate: toISODay(new Date(2026, 10, 2 + days)) });
  const machineDays = (d, tl, id) => computeAll(d, NOW, { timeline: tl }).machinery.items.find((i) => i.id === id)?.days;

  it('rental days follow the REAL duration typed by the user (delivery - start): longer job = more rental days = costlier rental', () => {
    const d = project(['slab', 'roof']);
    const short = computeAll(d, NOW, { timeline: timeline(10) }).quote.machinery;
    const long = computeAll(d, NOW, { timeline: timeline(40) }).quote.machinery;
    expect(long).toBeGreaterThan(short);
    expect(computeAll(d, NOW, { timeline: timeline(40) }).quote.machinery).toBe(long); // deterministic
  });

  it('the rule per machine: the mixer works half of the partida\'s calendar days, the scaffold all of them plus one day to assemble, the compactor one day', () => {
    const one = project(['slab']);
    expect(machineDays(one, timeline(20), 'mixer')).toBe(10); // 50 % of 20
    expect(machineDays(one, timeline(21), 'mixer')).toBe(11); // rounded up
    expect(machineDays(one, timeline(20), 'compactor')).toBe(1);
    const roof = project(['roof']);
    expect(machineDays(roof, timeline(20), 'scaffold')).toBe(21); // 20 + 1
  });

  it('the calendar days are shared equally between the valid partidas (a mixer and a scaffold in different partidas do not both bill the whole job)', () => {
    const two = project(['slab', 'roof']);
    expect(machineDays(two, timeline(20), 'mixer')).toBe(5); // share = 10 days, 50 % of it
    expect(machineDays(two, timeline(20), 'scaffold')).toBe(11); // 10 + 1
  });

  it('without both dates the rental is the smallest one (1 day per partida) until the user types them; the crew / HH never enter', () => {
    const two = project(['slab', 'roof']);
    expect(machineDays(two, null, 'mixer')).toBe(1);
    expect(machineDays(two, { startDate: '2026-11-02', endDate: '' }, 'scaffold')).toBe(2);
    expect(machineDays(two, { startDate: '2026-11-10', endDate: '2026-11-01' }, 'mixer')).toBe(1); // reversed = ignored
    expect(computeAll({ ...two, crew: 12 }, NOW).quote.machinery).toBe(computeAll(two, NOW).quote.machinery); // an old crew field changes nothing
  });

  it('daily rates are positive, stable over time and scale with the region currency', () => {
    for (const id of MACHINE_IDS) {
      expect(machineryRate(id, 'CL')).toBeGreaterThan(0);
      expect(machineryRate(id, 'CL')).toBe(machineryRate(id, 'CL'));
    }
    expect(machineryRate('mixer', 'CL')).toBeGreaterThan(machineryRate('mixer', 'US') * 100);
  });

  it('shows up in the client breakdown and the technical dossier', () => {
    const d = { ...project(['slab', 'roof']), showBreakdown: true };
    const result = computeAll(d, NOW);
    const i = makeI18n('es', 'CL');
    const base = { draft: d, result, company: { name: 'X', taxId: '', phone: '', email: '', city: '' }, region: i.region, t: i.t, num: i.num, unit: i.unit, date: i.date };
    const client = buildClientModel(base);
    expect(client.breakdown.rows.map((r) => r.label)).toContain(i.t('bd.machinery'));
    expect(client.breakdown.rows.reduce((s, r) => s + r.amount, 0)).toBe(result.quote.subtotal);
    const tech = buildTechModel({ ...base, money: (v) => String(v) });
    expect(tech.costs.machinery).toBe(result.quote.machinery);
    expect(tech.machinery.some((m) => m.included)).toBe(true);
    expect(tech.planning).toBeUndefined(); // no man-hour planning section any more
  });

  it('the technical PDF renders (machinery section included) in every language', async () => {
    for (const lang of LANGS) {
      const d = project(['slab', 'roof']);
      const result = computeAll(d, NOW);
      const i = makeI18n(lang, 'CL');
      const money = pdfMoneyFormatter(i.region, i.locale);
      const model = buildTechModel({ draft: d, result, company: { name: 'X', taxId: '', phone: '', email: '', city: '' }, region: i.region, t: i.t, num: i.num, unit: i.unit, date: i.date, money });
      const doc = await renderTechPdf(model, { t: i.t, money, num: i.num });
      expect(doc.getNumberOfPages(), lang).toBeGreaterThan(0);
    }
  });
});

describe('draft: crew and machinery persistence', () => {
  it('new drafts carry machinery switched on and no theoretical crew fields', () => {
    const d = newDraft('CL');
    expect(d.machinery).toEqual({ include: true, excluded: [] });
    expect(d.crew).toBeUndefined();
    expect(d.crewAuto).toBeUndefined();
    expect(Object.keys(d).slice(-3)).toEqual(['machinery', 'frozen', 'regionCode']);
  });

  it('normalizes hostile input and drops the old crew fields of saved drafts', () => {
    const n = normalizeDraft({ ...newDraft('CL'), crew: 9999, crewAuto: false, machinery: { include: 'x', excluded: ['mixer', 'mixer', '<script>', 7] } }, 'CL');
    expect(n.machinery.excluded).toEqual(['mixer']);
    expect(typeof n.machinery.include).toBe('boolean');
    expect(n.crew).toBeUndefined();
    expect(n.crewAuto).toBeUndefined();
    expect(Object.keys(normalizeDraft(newDraft('CL'), 'CL'))).toEqual(Object.keys(newDraft('CL')));
  });

  it('legacy drafts: unsigned ones get the suggestion, a signed one keeps its signed total', () => {
    const full = newDraft('CL');
    full.partidas[0].dims = { ...full.partidas[0].dims, length: 8, width: 5 };
    const { machinery: _m, ...legacy } = full;
    expect(normalizeDraft(legacy, 'CL').machinery.include).toBe(true);
    const base = computeAll(normalizeDraft({ ...legacy, machinery: { include: false, excluded: [] } }, 'CL'), NOW);
    const sig = buildSignature({ ink: { dataUrl: PNG, w: 10, h: 10 }, name: 'Ana', total: base.quote.total, now: NOW });
    const signed = normalizeDraft({ ...legacy, signature: sig }, 'CL');
    expect(signed.machinery.include).toBe(false);
    expect(isSignatureCurrent(signed.signature, computeAll(signed, NOW).quote.total)).toBe(true);
  });
});

describe('HSE guide', () => {
  it('has a guide for every task with mandatory PPE, ergonomics and waste advice', () => {
    for (const task of TASK_IDS) {
      const g = hseFor(task);
      expect(g, task).not.toBeNull();
      expect(g.mandatory.length, task).toBeGreaterThanOrEqual(4);
      expect(g.recommended.length, task).toBeGreaterThan(0);
      expect(g.ergonomics.length, task).toBeGreaterThanOrEqual(4);
      expect(g.waste.length, task).toBeGreaterThanOrEqual(4);
      expect(new Set(g.mandatory).size).toBe(g.mandatory.length);
      expect(g.mandatory.filter((k) => g.recommended.includes(k))).toEqual([]);
    }
    expect(hseFor('nope')).toBeNull();
  });

  it('only references known ids and the task-critical PPE is there', () => {
    for (const task of TASK_IDS) {
      const g = HSE[task];
      for (const id of [...g.ppe.mandatory, ...g.ppe.recommended]) expect(PPE_IDS).toContain(id);
      for (const id of g.ergonomics) expect(ERGO_IDS).toContain(id);
      for (const id of g.waste) expect(WASTE_IDS).toContain(id);
    }
    expect(HSE.roof.ppe.mandatory).toContain('harness');
    expect(HSE.slab.ppe.mandatory).toContain('gloves_chem');
    expect(HSE.paint.ppe.recommended).toContain('respirator');
    expect(HSE.drywall.ppe.mandatory).toContain('mask');
  });

  it('every id resolves to a real, translated sentence in the six languages', () => {
    for (const lang of LANGS) {
      for (const key of [...hseKeys(), ...PPE_IDS.map((i) => `hse.ppe.${i}`), ...ERGO_IDS.map((i) => `hse.erg.${i}`), ...WASTE_IDS.map((i) => `hse.waste.${i}`)]) {
        expect(DICT[lang][key], `${lang} ${key}`).toBeTruthy();
      }
    }
    // no orphan texts: every catalog entry is used by at least one task
    const used = new Set(hseKeys());
    for (const id of PPE_IDS) expect(used.has(`hse.ppe.${id}`), id).toBe(true);
    for (const id of ERGO_IDS) expect(used.has(`hse.erg.${id}`), id).toBe(true);
    for (const id of WASTE_IDS) expect(used.has(`hse.waste.${id}`), id).toBe(true);
  });

  it('machinery keys needed by the engine exist in every language', () => {
    for (const lang of LANGS) {
      for (const id of MACHINE_IDS) {
        expect(DICT[lang][`mach.${id}`]).toBeTruthy();
        expect(DICT[lang][`mach.why.${id}`]).toBeTruthy();
      }
    }
  });
});

describe('Phase 3 UI structure and OLED compliance', () => {
  const read = (rel) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

  it('the HSE sheet is a bottom sheet and the buttons are in the dims and partida views', () => {
    expect(read('components/HseSheet.jsx')).toContain('BottomSheet');
    expect(read('components/steps/StepDims.jsx')).toContain('HseButton');
    expect(read('components/steps/StepPartidas.jsx')).toContain('HseButton');
  });

  it('no grey backgrounds in the new components, only thin white/10 borders', () => {
    for (const f of ['components/HseSheet.jsx', 'components/MachineryCard.jsx']) {
      const text = read(f);
      expect(text, f).not.toMatch(/bg-(neutral|gray|zinc|slate|stone)-\d/);
      if (!f.includes('Machinery')) expect(text, f).toContain('border-white/10'); // the machinery card is built from the shared Switch / card
    }
  });
});

describe('Phase 3 components render (server-side smoke test, every language)', () => {
  it('HSE sheet, machinery card and the entry buttons render real content', async () => {
    const React = (await import('react')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { I18nProvider } = await import('../src/lib/i18n.jsx');
    const { HseSheet, default: HseButton } = await import('../src/components/HseSheet.jsx');
    const { default: MachineryCard } = await import('../src/components/MachineryCard.jsx');
    const draft = project(['slab', 'roof']);
    const result = computeAll(draft, NOW);
    const noop = () => {};
    for (const lang of LANGS) {
      const wrap = (el) => renderToStaticMarkup(React.createElement(I18nProvider, { lang, regionCode: 'CL' }, el));
      for (const task of TASK_IDS) {
        const html = wrap(React.createElement(HseSheet, { task, onClose: noop }));
        expect(html, `${lang} ${task}`).toContain(DICT[lang]['hse.ppe']);
        expect(html).toContain(DICT[lang][hseFor(task).mandatory[0]]);
        expect(html).not.toMatch(/hse\.(ppe|erg|waste)\./); // a missing translation would print the raw key
      }
      expect(wrap(React.createElement(HseButton, { task: 'roof' }))).toContain('data-testid="hse-open"');
      const mach = wrap(React.createElement(MachineryCard, { draft, setDraft: noop, result }));
      expect(mach).toContain(DICT[lang]['mach.mixer']);
      expect(mach).toContain(DICT[lang]['mach.scaffold']);
      expect(mach).toContain(DICT[lang]['mach.nohand']);
    }
  });
});

describe('steps that host the Phase 3 entry points', () => {
  it('Finance renders with a valid and with an incomplete draft; Dims/Partidas expose the HSE button', async () => {
    const React = (await import('react')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { I18nProvider } = await import('../src/lib/i18n.jsx');
    const { default: StepFinance } = await import('../src/components/steps/StepFinance.jsx');
    const { default: StepDims } = await import('../src/components/steps/StepDims.jsx');
    const { default: StepPartidas } = await import('../src/components/steps/StepPartidas.jsx');
    const noop = () => {};
    const render = (el) => renderToStaticMarkup(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, el));

    const good = project(['slab', 'roof']);
    const goodResult = computeAll(good, NOW);
    const fin = render(React.createElement(StepFinance, { draft: good, setDraft: noop, result: goodResult }));
    expect(fin).not.toContain('schedule-open'); // the planner sheet is gone
    expect(fin).toContain('data-testid="machinery-card"');
    expect(fin).toContain(DICT.es['mach.total']);

    const bad = newDraft('CL'); // empty slab: not computable yet
    const badResult = computeAll(bad, NOW);
    expect(badResult.valid).toBe(false);
    const finBad = render(React.createElement(StepFinance, { draft: bad, setDraft: noop, result: badResult }));

    expect(render(React.createElement(StepDims, { draft: bad, setDraft: noop, result: badResult, showErrors: false }))).toContain('data-testid="hse-open"');
    const parts = render(React.createElement(StepPartidas, { draft: good, setDraft: noop, result: goodResult, showErrors: false }));
    expect((parts.match(/data-testid="hse-open"/g) || []).length).toBe(2);
  });
});
