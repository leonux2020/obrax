// @vitest-environment happy-dom
// Zone A: DA INCASSARE (what is left to collect) is the only big number; liquidity (client payments - expenses - worker advances) stays
// a pure model value, in the money of the project's own market.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App, { resetBoot } from '../src/App.jsx';
import { projectStore } from '../src/lib/projectStore.js';
import { receiptQueue } from '../src/lib/receiptQueue.js';
import { newProject } from '../src/lib/projects.js';
import { liquidity } from '../src/lib/ledger.js';
import { headerModel } from '../src/lib/workspaceModel.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';
import { DICT } from '../src/lib/dict.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
let host;
let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const qa = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)];
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush(10);
};
const typeInto = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const pop = async () => {
  await act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  });
  await flush(10);
};

beforeEach(() => {
  localStorage.clear();
  resetRegistry();
  resetToasts();
  window.history.replaceState(null, '');
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

// ---- the real App --------------------------------------------------------------------------------------------------------------
async function mountApp() {
  resetBoot();
  await act(async () => {
    root.render(React.createElement(App, { splash: { hold: 0, fade: 0 } }));
    await new Promise((r) => setTimeout(r, 150));
  });
}
const seed = async (projects = []) => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
  for (const p of await projectStore.load()) await projectStore.remove(p.id);
  for (const r of await receiptQueue.list()) await receiptQueue.remove(r.id);
  for (const p of projects) await projectStore.save(p);
};

const typeIntoArea = (el, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });


const job = (extra = {}) => {
  const p = newProject({ regionCode: 'MX', name: 'Casa Soto', client: 'Luis Soto', startDate: '2026-03-02', endDate: '2026-03-11' });
  p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 };
  return {
    ...p,
    payments: [{ id: 'pay001', amount: 40000, at: at(2026, 3, 3), note: '' }],
    advances: [{ id: 'adv001', worker: 'Juan', amount: 3000, at: at(2026, 3, 5) }],
    expenses: [{ id: 'exp001', at: at(2026, 3, 6), supplier: 'Home Depot', description: 'Taladro', amount: 5000, category: 'tool_rental', returnDate: '', returned: true }],
    ...extra,
  };
};
const open = async (project) => {
  await seed([project]);
  await mountApp();
  await click(q('project-card'));
};

describe('liquidity (pure)', () => {
  it('payments - expenses - worker advances, to the cent', () => {
    expect(liquidity([{ amount: 40000 }], [{ amount: 5000 }], [{ amount: 3000 }])).toBe(32000);
    expect(liquidity([{ amount: 0.1 }, { amount: 0.2 }], [], [])).toBe(0.3); // no float noise
    expect(liquidity([{ amount: 100 }], [{ amount: 30.55 }, { amount: 10.1 }], [{ amount: 9.35 }])).toBe(50);
  });
  it('is 0 with nothing and negative when the contractor is financing the job; never NaN', () => {
    expect(liquidity()).toBe(0);
    expect(liquidity([], [], [])).toBe(0);
    expect(liquidity([], [{ amount: 500 }], [{ amount: 250 }])).toBe(-750);
    expect(liquidity([{ amount: 100 }], [{ amount: 400 }], [])).toBe(-300);
    expect(Number.isFinite(liquidity(undefined, undefined, undefined))).toBe(true);
  });
  it('rides on the Caja bar of the header model (0 when not given)', () => {
    const p = job();
    const h = headerModel({ project: p, total: 400, valid: true, cash: { pct: 25, paid: 100, pending: 300 }, liquid: 32000, now: Date.now() });
    expect(h.bars[1]).toMatchObject({ id: 'cash', pct: 25, liquid: 32000 });
    expect(headerModel({ project: p, total: 400, valid: true, cash: { pct: 25, paid: 100, pending: 300 }, now: Date.now() }).bars[1].liquid).toBe(0);
    expect(headerModel({ project: p, total: 0, valid: false, cash: null, liquid: NaN }).bars[1].liquid).toBe(0);
  });
});

describe('Zone A: DA INCASSARE is the one big number', () => {
  const num = (el) => Number(el.textContent.replace(/[^\d.,-]/g, '').replace(/,/g, ''));

  it('shows what is still to be collected, in the currency of the project (MX), soft orange (never red); quote and collected go small underneath', async () => {
    await open(job({ payments: [{ id: 'pay001', amount: 1000, at: at(2026, 3, 3), note: '' }] }));
    const due = q('ws-due');
    expect(q('ws-due-label').textContent).toBe('Por cobrar');
    expect(due.textContent).toMatch(/\$\s?[\d,]+\.\d{2}/); // es-MX / MXN with cents, not the Chilean peso
    expect(due.className).toMatch(/text-orange-400/);
    expect(due.className).not.toMatch(/text-red|#ff2b2b/);
    for (const c of ['text-3xl', 'font-medium', 'tracking-tight', 'tabular-nums']) expect(due.className).toContain(c);
    expect(num(q('ws-quote')) - num(q('ws-collected'))).toBeCloseTo(num(due), 1); // quote - collected = to collect
    expect(num(q('ws-collected'))).toBe(1000);
    const small = q('ws-summary');
    expect(small.className).toMatch(/text-xs/);
    expect(small.className).toContain('text-neutral-400');
    expect(small.textContent).toMatch(/Presupuesto.*Cobrado/);
  });

  it('the late project shows NO red delay text at all (the debt already says it)', async () => {
    await open(job()); // the dates are in the past: red level
    expect(q('ws-status')).toBeNull();
    expect(q('ws-zone-a').textContent).not.toMatch(/Atraso|Atrasado/);
    expect(q('ws-zone-a').innerHTML).not.toMatch(/#ff2b2b|text-red/);
  });

  it('the upper lane at the base of the block (2 px, a ghost white/5 track, green fill) holds the share collected; the two old meters are gone', async () => {
    await open(job());
    const line = q('ws-progress');
    expect(line.className).toContain('h-0.5');
    expect(line.className).toContain('bg-white/5');
    expect(q('ws-lanes').className).toContain('bottom-0');
    expect(q('ws-lanes').contains(line)).toBe(true);
    expect(q('ws-progress-fill').className).toContain('bg-brand');
    expect(q('ws-progress-fill').style.width).toBe(`${line.dataset.pct}%`);
    expect(Number(line.dataset.pct)).toBeGreaterThan(0);
    expect(q('ws-zone-a').querySelectorAll('[role="progressbar"]')).toHaveLength(2); // money + physical progress
    expect(q('ws-meters')).toBeNull();
    expect(q('bar-time')).toBeNull();
    expect(q('bar-cash')).toBeNull();
  });

  it('nothing paid yet: all of the quote is to collect and the line is empty', async () => {
    await open(job({ payments: [], expenses: [], advances: [] }));
    expect(num(q('ws-due'))).toBe(num(q('ws-quote')));
    expect(q('ws-collected')).toBeNull();
    expect(q('ws-progress').dataset.pct).toBe('0');
    expect(q('ws-due').textContent).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('paid in full (or over): the number is replaced by "Saldato" with a green check', async () => {
    await open(job({ payments: [{ id: 'pay001', amount: 9_999_999, at: at(2026, 3, 3), note: '' }] }));
    expect(q('ws-due')).toBeNull();
    expect(q('ws-due-label')).toBeNull();
    const ok = q('ws-settled');
    expect(ok.textContent).toBe('Saldado');
    expect(ok.className).toContain('text-brand');
    expect(ok.querySelector('svg[data-testid="ws-settled-check"]')).not.toBeNull();
    expect(q('ws-total').dataset.settled).toBe('true');
    expect(q('ws-progress').dataset.pct).toBe('100');
  });

  it('a quote that is not valid yet: no invented debt (a dash), no line, only what was collected', async () => {
    const empty = newProject({ regionCode: 'CL', name: 'Nueva' });
    await open({ ...empty, payments: [{ id: 'pay001', amount: 150000, at: 1, note: '' }] });
    expect(q('ws-due').textContent).toBe('—');
    expect(q('ws-due').className).not.toContain('text-orange');
    expect(q('ws-settled')).toBeNull();
    expect(q('ws-progress')).toBeNull();
    expect(q('ws-quote')).toBeNull();
    expect(q('ws-collected').textContent.replace(/\D/g, '')).toBe('150000'); // es-CL: 150.000
  });

  it('a brand-new project with no money and no valid quote does not fail', async () => {
    await open({ ...newProject({ regionCode: 'CL', name: 'Vacía' }) });
    expect(q('project-workspace')).not.toBeNull();
    expect(q('ws-settled')).toBeNull();
    expect(q('ws-collected')).toBeNull();
  });
});

describe('the number follows the money booked in the app', () => {
  it('adding a client payment in Zone B lowers what is left to collect at once and moves the line', async () => {
    await open(job({ payments: [], expenses: [], advances: [] }));
    const before = Number(q('ws-due').textContent.replace(/[^\d.]/g, ''));
    await click(q('ws-cash'));
    await click(q('cash-amount'));
    for (const k of ['1', '0', '0', '0']) await click(q(`pad-${k}`));
    await click(q('pad-done'));
    await click(q('cash-add'));
    const after = Number(q('ws-due').textContent.replace(/[^\d.]/g, ''));
    expect(before - after).toBeCloseTo(1000, 1);
    expect(q('ws-collected').textContent).toMatch(/1,000\.00/);
    expect(Number(q('ws-progress').dataset.pct)).toBeGreaterThan(0);
  });
});
