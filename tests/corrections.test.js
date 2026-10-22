// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React, { act, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider, makeI18n } from '../src/lib/i18n.jsx';
import ScheduleSheet from '../src/components/ScheduleSheet.jsx';
import ProfileSheet from '../src/components/ProfileSheet.jsx';
import ContractorSignatureSheet from '../src/components/ContractorSignatureSheet.jsx';
import { newDraft, normalizeDraft, normalizeCompany, EMPTY_COMPANY, saveCompany, loadCompany } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { SCHEDULE, buildSchedule, planningWindow, planProject, suggestCrew, parseISODay } from '../src/lib/schedule.js';
import { MACHINES, machineryRate } from '../src/lib/machinery.js';
import { marketBucket, nextBucketAt, MARKET_WINDOW_MS, referencePrice } from '../src/lib/pricing.js';
import { useMarketClock } from '../src/lib/marketClock.js';
import { normalizeInk, normalizeSignature, planningTimeline, freezeSignature, pricingTime } from '../src/lib/signature.js';
import { newProject, snapshotCompany, normalizeProject } from '../src/lib/projects.js';
import { buildClientModel } from '../src/lib/reports.js';
import { createReportPdf } from '../src/lib/reportPdf.js';
import { photosForReport } from '../src/lib/photos.js';
import { getRegion } from '../src/lib/regions.js';
import { CATALOG } from '../src/lib/catalog.js';
import { DICT } from '../src/lib/dict.js';
import { LANGS } from '../src/lib/regions.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const NOW = new Date(2026, 10, 2, 9, 0, 0).getTime(); // 2 Nov 2026, local
const read = (rel) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');
const raw = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
const images = (s) => (s.match(/\/Subtype \/Image/g) || []).length;

function bigDraft() {
  const d = newDraft('CL');
  d.partidas[0].dims = { ...d.partidas[0].dims, length: 15, width: 12 }; // ~144 HH + curing
  return d;
}
const partidasOf = (d) => computeAll(d, NOW).partidas;

let host;
let root;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
const withI18n = (el) => React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, el);

// ---------------------------------------------------------------------------------------------------------
describe('Cronograma y cuadrillas: automatic from the project', () => {
  it('planningWindow: start = project start (or today), end optional, inclusive day count, bad end ignored', () => {
    const w = planningWindow({ startDate: '2026-11-02', endDate: '2026-11-16' }, NOW);
    expect(w.availableDays).toBe(15);
    expect(planningWindow({ startDate: '2026-11-02', endDate: '2026-11-02' }, NOW).availableDays).toBe(1);
    const noStart = planningWindow({ endDate: '2026-11-06' }, NOW); // starts today (2 Nov)
    expect(noStart.availableDays).toBe(5);
    expect(planningWindow({}, NOW).availableDays).toBeNull();
    expect(planningWindow({ startDate: '2026-11-10', endDate: '2026-11-01' }, NOW).end).toBeNull(); // end before start: ignored
    expect(planningWindow({ endDate: '2026-02-30' }, NOW).end).toBeNull(); // impossible date
    expect(planningWindow({ endDate: '2020-01-01' }, NOW).availableDays).toBeNull(); // already past relative to today: no window
    expect(parseISODay('2026-13-01')).toBeNull();
  });

  it('suggestCrew returns the SMALLEST crew that fits the window; dead technical time is never shortened', () => {
    const partidas = partidasOf(bigDraft());
    const days = (c) => buildSchedule(partidas, c).totals.totalDays;
    expect(days(1)).toBeGreaterThan(days(5));
    for (const available of [30, 20, 15, 12]) {
      const { crew, fits } = suggestCrew(partidas, available);
      expect(fits).toBe(true);
      expect(days(crew)).toBeLessThanOrEqual(available);
      if (crew > SCHEDULE.minCrew) expect(days(crew - 1)).toBeGreaterThan(available); // minimal
    }
    // a window shorter than the dead time cannot be met by any crew: best effort, flagged
    const dead = buildSchedule(partidas, SCHEDULE.maxCrew).totals.deadDays;
    const tight = suggestCrew(partidas, dead - 1);
    expect(tight.fits).toBe(false);
    expect(days(tight.crew)).toBe(days(SCHEDULE.maxCrew)); // reaches the best possible duration...
    if (tight.crew > 1) expect(days(tight.crew - 1)).toBeGreaterThan(days(SCHEDULE.maxCrew)); // ...with the fewest workers
  });

  it('computeAll: automatic crew follows the project dates; manual crew and "no deadline" keep the stored crew', () => {
    const d = bigDraft();
    const tl = { startDate: '2026-11-02', endDate: '2026-11-16' };
    const auto = computeAll(d, NOW, { timeline: tl }).schedule;
    expect(auto.plan).toMatchObject({ auto: true, hasDeadline: true, availableDays: 15, fits: true, startDate: '2026-11-02', deadline: '2026-11-16' });
    expect(auto.crew).toBeGreaterThan(SCHEDULE.defaultCrew - 3); // computed, not the stored default
    expect(auto.plan.spareDays).toBeGreaterThanOrEqual(0);
    // a tighter deadline needs a bigger crew
    const tighter = computeAll(d, NOW, { timeline: { startDate: '2026-11-02', endDate: '2026-11-12' } }).schedule;
    expect(tighter.crew).toBeGreaterThanOrEqual(auto.crew);
    // a looser one a smaller (or equal) crew
    const looser = computeAll(d, NOW, { timeline: { startDate: '2026-11-02', endDate: '2026-12-31' } }).schedule;
    expect(looser.crew).toBeLessThanOrEqual(auto.crew);
    // manual: the stored crew wins, and the plan says whether it fits
    const manual = computeAll({ ...d, crew: 1, crewAuto: false }, NOW, { timeline: tl }).schedule;
    expect(manual.crew).toBe(1);
    expect(manual.plan.auto).toBe(false);
    expect(manual.plan.fits).toBe(false);
    expect(manual.plan.spareDays).toBeLessThan(0);
    // no deadline: nothing to derive from, the stored crew (default 3) is used and no check is made
    const none = computeAll(d, NOW).schedule;
    expect(none.crew).toBe(SCHEDULE.defaultCrew);
    expect(none.plan.hasDeadline).toBe(false);
    expect(none.plan.fits).toBeNull();
    expect(none.plan.estimatedEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('machinery rental days follow the automatic crew, and the quote follows machinery', () => {
    const d = bigDraft();
    const a = computeAll(d, NOW, { timeline: { startDate: '2026-11-02', endDate: '2026-11-08' } }); // tight: big crew
    const b = computeAll(d, NOW, { timeline: { startDate: '2026-11-02', endDate: '2026-12-30' } }); // loose: small crew
    const mixer = (r) => r.machinery.items.find((i) => i.id === 'mixer');
    expect(mixer(a).days).toBeLessThanOrEqual(mixer(b).days);
    expect(a.quote.total).not.toBeNaN();
  });

  it('draft: crewAuto defaults true, only `false` turns it off, hostile values are safe', () => {
    expect(newDraft('CL').crewAuto).toBe(true);
    expect(normalizeDraft({ regionCode: 'CL', crewAuto: false }, 'CL').crewAuto).toBe(false);
    expect(normalizeDraft({ regionCode: 'CL', crewAuto: 'no' }, 'CL').crewAuto).toBe(true);
    expect(normalizeDraft({ regionCode: 'CL' }, 'CL').crewAuto).toBe(true); // drafts from before this field
  });

  function Harness({ startDate = '2026-11-02', endDate = '2026-11-16', draft0 = bigDraft() }) {
    const [draft, setDraft] = useState(draft0);
    const result = useMemo(() => computeAll(draft, NOW, { timeline: { startDate, endDate } }), [draft, startDate, endDate]);
    return withI18n(React.createElement(ScheduleSheet, { draft, setDraft, result, onClose: () => {} }));
  }
  const mountSheet = (props) => act(() => root.render(React.createElement(Harness, props)));

  it('the sheet shows the calendar plan and the deadline check, with the crew in automatic mode', () => {
    mountSheet();
    expect(q('sched-window').textContent).toMatch(/^Inicio .+ · Término estimado /);
    expect(q('sched-deadline').getAttribute('data-fits')).toBe('true');
    expect(q('sched-deadline').textContent).toContain('Cabe en el plazo del proyecto');
    expect(document.getElementById('crew-label').textContent).toBe('Cuadrilla automática según el plazo del proyecto');
    expect(q('crew-auto')).toBeNull(); // nothing to restore while automatic
    expect(q('sched-noend')).toBeNull();
  });

  it('+ / - take manual control from the crew shown; the "Automática" chip brings the computed crew back (same UX as before)', async () => {
    mountSheet();
    const auto = Number(q('crew-count').textContent);
    await click(q('crew-plus'));
    expect(Number(q('crew-count').textContent)).toBe(auto + 1);
    expect(q('crew-auto')).not.toBeNull();
    expect(document.getElementById('crew-label').textContent).not.toContain('automática');
    await click(q('crew-minus'));
    await click(q('crew-minus'));
    expect(Number(q('crew-count').textContent)).toBe(Math.max(1, auto - 1));
    await click(q('crew-auto'));
    expect(Number(q('crew-count').textContent)).toBe(auto);
    expect(q('crew-auto')).toBeNull();
    // the pinned, thumb-zone stepper is intact
    expect(q('crew-plus').className).toContain('h-16');
    expect(q('crew-plus').closest('.sticky')).not.toBeNull();
  });

  it('a manual crew that misses the deadline says so; without an end date it asks for one', async () => {
    mountSheet({ endDate: '2026-11-08' });
    for (let i = 0; i < 40; i += 1) await click(q('crew-minus')); // all the way down
    expect(Number(q('crew-count').textContent)).toBe(1);
    expect(q('sched-deadline').getAttribute('data-fits')).toBe('false');
    expect(q('sched-deadline').textContent).toContain('No cabe en el plazo');
    act(() => root.unmount());
    root = createRoot(host);
    mountSheet({ endDate: '' });
    expect(q('sched-noend')).not.toBeNull();
    expect(q('sched-deadline')).toBeNull();
    expect(q('crew-auto')).toBeNull();
    expect(Number(q('crew-count').textContent)).toBe(SCHEDULE.defaultCrew);
  });

  it('the wizard and the dashboard card pass the project dates to the engine', () => {
    const w = read('components/Wizard.jsx');
    expect(w).toMatch(/planningTimeline\(draft, \{ startDate, endDate \}\)/);
    expect(w).toMatch(/computeAll\(draft, priceTime, \{ timeline \}\)/);
    expect(read('App.jsx')).toMatch(/startDate=\{active\.startDate\}/);
    expect(read('components/ProjectCard.jsx')).toMatch(/planningTimeline\(project\.draft, project\)/);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('prices and rentals refresh continuously', () => {
  it('marketBucket / nextBucketAt are exact and a broken clock cannot poison the prices', () => {
    const t = 1_700_000_123_456;
    expect(nextBucketAt(t) % MARKET_WINDOW_MS).toBe(0);
    expect(nextBucketAt(t)).toBeGreaterThan(t);
    expect(nextBucketAt(t) - t).toBeLessThanOrEqual(MARKET_WINDOW_MS);
    expect(marketBucket(nextBucketAt(t))).toBe(marketBucket(t) + 1);
    for (const junk of [NaN, undefined, 'x', Infinity, null]) expect(Number.isFinite(marketBucket(junk))).toBe(true);
    const region = getRegion('CL');
    expect(referencePrice(Object.keys(CATALOG)[0], region, region.chains[0], marketBucket(NaN))).toBeGreaterThan(0);
  });

  it('rental rates drift with the 15-minute window like materials: same inside it, different across windows, always small and positive', () => {
    const b = marketBucket(NOW);
    for (const id of Object.keys(MACHINES)) {
      expect(machineryRate(id, 'CL', b)).toBe(machineryRate(id, 'CL', b));
      const rates = new Set();
      for (let k = 0; k < 12; k += 1) {
        const r = machineryRate(id, 'CL', b + k);
        rates.add(r);
        expect(r).toBeGreaterThan(0);
        expect(Math.abs(r / machineryRate(id, 'CL', b) - 1)).toBeLessThan(0.04);
      }
      expect(rates.size).toBeGreaterThan(1);
    }
    // the engine prices the machinery at the same window as the materials
    const d = bigDraft();
    const a = computeAll(d, NOW);
    const same = computeAll(d, NOW + 60_000);
    expect(same.quote.total).toBe(a.quote.total); // same window
    expect(computeAll(d, NOW + 7 * MARKET_WINDOW_MS).quote.total).not.toBe(a.quote.total);
    const mixerRate = (r) => r.machinery.items.find((i) => i.id === 'mixer').rate;
    expect(new Set([0, 1, 2, 3, 4, 5].map((k) => mixerRate(computeAll(d, NOW + k * MARKET_WINDOW_MS)))).size).toBeGreaterThan(1);
  });

  function Clock() {
    const { now, refresh } = useMarketClock();
    return React.createElement('div', null, React.createElement('b', { 'data-testid': 'bucket' }, String(marketBucket(now))), React.createElement('button', { 'data-testid': 'refresh', onClick: refresh }, 'r'));
  }

  it('useMarketClock moves by itself when a new window starts, with no tap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    await act(async () => root.render(React.createElement(Clock)));
    const start = Number(q('bucket').textContent);
    expect(start).toBe(marketBucket(NOW));
    await act(async () => { await vi.advanceTimersByTimeAsync(MARKET_WINDOW_MS + 2_000); });
    expect(Number(q('bucket').textContent)).toBe(start + 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(MARKET_WINDOW_MS); });
    expect(Number(q('bucket').textContent)).toBe(start + 2); // and keeps going: the timer is re-armed
  });

  it('after the phone sleeps (clock jumps) the very first focus / visibility event re-prices', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    await act(async () => root.render(React.createElement(Clock)));
    const start = Number(q('bucket').textContent);
    vi.setSystemTime(NOW + 3 * 3_600_000); // timers were frozen: nothing fired yet
    expect(Number(q('bucket').textContent)).toBe(start);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(Number(q('bucket').textContent)).toBe(marketBucket(NOW + 3 * 3_600_000));
    vi.setSystemTime(NOW + 5 * 3_600_000);
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(Number(q('bucket').textContent)).toBe(marketBucket(NOW + 5 * 3_600_000));
  });

  it('the manual refresh still works; the screens say that prices refresh by themselves', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    await act(async () => root.render(React.createElement(Clock)));
    vi.setSystemTime(NOW + MARKET_WINDOW_MS * 2);
    act(() => q('refresh').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(Number(q('bucket').textContent)).toBe(marketBucket(NOW) + 2);
    expect(read('components/Wizard.jsx')).toContain('useMarketClock()');
    expect(read('components/steps/StepPrices.jsx')).toContain("t('prices.auto')");
    expect(DICT.es['prices.auto']).toContain('15 minutos');
  });

  it('the dashboard card re-prices on every market window and day change', () => {
    const card = read('components/ProjectCard.jsx');
    expect(card).toMatch(/\[project\.draft, project\.startDate, project\.endDate, lang, bucket, day\]/);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('contractor signature saved in the profile', () => {
  it('normalizeInk accepts only a small PNG data URL with sane size', () => {
    expect(normalizeInk({ dataUrl: PNG, w: 120, h: 40 })).toEqual({ dataUrl: PNG, w: 120, h: 40 });
    expect(normalizeInk({ dataUrl: 'data:text/html;base64,AAAA', w: 1, h: 1 })).toBeNull();
    expect(normalizeInk({ dataUrl: 'javascript:alert(1)', w: 1, h: 1 })).toBeNull();
    expect(normalizeInk({ dataUrl: PNG, w: 0, h: 10 })).toBeNull();
    expect(normalizeInk({ dataUrl: PNG, w: 99999, h: 10 })).toBeNull();
    expect(normalizeInk({ dataUrl: `data:image/png;base64,${'A'.repeat(70_000)}`, w: 10, h: 10 })).toBeNull();
    expect(normalizeInk(null)).toBeNull();
  });

  it('it is part of the company profile: persisted, sanitized, copied into new projects and kept in stored ones', () => {
    expect(EMPTY_COMPANY.signature).toBeNull();
    const c = normalizeCompany({ name: 'Aurora', signature: { dataUrl: PNG, w: 100, h: 30, evil: '<x>' } });
    expect(c.signature).toEqual({ dataUrl: PNG, w: 100, h: 30 });
    expect(normalizeCompany({ name: 'A', signature: 'nope' }).signature).toBeNull();
    saveCompany(c);
    expect(loadCompany().signature).toEqual({ dataUrl: PNG, w: 100, h: 30 });
    const project = newProject({ regionCode: 'CL', company: c });
    expect(project.company.signature).toEqual({ dataUrl: PNG, w: 100, h: 30 });
    expect(normalizeProject(JSON.parse(JSON.stringify(project))).company.signature).toEqual({ dataUrl: PNG, w: 100, h: 30 });
    expect(snapshotCompany({ name: 'x' }).signature).toBeNull();
  });

  function pdfCtx(company) {
    const d = newDraft('CL');
    d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
    const result = computeAll(d, NOW);
    const i18n = makeI18n('es', 'CL');
    return { draft: d, result, company, i18n, photos: [] };
  }

  it('final documents get it automatically: report model and client PDF (one more image, none without it)', async () => {
    const i = makeI18n('es', 'CL');
    const ctx = pdfCtx({ name: 'Aurora', taxId: '76.1', signature: { dataUrl: PNG, w: 120, h: 40 } });
    const model = buildClientModel({ draft: ctx.draft, result: ctx.result, company: ctx.company, region: i.region, t: i.t, num: i.num, date: i.date });
    expect(model.contractorSignature).toEqual({ dataUrl: PNG, w: 120, h: 40 });
    const without = buildClientModel({ draft: ctx.draft, result: ctx.result, company: { name: 'Aurora' }, region: i.region, t: i.t, num: i.num, date: i.date });
    expect(without.contractorSignature).toBeNull();
    const withSig = images(raw((await createReportPdf('client', ctx)).doc));
    const noSig = images(raw((await createReportPdf('client', pdfCtx({ name: 'Aurora', taxId: '76.1' }))).doc));
    expect(withSig).toBeGreaterThan(noSig); // the contractor's ink is an extra image (PNG + its alpha mask)
  });

  it('the report screen shows it above the contractor line and the app falls back to the profile one', () => {
    const rep = read('components/steps/StepReport.jsx');
    expect(rep).toContain('data-testid="contractor-signature-img"');
    expect(rep).toContain('sig-img'); // inverted on the black screen, printed black on paper
    expect(read('App.jsx')).toMatch(/signature: company\.signature/); // older projects still print the profile's signature
  });

  // fake canvas: happy-dom has no 2D context
  function fakeCanvas() {
    const ctx = new Proxy({}, { get: (_, k) => (k === 'canvas' ? {} : () => {}), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => PNG);
  }
  const draw = (canvas) => {
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 150 });
    const ev = (type, x, y) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(e, { clientX: x, clientY: y, pointerType: 'touch', pointerId: 1, button: 0 });
      act(() => canvas.dispatchEvent(e));
    };
    ev('pointerdown', 10, 10);
    ev('pointermove', 60, 40);
    ev('pointermove', 120, 20);
    ev('pointerup', 120, 20);
  };

  it('the signing canvas: empty -> error; drawn -> hands back the PNG; existing -> can be removed', () => {
    fakeCanvas();
    const got = [];
    act(() => root.render(withI18n(React.createElement(ContractorSignatureSheet, { value: null, onSave: (v) => got.push(v), onClose: () => {} }))));
    expect(q('contractor-sign-remove')).toBeNull();
    act(() => q('contractor-sign-accept').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(document.querySelector('[role="alert"]').textContent).toContain('Dibuja');
    expect(got).toEqual([]);
    draw(q('signature-canvas'));
    act(() => q('contractor-sign-accept').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ dataUrl: PNG });
    expect(got[0].w).toBeGreaterThan(0);
    act(() => root.render(withI18n(React.createElement(ContractorSignatureSheet, { value: got[0], onSave: (v) => got.push(v), onClose: () => {} }))));
    act(() => q('contractor-sign-remove').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(got[1]).toBeNull();
    vi.restoreAllMocks();
  });

  it('Ajustes -> profile: the field opens the canvas (not nested), saves into the profile form and goes with "Guardar"', async () => {
    fakeCanvas();
    let saved = null;
    const company = { ...EMPTY_COMPANY, name: 'Aurora', proName: 'Ana Ruiz' };
    await act(async () => root.render(withI18n(React.createElement(ProfileSheet, { company, logo: '', drive: true, onSave: async (v) => { saved = v; }, onClose: () => {} }))));
    expect(q('profile-signature')).not.toBeNull();
    expect(q('profile-signature-preview')).toBeNull();
    await click(q('profile-signature-box'));
    expect(q('contractor-sign-sheet')).not.toBeNull();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); // replaces, never stacks
    draw(q('signature-canvas'));
    await click(q('contractor-sign-accept'));
    expect(q('contractor-sign-sheet')).toBeNull();
    expect(q('profile-signature-preview').getAttribute('src')).toBe(PNG);
    expect(document.querySelector('input').value).not.toBeUndefined(); // the form (and its data) is still there
    await click(q('profile-save'));
    expect(saved.signature).toMatchObject({ dataUrl: PNG });
    expect(saved.name).toBe('Aurora');
    vi.restoreAllMocks();
  });

  it('the first-run setup stays minimal: no signature field there', () => {
    expect(read('components/ProfileSetup.jsx')).not.toMatch(/onSign|ContractorSignature/);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('PDF export includes the attached photos', () => {
  const JPEG =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const variant = (k) => {
    const at = JPEG.indexOf('//////') + 40;
    return JPEG.slice(0, at) + 'ABCD'[k % 4] + JPEG.slice(at + 1); // distinct bytes: jsPDF would merge identical images
  };
  const photo = (slot) => ({ slot, dataUrl: variant(slot), width: 1200, height: 900, at: 100 + slot });
  const slots = [0, 1, 2, 3].map(photo);
  const i18n = makeI18n('es', 'CL');
  const mk = (over = {}) => {
    const d = { ...newDraft('CL'), ...over };
    d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
    return { draft: d, result: computeAll(d, NOW), company: { name: 'Obra' }, i18n, photos: photosForReport(slots, i18n.t) };
  };

  it('a default project exports BOTH reports with the four photos', async () => {
    const client = images(raw((await createReportPdf('client', mk())).doc));
    const tech = images(raw((await createReportPdf('tech', mk())).doc));
    expect(client).toBeGreaterThanOrEqual(4);
    expect(tech).toBeGreaterThanOrEqual(4);
  });

  it('only an explicit opt-out removes them from the client PDF; the technical dossier always keeps them', async () => {
    const off = mk({ attachPhotos: false, photosChoice: true });
    expect(images(raw((await createReportPdf('client', off)).doc))).toBe(0);
    expect(images(raw((await createReportPdf('tech', off)).doc))).toBeGreaterThanOrEqual(4);
  });

  it('the switch records the user choice (so old defaults can never override it)', () => {
    expect(read('components/steps/StepReport.jsx')).toContain('attachPhotos: v, photosChoice: true');
  });
});

describe('strings of this round exist in six languages', () => {
  it('share note, contractor signature, automatic crew and price refresh', () => {
    const keys = ['pdf.shareTextOnly', 'sign.pro.title', 'sign.pro.hint', 'sign.pro.empty', 'sign.pro.change', 'sign.pro.remove', 'sign.pro.sheetTitle', 'sign.pro.sheetSubtitle', 'sched.auto', 'sched.auto.reset', 'sched.manual', 'sched.window', 'sched.deadline.ok', 'sched.deadline.over', 'sched.deadline.impossible', 'sched.noEnd', 'prices.auto', 'pro.plan.biennial', 'pro.price.biennial', 'pro.plan.popular', 'pro.permonth', 'pro.plan.flex'];
    for (const l of LANGS) for (const k of keys) expect(DICT[l][k], `${l}:${k}`).toBeTruthy();
    for (const l of LANGS) {
      expect(DICT[l]['sched.window']).toMatch(/\{start\}.*\{end\}/);
      expect(DICT[l]['sched.deadline.ok']).toContain('{days}');
      expect(DICT[l]['pro.permonth']).toContain('{price}');
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('signed documents are frozen: later date edits cannot move crew, rentals or total', () => {
  const SIGNED_AT = NOW;
  const tight = { startDate: '2026-11-02', endDate: '2026-11-08' };
  const loose = { startDate: '2026-11-02', endDate: '2026-12-30' };
  const totalOf = (draft, live, at) => {
    const r = computeAll(draft, pricingTime(draft, at), { timeline: planningTimeline(draft, live) });
    return { total: r.quote.total, crew: r.schedule.crew, rent: r.machinery.total };
  };
  const sign = (draft, live) => {
    const total = totalOf(draft, live, SIGNED_AT).total;
    const sig = normalizeSignature({ dataUrl: PNG, w: 10, h: 10, name: 'Cliente', total, pricedAt: SIGNED_AT, at: SIGNED_AT });
    return freezeSignature(draft, { ...draft, signature: sig }, live);
  };

  it('unsigned quotes follow the live dates (sanity: the dates really matter for this draft)', () => {
    const d = bigDraft();
    const a = totalOf(d, tight, NOW);
    const b = totalOf(d, loose, NOW);
    expect(a.crew).toBeGreaterThan(b.crew);
    expect(a.total).not.toBe(b.total);
  });

  it('a new signature is stamped with the dates it was signed with; the plan then ignores new dates', () => {
    const d = bigDraft();
    const signed = sign(d, tight);
    expect(signed.signature.timeline).toEqual(tight);
    const before = totalOf(signed, tight, NOW + 5 * 86_400_000);
    const after = totalOf(signed, loose, NOW + 9 * 86_400_000); // dates edited AND days later
    expect(after).toEqual(before);
    expect(after.total).toBeCloseTo(signed.signature.total, 2); // still exactly the signed amount
  });

  it('removing the signature releases the plan; a stored signature round-trips with its frozen dates', () => {
    const signed = sign(bigDraft(), tight);
    const released = { ...signed, signature: null };
    expect(planningTimeline(released, loose)).toEqual(loose);
    const back = normalizeDraft(JSON.parse(JSON.stringify(signed)), 'CL');
    expect(back.signature.timeline).toEqual(tight);
    expect(totalOf(back, loose, NOW)).toEqual(totalOf(signed, tight, NOW));
  });

  it('only a NEW signature is stamped: an older one (no stamp) never inherits later dates', () => {
    const legacy = { ...bigDraft(), signature: normalizeSignature({ dataUrl: PNG, w: 10, h: 10, total: 1, pricedAt: NOW }) };
    expect(legacy.signature.timeline).toBeUndefined();
    expect(planningTimeline(legacy, tight)).toEqual({ startDate: '', endDate: '' });
    const edited = { ...legacy, step: 2 }; // any later edit keeps the same signature object
    expect(freezeSignature(legacy, edited, tight)).toBe(edited);
    expect(freezeSignature(legacy, edited, tight).signature.timeline).toBeUndefined();
    expect(normalizeSignature({ ...legacy.signature, timeline: { startDate: 'x', endDate: '2026-01-02' } }).timeline).toEqual({ startDate: '', endDate: '2026-01-02' });
  });

  it('the wizard stamps through every draft update and the project card uses the frozen dates', () => {
    const w = read('components/Wizard.jsx');
    expect(w).toMatch(/freezeSignature\(d, /);
    expect(w).toMatch(/planningTimeline\(draft, \{ startDate, endDate \}\)/);
    expect(read('components/ProjectCard.jsx')).toMatch(/planningTimeline\(project\.draft, project\)/);
  });
});
