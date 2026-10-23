import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { newDraft, newPartida, normalizeDraft } from '../src/lib/draft.js';
import { defaultDims, TASK_IDS } from '../src/lib/tasks.js';
import { computeAll } from '../src/lib/engine.js';
import { SCHEDULE, activeDaysFor, buildSchedule, clampCrew } from '../src/lib/schedule.js';
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

describe('schedule: man-hours vs technical dead time', () => {
  it('HH and dead days do not depend on the crew; only the active days do', () => {
    const d = project(['slab', 'floor']);
    const a = computeAll({ ...d, crew: 2 }, NOW).schedule;
    const b = computeAll({ ...d, crew: 8 }, NOW).schedule;
    expect(a.totals.hh).toBe(b.totals.hh);
    expect(a.totals.deadDays).toBe(b.totals.deadDays);
    expect(b.totals.activeDays).toBeLessThan(a.totals.activeDays);
    expect(a.totals.hh).toBeGreaterThan(0);
    expect(a.totals.deadDays).toBeGreaterThan(0);
  });

  it('total days = active days + dead days, and the rows chain end to start', () => {
    const s = computeAll(project(['slab', 'masonry', 'paint']), NOW).schedule;
    expect(s.totals.totalDays).toBe(s.totals.activeDays + s.totals.deadDays);
    let cursor = 0;
    for (const r of s.rows) {
      expect(r.start).toBe(cursor);
      expect(r.activeEnd).toBe(r.start + r.activeDays);
      expect(r.end).toBe(r.activeEnd + r.deadDays);
      cursor = r.end;
    }
    expect(cursor).toBe(s.totals.totalDays);
  });

  it('adding workers never makes the job longer and eventually hits the half-day floor', () => {
    const d = project(['slab', 'floor', 'paint']);
    let prev = Infinity;
    for (let crew = SCHEDULE.minCrew; crew <= SCHEDULE.maxCrew; crew++) {
      const total = computeAll({ ...d, crew }, NOW).schedule.totals.totalDays;
      expect(total).toBeLessThanOrEqual(prev);
      prev = total;
    }
    const s = computeAll({ ...d, crew: SCHEDULE.maxCrew }, NOW).schedule;
    for (const r of s.rows) expect(r.activeDays).toBeGreaterThanOrEqual(SCHEDULE.dayStep);
    // the dead time is a hard floor: no crew can finish before it
    expect(s.totals.totalDays).toBeGreaterThanOrEqual(s.totals.deadDays);
  });

  it('activeDaysFor rounds up in half days, clamps the crew and ignores 0 HH', () => {
    expect(activeDaysFor(0, 3)).toBe(0);
    expect(activeDaysFor(24, 3)).toBe(1);
    expect(activeDaysFor(25, 3)).toBe(1.5);
    expect(activeDaysFor(1, 99)).toBe(0.5);
    expect(clampCrew(0)).toBe(1);
    expect(clampCrew(500)).toBe(SCHEDULE.maxCrew);
    expect(clampCrew('abc')).toBe(SCHEDULE.defaultCrew);
    expect(buildSchedule([{ task: 'slab', calc: null }]).totals.totalDays).toBe(0);
  });

  it('every task type produces labour and a sensible plan', () => {
    for (const task of TASK_IDS) {
      const s = computeAll(project([task]), NOW).schedule;
      expect(s.rows[0].hh, task).toBeGreaterThan(0);
      expect(s.totals.totalDays, task).toBeGreaterThan(0);
    }
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

  it('rental days follow the crew (more workers = fewer rental days = cheaper rental)', () => {
    const d = project(['slab', 'roof']);
    const small = computeAll({ ...d, crew: 1 }, NOW).quote.machinery;
    const big = computeAll({ ...d, crew: 12 }, NOW).quote.machinery;
    expect(big).toBeLessThan(small);
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
    expect(tech.planning.totals.totalDays).toBe(result.schedule.totals.totalDays);
  });

  it('the technical PDF renders planning and machinery sections in every language', async () => {
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
  it('new drafts carry the default crew and machinery switched on', () => {
    const d = newDraft('CL');
    expect(d.crew).toBe(SCHEDULE.defaultCrew);
    expect(d.machinery).toEqual({ include: true, excluded: [] });
    expect(d.crewAuto).toBe(true);
    expect(Object.keys(d).slice(-5)).toEqual(['crew', 'crewAuto', 'machinery', 'frozen', 'regionCode']);
  });

  it('normalizes hostile input', () => {
    const n = normalizeDraft({ ...newDraft('CL'), crew: 9999, machinery: { include: 'x', excluded: ['mixer', 'mixer', '<script>', 7] } }, 'CL');
    expect(n.crew).toBe(SCHEDULE.defaultCrew); // out of range -> safe default, like every other numeric field
    expect(n.machinery.excluded).toEqual(['mixer']);
    expect(typeof n.machinery.include).toBe('boolean');
    expect(normalizeDraft({ ...newDraft('CL'), crew: -4 }, 'CL').crew).toBe(SCHEDULE.defaultCrew);
    expect(normalizeDraft({ ...newDraft('CL'), crew: 7.6 }, 'CL').crew).toBe(8);
    expect(normalizeDraft({ ...newDraft('CL'), crew: 'many' }, 'CL').crew).toBe(SCHEDULE.defaultCrew);
    expect(Object.keys(normalizeDraft(newDraft('CL'), 'CL'))).toEqual(Object.keys(newDraft('CL')));
  });

  it('legacy drafts: unsigned ones get the suggestion, a signed one keeps its signed total', () => {
    const full = newDraft('CL');
    full.partidas[0].dims = { ...full.partidas[0].dims, length: 8, width: 5 };
    const { machinery: _m, crew: _c, ...legacy } = full;
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

  it('planning keys needed by the engine exist in every language', () => {
    for (const lang of LANGS) {
      for (const k of ['curing', 'mortar', 'compound', 'screed', 'adhesive', 'drying']) expect(DICT[lang][`sched.dead.${k}`], `${lang} ${k}`).toBeTruthy();
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

  it('the crew stepper is pinned to the bottom with large touch targets', () => {
    const src = read('components/ScheduleSheet.jsx');
    expect(src).toContain('BottomSheet');
    expect(src).toContain('sticky bottom-0');
    expect(src).toMatch(/h-16 w-16/);
    expect(src).toContain('crew-plus');
    expect(src).toContain('crew-minus');
  });

  it('no grey backgrounds in the new components, only thin white/10 borders', () => {
    for (const f of ['components/HseSheet.jsx', 'components/ScheduleSheet.jsx', 'components/MachineryCard.jsx']) {
      const text = read(f);
      expect(text, f).not.toMatch(/bg-(neutral|gray|zinc|slate|stone)-\d/);
      if (!f.includes('Machinery')) expect(text, f).toContain('border-white/10'); // the machinery card is built from the shared Switch / card
    }
  });
});

describe('Phase 3 components render (server-side smoke test, every language)', () => {
  it('HSE sheet, planning sheet, machinery card and the entry buttons render real content', async () => {
    const React = (await import('react')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { I18nProvider } = await import('../src/lib/i18n.jsx');
    const { HseSheet, default: HseButton } = await import('../src/components/HseSheet.jsx');
    const { default: ScheduleSheet } = await import('../src/components/ScheduleSheet.jsx');
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
      const sched = wrap(React.createElement(ScheduleSheet, { draft, setDraft: noop, result, onClose: noop }));
      expect(sched).toContain(DICT[lang]['sched.crew']);
      expect(sched).toContain('data-testid="crew-plus"');
      expect(sched).not.toMatch(/sched\.[a-z.]+/);
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
    expect(fin).toContain('data-testid="schedule-open"');
    expect(fin).toContain('data-testid="machinery-card"');
    expect(fin).toContain(DICT.es['mach.total']);

    const bad = newDraft('CL'); // empty slab: not computable yet
    const badResult = computeAll(bad, NOW);
    expect(badResult.valid).toBe(false);
    const finBad = render(React.createElement(StepFinance, { draft: bad, setDraft: noop, result: badResult }));
    expect(finBad).not.toContain('schedule-open');

    expect(render(React.createElement(StepDims, { draft: bad, setDraft: noop, result: badResult, showErrors: false }))).toContain('data-testid="hse-open"');
    const parts = render(React.createElement(StepPartidas, { draft: good, setDraft: noop, result: goodResult, showErrors: false }));
    expect((parts.match(/data-testid="hse-open"/g) || []).length).toBe(2);
  });
});
