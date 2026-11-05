// @vitest-environment happy-dom
// Fase 10.4, "Cuenta corriente simple con retención silenciosa": a DISCOUNT lowers what is owed to a worker but is NOT cash (separate
// collection, invisible to every cash figure); amount + reason required; red subtle history; and the global ledger of a worker in Ajustes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectWorkspace from '../src/components/ProjectWorkspace.jsx';
import SquadraSheet from '../src/components/squadra/SquadraSheet.jsx';
import { newProject, normalizeProject } from '../src/lib/projects.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';
import { advancesByWorker, globalBreakdown, laborPool, liquidity, normalizeDiscounts, projectLiquidity, workerLedger } from '../src/lib/ledger.js';
import { mergeProject, stampProject } from '../src/lib/merge.js';
import { withAdvance, withDiscount, withWorker, withoutDiscount, withoutWorker } from '../src/lib/workspaceModel.js';
import { saveWorkers } from '../src/lib/workers.js';
import { DICT } from '../src/lib/dict.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('../src/lib/exportActions.js', () => ({ EXPORT_KINDS: ['client', 'tech', 'xlsx'], runExport: vi.fn(async () => 'shared') }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base = (extra = {}) => ({ ...newProject({ regionCode: 'CL', name: 'Casa Pérez', client: 'Ana' }), crew: [], payments: [{ id: 'pay001', amount: 100000, at: 1 }], ...extra });
const withAna = () => {
  const p = withWorker(base(), { name: 'Ana Ruiz', specialty: 'mason', ref: 'wk000001' });
  return { p, id: p.crew[0].id };
};

// ---- the model ---------------------------------------------------------------------------------------------------------------
describe('discounts: model', () => {
  it('a discount needs a positive amount AND a note; the note is trimmed, the link is the worker id', () => {
    const { p, id } = withAna();
    expect(withDiscount(p, id, 500, '')).toBe(p);
    expect(withDiscount(p, id, 500, '   ')).toBe(p);
    expect(withDiscount(p, id, 0, 'Falta')).toBe(p);
    expect(withDiscount(p, id, -5, 'Falta')).toBe(p);
    expect(withDiscount(p, 'nadie', 500, 'Falta')).toBe(p); // not a person of the crew
    const d = withDiscount(p, id, 500, '  Falta  ', 1000);
    expect(d.discounts).toHaveLength(1);
    expect(d.discounts[0]).toMatchObject({ worker: 'Ana Ruiz', workerId: id, amount: 500, note: 'Falta', at: 1000 });
    expect(normalizeDiscounts([{ id: 'dsc001', worker: 'A', amount: 5, note: '' }, { id: 'dsc002', worker: 'A', amount: -5, note: 'x' }, { id: 'dsc003', worker: '', amount: 5, note: 'x' }, { id: 'dsc004', worker: 'A', amount: 5, note: 'ok' }]).map((x) => x.id)).toEqual(['dsc004']);
    expect(withoutDiscount(d, d.discounts[0].id).discounts).toEqual([]);
    expect(withoutDiscount(d, 'nope')).toBe(d);
  });

  it('NO CASH: a discount never touches the cash of the project (liquidity, advances, the global breakdown); an advance does', () => {
    const { p, id } = withAna();
    const withAdv = withAdvance(p, id, 3000);
    const cashBefore = projectLiquidity(withAdv);
    const d = withDiscount(withAdv, id, 700, 'Herramienta');
    expect(projectLiquidity(d)).toBe(cashBefore);
    expect(projectLiquidity(d)).toBe(97000); // 100000 - 3000 advanced; the 700 retained is nowhere in the cash
    expect(liquidity(d.payments, d.expenses, d.advances)).toBe(97000);
    expect(globalBreakdown([d], new Map())[0]).toMatchObject({ advanced: 3000, liquid: 97000 });
    expect(d.advances).toEqual(withAdv.advances); // the advances list is untouched
    expect(projectLiquidity(withAdvance(withAdv, id, 700))).toBe(96300); // an advance of the same amount DOES move cash
  });

  it('what is still owed: a discount lowers the pending labour (available), an advance too; "spent" only counts the cash', () => {
    const { p, id } = withAna();
    const d = withDiscount(withAdvance(p, id, 3000), id, 700, 'Falta');
    expect(laborPool(10000, d.advances, d.discounts)).toEqual({ pool: 10000, advanced: 3000, discounted: 700, available: 6300 });
    expect(laborPool(10000, d.advances)).toMatchObject({ discounted: 0, available: 7000 });
  });

  it('by worker: advances and discounts split the same way; a removed person leaves the discounts loose (nothing is lost)', () => {
    const { p, id } = withAna();
    const d = withDiscount(withAdvance(p, id, 3000), id, 700, 'Falta');
    const split = advancesByWorker(d.crew, d.advances, d.discounts);
    expect(split.rows[0]).toMatchObject({ total: 3000, discounted: 700 });
    expect(split.rows[0].discounts).toHaveLength(1);
    const gone = advancesByWorker(withoutWorker(d, id).crew, d.advances, d.discounts);
    expect(gone.looseDiscounts).toHaveLength(1);
    expect(gone.looseDiscounted).toBe(700);
    expect(gone.looseTotal).toBe(3000);
  });

  it('it survives saving / loading and syncing: normalizeProject keeps it, the merge adds records by id and a deletion is a tombstone', () => {
    expect(base().discounts).toEqual([]);
    const { p, id } = withAna();
    const d = withDiscount(p, id, 700, 'Falta', 1000);
    expect(normalizeProject(JSON.parse(JSON.stringify(d))).discounts).toEqual(d.discounts);
    expect(normalizeProject({ ...JSON.parse(JSON.stringify(p)), discounts: undefined }).discounts).toEqual([]); // older projects
    const other = withDiscount(p, id, 50, 'Tarde', 2000);
    const merged = mergeProject({ ...d, updatedAt: 5 }, { ...other, updatedAt: 6 });
    expect(merged.discounts.map((x) => x.note).sort()).toEqual(['Falta', 'Tarde']);
    const removed = stampProject(d, withoutDiscount(d, d.discounts[0].id), 3000);
    expect(removed.discounts).toEqual([]);
    expect(Object.keys(removed.tomb ?? {})).toContain(d.discounts[0].id);
  });

  it('every language has the words', () => {
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) {
      for (const k of ['ws.crew.discount', 'ws.crew.discounted', 'ws.crew.discountNote', 'ws.crew.discountNote.ph', 'ws.crew.discountAmount', 'ws.crew.discountApply', 'ws.crew.discountHint', 'ws.crew.discountNeed', 'squadra.ledger.title', 'squadra.ledger.total', 'squadra.ledger.empty']) expect(DICT[l][k], `${l} ${k}`).toBeTruthy();
    }
    expect(DICT.it['squadra.ledger.title']).toBe('Riepilogo pagamenti');
  });
});

// ---- the global ledger (pure) -------------------------------------------------------------------------------------------------
describe('workerLedger: what a person of the directory was paid, in every project', () => {
  const project = (name, regionCode, ref, advances, discounts = []) => {
    const p = withWorker({ ...newProject({ regionCode, name, client: 'C' }), crew: [] }, { name: 'Ana Ruiz', ref });
    const id = p.crew[0].id;
    let q = p;
    for (const a of advances) q = withAdvance(q, id, a);
    for (const d of discounts) q = withDiscount(q, id, d, 'Falta');
    return q;
  };
  it('lists project -> total paid (biggest first) and the grand total, only for the crew picked from THAT file', () => {
    const a = project('Casa A', 'CL', 'wk000001', [1000, 500]);
    const b = project('Casa B', 'CL', 'wk000001', [4000]);
    const c = project('Casa C', 'CL', 'wk000002', [9999]); // somebody else
    const none = project('Casa D', 'CL', 'wk000001', []);
    const out = workerLedger([a, b, c, none], 'wk000001');
    expect(out).toHaveLength(1);
    expect(out[0].projects.map((x) => [x.project.draft.project.name, x.paid])).toEqual([['Casa B', 4000], ['Casa A', 1500]]);
    expect(out[0]).toMatchObject({ paid: 5500, discounted: 0 });
    expect(workerLedger([a], 'wk000009')).toEqual([]);
    expect(workerLedger([a], '')).toEqual([]);
  });
  it('currencies are never mixed: one group each; discounts are kept apart from what was paid', () => {
    const cl = project('Casa A', 'CL', 'wk000001', [1000], [300]);
    const it = project('Cantiere', 'IT', 'wk000001', [200]);
    const out = workerLedger([cl, it], 'wk000001');
    expect(out).toHaveLength(2);
    expect(out.map((g) => g.currency).sort()).toEqual([...new Set(out.map((g) => g.currency))].sort());
    const clg = out.find((g) => g.projects[0].project === cl);
    expect(clg).toMatchObject({ paid: 1000, discounted: 300 });
    expect(out.find((g) => g.projects[0].project === it)).toMatchObject({ paid: 200, discounted: 0 });
  });
});

// ---- the screens --------------------------------------------------------------------------------------------------------------
let host;
let root;
let spy;
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
function Harness({ initial }) {
  const [project, set] = useState(initial);
  const setProject = (u) => set((p) => (typeof u === 'function' ? u(p) : u));
  const setDraft = (u) => set((p) => ({ ...p, draft: typeof u === 'function' ? u(p.draft) : u }));
  spy.project = project;
  return React.createElement(ProjectWorkspace, { project, setProject, setDraft, photos: [null, null, null, null], setPhotos: () => {}, company: project.company, receipts: null, enqueueReceipt: async () => {}, onBack: () => {}, onEdit: () => {}, onPro: () => {} });
}
const mountCrew = async (project) => {
  spy = {};
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(Harness, { initial: project })));
  });
  await flush();
  await click(q('ws-crew'));
};

beforeEach(() => {
  localStorage.clear();
  resetRegistry();
  resetToasts();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

describe('discounts: the worker accordion', () => {
  const setup = async () => {
    const { p, id } = withAna();
    await mountCrew(p);
    await click(q(`worker-toggle-${id}`));
    return id;
  };
  const addDiscount = async (id, amount, note) => {
    await click(q(`worker-discount-${id}`));
    await click(q('discount-amount'));
    await keys(String(amount));
    await click(q('pad-done'));
    await typeInto(q('discount-note'), note);
    await click(q('discount-save'));
  };

  it('a quiet "- Descuento" text button sits next to "+ Anticipo" (neutral text, no border, no fill)', async () => {
    const id = await setup();
    const btn = q(`worker-discount-${id}`);
    expect(btn.textContent).toBe('- Descuento');
    expect(btn.className).toContain('text-neutral-400');
    expect(btn.className).not.toMatch(/\bborder\b|\bbg-|\brounded/);
    expect(btn.className).toMatch(/min-h-\[(4[4-9]|5\d)px\]/);
    expect(btn.previousElementSibling).toBe(q(`worker-adv-${id}`));
  });

  it('it demands an amount AND a note: without both the button stays off and nothing is saved', async () => {
    const id = await setup();
    await click(q(`worker-discount-${id}`));
    expect(q('discount-form')).not.toBeNull();
    expect(q('discount-save').disabled).toBe(true);
    expect(q('discount-note').required).toBe(true);
    await typeInto(q('discount-note'), 'Falta'); // note only
    expect(q('discount-save').disabled).toBe(true);
    await typeInto(q('discount-note'), '   '); // blanks are not a reason
    await click(q('discount-amount'));
    await keys('500');
    await click(q('pad-done'));
    expect(q('discount-amount').dataset.value).toBe('500');
    expect(q('discount-save').disabled).toBe(true); // amount only
    expect(q('discount-hint').textContent).toContain(DICT.es['ws.crew.discountNeed']);
    await typeInto(q('discount-note'), 'Herramienta');
    expect(q('discount-save').disabled).toBe(false);
    expect(q('discount-hint').textContent).toBe(DICT.es['ws.crew.discountHint']); // "not a payment"
    expect(spy.project.discounts).toEqual([]); // nothing until it is applied
    await click(q('discount-save'));
    expect(q('discount-form')).toBeNull();
    expect(spy.project.discounts).toHaveLength(1);
    expect(spy.project.discounts[0]).toMatchObject({ amount: 500, note: 'Herramienta' });
  });

  it('applying it lowers the pending labour but NOT the cash: no advance is created and the spent figure does not move', async () => {
    const id = await setup();
    const pool0 = Number(q('labor-pool').dataset.available);
    const cash0 = projectLiquidity(spy.project);
    await addDiscount(id, 2500, 'Falta');
    expect(spy.project.advances).toEqual([]);
    expect(projectLiquidity(spy.project)).toBe(cash0);
    expect(Number(q('labor-pool').dataset.available)).toBe(pool0 - 2500);
    expect(Number(q('labor-pool').dataset.spent)).toBe(0); // nothing left the till
    expect(Number(q('labor-pool').dataset.discounted)).toBe(2500);
    expect(q('labor-discounted').textContent).toContain(DICT.es['ws.crew.discounted']);
    expect(q(`worker-discounted-${id}`).dataset.total).toBe('2500');
  });

  it('the history: advances in neutral text, discounts in a subtle red with the minus sign and the reason in plain sight', async () => {
    const id = await setup();
    await click(q(`worker-adv-${id}`));
    await keys('1000');
    await click(q('pad-done'));
    await addDiscount(id, 300, 'Falta');
    const list = q(`worker-advlist-${id}`);
    expect(list.children).toHaveLength(2);
    const adv = list.querySelector('[data-kind="advance"]');
    const disc = list.querySelector('[data-kind="discount"]');
    expect(adv.textContent).not.toContain('−');
    expect(adv.className + adv.innerHTML).not.toMatch(/red-400|amber/); // payments are neutral
    expect(adv.querySelector('.text-neutral-300')).not.toBeNull();
    const dId = spy.project.discounts[0].id;
    expect(q(`worker-disc-note-${dId}`).textContent).toBe('Falta');
    expect(q(`worker-disc-note-${dId}`).className).toContain('text-red-400/90');
    expect(q(`worker-disc-amount-${dId}`).className).toContain('text-red-400/90');
    expect(q(`worker-disc-amount-${dId}`).textContent).toMatch(/^− /);
    expect(disc.querySelector('button')).toBeNull(); // no delete outside edit mode
    expect(q(`worker-total-${id}`).dataset.total).toBe('1000'); // the advance total is only what was paid
  });

  it('in edit mode a discount has its own cross; deleting it gives the pending labour back', async () => {
    const id = await setup();
    await addDiscount(id, 300, 'Falta');
    const dId = spy.project.discounts[0].id;
    const before = Number(q('labor-pool').dataset.available);
    await click(q('crew-edit-toggle'));
    await click(q(`worker-disc-del-${dId}`));
    expect(spy.project.discounts).toEqual([]);
    expect(Number(q('labor-pool').dataset.available)).toBe(before + 300);
    expect(q('labor-discounted')).toBeNull();
  });
});

describe('Ajustes: "Historial financiero" in the file of a worker', () => {
  const mountSquadra = async (projects) => {
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(SquadraSheet, { projects, onClose: () => {} })));
    });
    await flush();
  };
  const crewOf = (name, ref, advances, discounts = []) => {
    let p = withWorker({ ...newProject({ regionCode: 'CL', name, client: 'C' }), crew: [] }, { name: 'Ana Ruiz', ref });
    const id = p.crew[0].id;
    for (const a of advances) p = withAdvance(p, id, a);
    for (const d of discounts) p = withDiscount(p, id, d, 'Falta');
    return p;
  };

  it('a read-only section lists project -> total paid and ends with the historical grand total', async () => {
    saveWorkers([{ id: 'wk000001', name: 'Ana Ruiz', specialties: ['mason'], rating: 4 }, { id: 'wk000002', name: 'Beto Soto', specialties: ['painter'], rating: 3 }]);
    const a = crewOf('Casa A', 'wk000001', [1000, 500], [200]);
    const b = crewOf('Casa B', 'wk000001', [4000]);
    const c = crewOf('Casa C', 'wk000002', [9999]);
    await mountSquadra([a, b, c]);
    await click(q('worker-wk000001'));
    const ledger = q('worker-ledger');
    expect(ledger).not.toBeNull();
    expect(ledger.querySelector('h3').textContent).toBe(DICT.es['squadra.ledger.title']);
    expect(ledger.querySelector('input, button, select, textarea')).toBeNull(); // read only
    expect(q('worker-card').contains(ledger)).toBe(true); // at the bottom of the read-only card
    expect(ledger.className).not.toMatch(/\bborder\b|rounded/); // flat: no box, no lines
    expect(ledger.querySelector('[class*="divide-"], [class*="border"]')).toBeNull();
    expect([...ledger.querySelectorAll('li')].map((li) => li.dataset.testid)).toEqual([`worker-ledger-project-${b.id}`, `worker-ledger-project-${a.id}`]); // biggest first; Casa C is somebody else's
    expect(q(`worker-ledger-paid-${b.id}`).dataset.amount).toBe('4000');
    expect(q(`worker-ledger-paid-${a.id}`).dataset.amount).toBe('1500');
    expect(q(`worker-ledger-project-${a.id}`).textContent).toContain('Casa A');
    expect(q(`worker-ledger-discounted-${a.id}`).className).toContain('text-red-400/90'); // retentions apart, quiet
    expect(q(`worker-ledger-discounted-${b.id}`)).toBeNull();
    expect(q('worker-ledger-total-CLP').dataset.amount).toBe('5500'); // paid only: the discounts moved no money
    expect(ledger.textContent).toContain(DICT.es['squadra.ledger.total']);
  });

  it('a person with no payments says so; a NEW person has no ledger yet', async () => {
    saveWorkers([{ id: 'wk000001', name: 'Ana Ruiz', specialties: [], rating: 0 }]);
    await mountSquadra([crewOf('Casa A', 'wk000009', [100])]);
    await click(q('worker-wk000001'));
    expect(q('worker-ledger-empty').textContent).toBe(DICT.es['squadra.ledger.empty']);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); // the card has no cancel: it closes the native way
    });
    await flush();
    await click(q('squadra-new'));
    expect(q('worker-ledger')).toBeNull();
  });

  it('Ajustes hands every stored project to the directory (App -> SettingsView -> SquadraSheet -> WorkerSheet)', () => {
    const read = (f) => readFileSync(path.resolve(__dirname, '..', 'src', f), 'utf8');
    expect(read('App.jsx')).toMatch(/onLogout=\{logout\}\s*projects=\{projects\}/);
    expect(read('components/SettingsView.jsx')).toContain('<SquadraSheet projects={projects}');
    expect(read('components/squadra/SquadraSheet.jsx')).toContain('projects={projects}');
  });
});
