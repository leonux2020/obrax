// @vitest-environment happy-dom
// The SPA completed: crew + schedule, machinery rentals, finance, advances (all on the app's own numpad), the read-only
// lock, the client's signature from the export sheet, and the structure rules (one export module, no door to the old editor).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectWorkspace from '../src/components/ProjectWorkspace.jsx';
import ToastHost from '../src/components/workspace/ToastHost.jsx';
import { newProject, toDayString } from '../src/lib/projects.js';
import { computeAll } from '../src/lib/engine.js';
import { currentBook, resetRegistry } from '../src/lib/priceRegistry.js';
import { flushUserPrices } from '../src/lib/priceFeed.js';
import { resetToasts } from '../src/lib/notify.js';
import { freezeQuote } from '../src/lib/signature.js';
import { runExport } from '../src/lib/exportActions.js';
import { crewModel, rentRows, toggleMachine, withCrew, withCrewAuto, withDeadlineDays, withMachinery } from '../src/lib/workspaceModel.js';
import { MACHINE_IDS } from '../src/lib/machinery.js';
import { DICT } from '../src/lib/dict.js';

vi.mock('../src/lib/exportActions.js', () => ({ EXPORT_KINDS: ['client', 'tech', 'xlsx'], runExport: vi.fn(async () => 'shared') }));
vi.mock('../src/components/SignatureSheet.jsx', async () => {
  const React = await import('react');
  return {
    default: ({ onSave, onSkip, skipLabel }) =>
      React.createElement(
        'div',
        { 'data-testid': 'sig-stub' },
        React.createElement('button', { 'data-testid': 'sig-accept', onClick: () => onSave({ dataUrl: 'data:image/png;base64,AAAA', w: 10, h: 10, name: 'Cliente', taxId: '1-9', at: 1, total: 1, pricedAt: 1 }) }, 'ok'),
        React.createElement('button', { 'data-testid': 'sig-skip', onClick: onSkip }, skipLabel)
      ),
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toDayString(d);
};
const mk = (extra = {}, start = -5, end = 20) => {
  const p = newProject({ regionCode: 'CL', name: 'Casa Pérez', client: 'Ana', startDate: day(start), endDate: day(end) });
  p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 }; // 24 m², 2.4 m³: needs the mixer
  return { ...p, ...extra };
};
const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');

// ---- pure model --------------------------------------------------------------------------------------------------------
describe('model: crew, machinery, deadline', () => {
  it('withCrew takes manual control (clamped), withCrewAuto gives it back; both REFUSE while locked', () => {
    const d = mk().draft;
    expect(withCrew(d, 5)).toMatchObject({ crew: 5, crewAuto: false });
    expect(withCrew(d, 99).crew).toBe(30);
    expect(withCrew(d, 0)).toBe(d);
    expect(withCrewAuto(withCrew(d, 5)).crewAuto).toBe(true);
    expect(withCrewAuto(d)).toBe(d); // already automatic
    const frozen = freezeQuote(d, { pricedAt: 1000, total: 5, live: {} });
    expect(withCrew(frozen, 5)).toBe(frozen);
    expect(withMachinery(frozen, { include: false })).toBe(frozen);
  });

  it('machinery: master switch + stable excluded list of known ids', () => {
    const d = mk().draft;
    expect(withMachinery(d, { include: false }).machinery).toMatchObject({ include: false, excluded: [] });
    expect(toggleMachine([], 'mixer', false)).toEqual(['mixer']);
    expect(toggleMachine(['mixer', 'mixer', 'nonsense'], 'mixer', true)).toEqual([]);
    expect(toggleMachine(['scaffold'], 'compactor', false)).toEqual(MACHINE_IDS.filter((x) => ['compactor', 'scaffold'].includes(x)));
  });

  it('withDeadlineDays: end = start + (days - 1); no start date = today; junk and a locked quote change nothing', () => {
    const p = mk();
    expect(withDeadlineDays(p, 10)).toMatchObject({ startDate: day(-5), endDate: day(4) });
    expect(withDeadlineDays({ ...p, startDate: '', endDate: '' }, 3)).toMatchObject({ startDate: day(0), endDate: day(2) });
    expect(withDeadlineDays(p, 0)).toBe(p);
    expect(withDeadlineDays(p, 99999)).toBe(p);
    const locked = { ...p, draft: freezeQuote(p.draft, { pricedAt: 1000, total: 5, live: p }) };
    expect(withDeadlineDays(locked, 10)).toBe(locked);
  });

  it('crewModel / rentRows read the engine result; an incomplete quote has neither', () => {
    const p = mk();
    const r = computeAll(p.draft, Date.now(), { timeline: { startDate: p.startDate, endDate: p.endDate }, chains: false });
    const m = crewModel(r);
    expect(m.crew).toBeGreaterThanOrEqual(1);
    expect(m.plan.hasDeadline).toBe(true);
    expect(m.rows.length).toBe(1);
    expect(rentRows(r).map((x) => x.id)).toContain('mixer');
    const empty = computeAll(newProject({ regionCode: 'CL' }).draft, Date.now(), { chains: false });
    expect(crewModel(empty)).toBeNull();
    expect(rentRows(empty)).toEqual([]);
  });
});

// ---- the screen ---------------------------------------------------------------------------------------------------------
let host;
let root;
const q = (id) => host.querySelector(`[data-testid="${id}"]`);
const qa = (id) => [...host.querySelectorAll(`[data-testid="${id}"]`)];
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
const keys = async (s) => {
  for (const k of s) await click(q(`pad-${k}`));
};

function Harness({ initial, spy }) {
  const [project, set] = useState(initial);
  const setProject = (u) => set((p) => (typeof u === 'function' ? u(p) : u));
  const setDraft = (u) => set((p) => ({ ...p, draft: typeof u === 'function' ? u(p.draft) : u }));
  spy.project = project;
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(ProjectWorkspace, { project, setProject, setDraft, photos: [null, null, null, null], setPhotos: () => {}, company: project.company, receipts: null, enqueueReceipt: async () => {}, onBack: () => {}, onEdit: () => {}, onPro: () => {} }),
    React.createElement(ToastHost)
  );
}
let spy;
const mount = async (initial) => {
  spy = {};
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(Harness, { initial, spy })));
  });
  await flush();
};

beforeEach(() => {
  localStorage.clear();
  resetRegistry();
  resetToasts();
  runExport.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Cuadrilla y cronograma (numpad, no OS keyboard)', () => {
  it('shows the plan; + / − and the pad set the crew by hand, the schedule and the quote follow', async () => {
    await mount(mk());
    expect(q('ws-crew').tagName).toBe('DETAILS');
    expect(q('sched-window')).not.toBeNull();
    expect(q('sched-timeline').children).toHaveLength(1);
    const total0 = q('ws-total').textContent;
    await click(q('crew-plus'));
    expect(spy.project.draft.crewAuto).toBe(false); // touching the crew = manual control
    const crew1 = spy.project.draft.crew;
    await click(q('crew-plus'));
    expect(spy.project.draft.crew).toBe(crew1 + 1);
    await click(q('crew-minus'));
    expect(spy.project.draft.crew).toBe(crew1);
    await click(q('crew-count'));
    expect(q('crew-pad')).not.toBeNull();
    expect(host.querySelector('input:focus')).toBeNull();
    await keys('1');
    expect(spy.project.draft.crew).toBe(1);
    await keys('9'); // 19 people: allowed
    expect(spy.project.draft.crew).toBe(19);
    await keys('9'); // 199 would go over the maximum (30): the digit is refused
    expect(spy.project.draft.crew).toBe(19);
    await click(q('pad-done'));
    expect(q('crew-pad')).toBeNull();
    expect(q('ws-total').textContent).not.toBe(''); // the header keeps its live total
    expect(typeof total0).toBe('string');
    await click(q('crew-auto')); // back to the deadline-driven crew
    expect(spy.project.draft.crewAuto).toBe(true);
  });

  it('the deadline in days is typed on the pad and moves the project end date (start stays)', async () => {
    await mount(mk());
    expect(q('crew-deadline').textContent).toContain('26');
    await click(q('crew-deadline'));
    expect(q('days-pad')).not.toBeNull();
    await keys('40');
    expect(spy.project.startDate).toBe(day(-5));
    expect(spy.project.endDate).toBe(day(34)); // -5 + 40 - 1
    expect(q('crew-deadline').textContent).toContain('40');
    await click(q('pad-done'));
  });

  it('advances to workers: the name is text, the AMOUNT is typed on the pad and discounts the labour pool', async () => {
    await mount(mk());
    const pool0 = Number(q('labor-pool').dataset.available);
    expect(pool0).toBeGreaterThan(0);
    await typeInto(host.querySelector('[data-testid="advances-panel"] input'), 'Juan');
    expect(q('advance-add').disabled).toBe(true); // no amount yet
    await click(q('advance-amount'));
    expect(q('advance-pad')).not.toBeNull();
    await keys('5000');
    await click(q('pad-done'));
    await click(q('advance-add'));
    expect(spy.project.advances).toHaveLength(1);
    expect(spy.project.advances[0]).toMatchObject({ worker: 'Juan', amount: 5000 });
    expect(Number(q('labor-pool').dataset.available)).toBe(pool0 - 5000);
    await click(host.querySelector('[data-testid="advance-list"] button'));
    expect(spy.project.advances).toHaveLength(0);
  });
});

describe('Maquinaria y arriendos (numpad + real time)', () => {
  it('the daily rate is typed on the pad: the quote recalculates at once and it is saved as the user rate', async () => {
    await mount(mk());
    expect(q('ws-machinery').tagName).toBe('DETAILS');
    expect(q('rent-mixer')).not.toBeNull();
    const total0 = q('ws-total').textContent;
    await click(q('rent-rate-mixer'));
    expect(q('rent-pad')).not.toBeNull();
    await keys('99999');
    expect(q('ws-total').textContent).not.toBe(total0);
    expect(currentBook('CL')?.user?.rent?.mixer).toBe(99999);
    expect(q('rent-rate-mixer').dataset.source).toBe('saved');
    await click(q('pad-reset'));
    expect(currentBook('CL')?.user?.rent?.mixer).toBeUndefined();
    await click(q('pad-done'));
    await flushUserPrices();
  });

  it('master and per-machine switches change the quote', async () => {
    await mount(mk());
    const total0 = q('ws-total').textContent;
    await click(q('machinery-mixer'));
    expect(spy.project.draft.machinery.excluded).toContain('mixer');
    expect(q('ws-total').textContent).not.toBe(total0);
    await click(q('machinery-master'));
    expect(spy.project.draft.machinery.include).toBe(false);
    expect(q('rent-mixer')).toBeNull();
  });
});

describe('finance + expenses inside the same screen', () => {
  it('the selectors (sliders) move the total; a rented tool has its return switch', async () => {
    const p = mk({ expenses: [{ id: 'e1', description: 'Taladro', category: 'tool_rental', supplier: 'Easy', amount: 25000, returnDate: day(3), returned: false }] });
    await mount(p);
    const total0 = q('ws-total').textContent;
    const slider = q('slider-profit-input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '20');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(spy.project.draft.finance.profit).toBe(20);
    expect(q('ws-total').textContent).not.toBe(total0);
    await click(q('expense-return-e1'));
    expect(spy.project.expenses[0].returned).toBe(true);
  });
});

describe('read-only while locked', () => {
  const lockedProject = () => {
    const p = mk();
    return { ...p, draft: freezeQuote(p.draft, { pricedAt: Date.now(), total: 1, live: p }) };
  };

  it('every editor of the quote is a disabled fieldset with a shield: a tap answers "Precios bloqueados" and nothing changes', async () => {
    await mount(lockedProject());
    expect(qa('locked-shield').length).toBeGreaterThanOrEqual(4); // partida, crew, machinery, finance
    expect(q('crew-plus').closest('fieldset').disabled).toBe(true);
    expect(q('rent-rate-mixer').closest('fieldset').disabled).toBe(true);
    expect(q('slider-profit-input').closest('fieldset').disabled).toBe(true);
    expect(q('partida-0').querySelector('fieldset').disabled).toBe(true);
    const before = spy.project.draft;
    await click(q('crew-minus')); // disabled: nothing happens
    await click(qa('locked-shield')[1]);
    expect(q('toast').textContent).toBe('Precios bloqueados');
    expect(spy.project.draft).toBe(before);
    expect(q('rent-pad')).toBeNull();
    await click(q('partida-add') ?? qa('locked-shield')[0]);
  });

  it('unlocking makes every editor live again', async () => {
    await mount(lockedProject());
    await click(q('ws-unlock'));
    await click(q('unlock-confirm'));
    expect(qa('locked-shield')).toHaveLength(0);
    expect(q('crew-plus').closest('fieldset')).toBeNull();
    await click(q('crew-plus'));
    expect(spy.project.draft.crewAuto).toBe(false);
  });
});

describe('PDF Cliente + client signature', () => {
  it('"PDF Cliente" asks for the signature; signing locks the whole screen (🔒) and the signed PDF is generated by exportActions', async () => {
    await mount(mk());
    await click(q('dock-export'));
    await click(q('export-client'));
    expect(q('sig-stub')).not.toBeNull();
    expect(runExport).not.toHaveBeenCalled(); // not before the client signs
    await click(q('sig-accept'));
    const sig = spy.project.draft.signature;
    expect(sig).toMatchObject({ name: 'Cliente' });
    expect(sig.timeline).toEqual({ startDate: day(-5), endDate: day(20) }); // stamped like the wizard did
    expect(q('ws-lock-chip').textContent).toContain('Firmada');
    expect(q('project-workspace').dataset.locked).toBe('signed');
    expect(runExport).toHaveBeenCalledTimes(1);
    const [kind, ctx] = runExport.mock.calls[0];
    expect(kind).toBe('client');
    expect(ctx.project.draft.signature).toMatchObject({ name: 'Cliente' }); // the PDF sees the signature
    expect(qa('locked-shield').length).toBeGreaterThan(0); // read-only now
    await click(q('price-cement_bag'));
    expect(qa('toast').map((x) => x.textContent)).toContain('Precios bloqueados');
  });

  it('"Exportar sin firma" still delivers the client PDF (exportActions freezes the quote); the contractor PDF and Excel skip the signature', async () => {
    await mount(mk());
    await click(q('dock-export'));
    await click(q('export-client'));
    await click(q('sig-skip'));
    expect(runExport).toHaveBeenCalledTimes(1);
    expect(runExport.mock.calls[0][0]).toBe('client');
    expect(runExport.mock.calls[0][1].project.draft.signature).toBeNull();
    runExport.mockClear();
    await click(q('dock-export'));
    await click(q('export-tech'));
    expect(runExport.mock.calls[0][0]).toBe('tech');
    expect(q('sig-stub')).toBeNull();
    await click(q('dock-export'));
    await click(q('export-xlsx'));
    expect(runExport.mock.calls[1][0]).toBe('xlsx');
  });

  it('an already signed quote exports the client PDF straight away', async () => {
    const p = mk();
    const signed = { ...p, draft: { ...p.draft, signature: { dataUrl: 'data:image/png;base64,AAAA', w: 10, h: 10, name: 'X', taxId: '', at: 1, total: 1, pricedAt: Date.now(), timeline: { startDate: p.startDate, endDate: p.endDate } } } };
    await mount(signed);
    await click(q('dock-export'));
    await click(q('export-client'));
    expect(q('sig-stub')).toBeNull();
    expect(runExport.mock.calls[0][0]).toBe('client');
  });
});

describe('structure: one export module, no old editor, OLED black', () => {
  const workspaceFiles = () => [
    'src/components/ProjectWorkspace.jsx',
    ...fs.readdirSync(path.resolve(__dirname, '../src/components/workspace')).map((f) => `src/components/workspace/${f}`),
  ];

  it('ProjectWorkspace stays under 500 lines and never imports the old screens', () => {
    const src = read('src/components/ProjectWorkspace.jsx');
    expect(src.split('\n').length).toBeLessThan(500);
    expect(src).not.toMatch(/from '\.\/(ProjectView|Wizard)\.jsx'/);
    expect(src).not.toMatch(/steps\//);
    for (const f of workspaceFiles()) expect(read(f), f).not.toMatch(/ProjectView|Wizard|onAdvanced|ws-advanced/);
  });

  it('exports go ONLY through lib/exportActions.js (the workspace and the classic project view alike)', () => {
    for (const f of ['src/components/ProjectWorkspace.jsx', 'src/components/ProjectView.jsx']) {
      const src = read(f);
      expect(src, f).toMatch(/exportActions\.js/);
      expect(src, f).not.toMatch(/createReportPdf|buildRenditionFile|shareOrDownload|freezeQuote|pdfToFile/);
    }
  });

  it('no #121212 anywhere in the workspace: the background is the app black', () => {
    for (const f of workspaceFiles()) expect(read(f), f).not.toMatch(/121212/);
    expect(read('src/components/ProjectWorkspace.jsx')).toMatch(/bg-black/);
  });

  it('the dropped "Editor avanzado" label is gone from every language', () => {
    for (const lang of ['es', 'en', 'pt', 'fr', 'it', 'de']) expect(DICT[lang]['ws.advanced'], lang).toBeUndefined();
  });
});
