// @vitest-environment happy-dom
// Zone A: the Caja indicator shows the percentage AND the real cash on hand (client payments - expenses - worker advances),
// in the money of the project's own market.
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

describe('Zone A: "Caja 25 % · $ 1.500"', () => {
  it('shows the percentage and the cash on hand in the currency of the project (MX, while the app is CL)', async () => {
    await open(job());
    const bar = q('bar-cash');
    expect(bar).not.toBeNull();
    const liquid = q('cash-liquid');
    expect(liquid.dataset.liquid).toBe('32000');
    expect(liquid.textContent).toMatch(/\$\s?32,000\.00/); // es-MX / MXN with cents, not the Chilean peso
    expect(bar.textContent).toContain('Caja');
    expect(bar.textContent).toMatch(/\d+ %/);
    expect(bar.textContent.indexOf('%')).toBeLessThan(bar.textContent.indexOf('32,000')); // percentage first, amount after
    expect(liquid.dataset.negative).toBeUndefined();
  });

  it('the amount is quiet: dim text on the OLED black header, no grey backgrounds', async () => {
    await open(job());
    const liquid = q('cash-liquid');
    expect(liquid.className).toContain('text-sm');
    expect(liquid.className).toContain('text-[#E0E0E0]/60');
    expect(liquid.className).not.toMatch(/bg-/);
    expect(q('ws-zone-a').className).toContain('bg-black');
  });

  it('expenses and worker advances are subtracted: without them it would read 40,000', async () => {
    await open(job({ expenses: [], advances: [] }));
    expect(q('cash-liquid').dataset.liquid).toBe('40000');
    expect(q('cash-liquid').textContent).toMatch(/40,000\.00/);
  });

  it('negative (expenses above what the client paid) is shown with its sign, in the amber warning tone', async () => {
    await open(job({ payments: [], expenses: [{ id: 'exp001', at: 1, supplier: 'HD', description: 'Taladro', amount: 5000, category: 'tool_rental', returnDate: '', returned: true }], advances: [{ id: 'adv001', worker: 'Juan', amount: 3000, at: 1 }] }));
    const liquid = q('cash-liquid');
    expect(liquid.dataset.liquid).toBe('-8000');
    expect(liquid.dataset.negative).toBe('true');
    expect(liquid.textContent).toMatch(/-\s?\$\s?8,000\.00|\$\s?-8,000\.00|−/);
    expect(liquid.className).toContain('text-[#e8c35f]/80');
  });

  it('empty cash (0): shows 0 in the right currency without errors; a brand-new project draws nothing at all', async () => {
    await open(job({ payments: [], expenses: [], advances: [] }));
    expect(q('cash-liquid').dataset.liquid).toBe('0');
    expect(q('cash-liquid').textContent).toMatch(/\$\s?0\.00/);
    expect(q('bar-cash').dataset.pct).toBe('0');
    expect(q('cash-liquid').textContent).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('a project whose quote is not valid yet still shows the cash on hand (no percentage)', async () => {
    const empty = newProject({ regionCode: 'CL', name: 'Nueva' });
    await open({ ...empty, payments: [{ id: 'pay001', amount: 150000, at: 1, note: '' }] });
    expect(q('bar-cash')).not.toBeNull();
    expect(q('bar-cash').dataset.pct).toBeUndefined();
    expect(q('cash-liquid').dataset.liquid).toBe('150000');
    expect(q('cash-liquid').textContent).not.toContain('·');
  });

  it('a brand-new project with no money and no valid quote draws no Caja bar at all (and does not fail)', async () => {
    await open({ ...newProject({ regionCode: 'CL', name: 'Vacía' }) });
    expect(q('project-workspace')).not.toBeNull();
    expect(q('bar-cash')).toBeNull();
    expect(q('cash-liquid')).toBeNull();
  });
});

describe('the number follows the money booked in the app', () => {
  it('adding a client payment in Zone B raises it at once; the bar and the amount move together', async () => {
    await open(job({ payments: [], expenses: [], advances: [] }));
    await click(q('ws-cash').querySelector('summary'));
    expect(q('cash-liquid').dataset.liquid).toBe('0');
    await click(q('cash-amount'));
    for (const k of ['1', '0', '0', '0']) await click(q(`pad-${k}`));
    await click(q('pad-done'));
    await click(q('cash-add'));
    expect(q('cash-liquid').dataset.liquid).toBe('1000');
    expect(q('cash-liquid').textContent).toMatch(/1,000\.00/);
  });
});
