// @vitest-environment happy-dom
// "Pista de Liquidez Dual": under the big figure two 2 px lanes 1 px apart, the money collected (green) over the real physical progress of the
// Cronograma (ice-blue) with a dot at the end of each stage, and a two-item legend.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import HeaderZone from '../src/components/workspace/HeaderZone.jsx';
import { newProject } from '../src/lib/projects.js';
import { cashSummary } from '../src/lib/ledger.js';
import { headerModel, physicalProgress } from '../src/lib/workspaceModel.js';
import { getRegion } from '../src/lib/regions.js';
import { DICT } from '../src/lib/dict.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const phase = (id, startDate, endDate, done = false, name = id) => ({ id, name, startDate, endDate, done });
const withPhases = (phases, extra = {}) => ({ ...newProject({ regionCode: 'CL', name: 'Casa' }), phases, ...extra });

describe('physicalProgress: only what is really finished, weighted by days; 0 without data', () => {
  it('no phases (or junk) = 0 %, no nodes, never NaN', () => {
    for (const p of [newProject({ regionCode: 'CL' }), { phases: null }, { phases: 'x' }, {}, null, undefined]) {
      expect(physicalProgress(p)).toEqual({ pct: 0, count: 0, done: 0, nodes: [] });
    }
  });

  it('a phase weighs its calendar days (inclusive); a phase without both dates weighs 1; the done ones are the progress', () => {
    const p = withPhases([phase('a', '2026-03-02', '2026-03-04', true), phase('b', '2026-03-05', '2026-03-10'), phase('c', '', '')]);
    const r = physicalProgress(p); // 3 + 6 + 1 = 10 days; a is done
    expect(r.pct).toBeCloseTo(30);
    expect(r.count).toBe(3);
    expect(r.done).toBe(1);
    expect(r.nodes.map((n) => Math.round(n.at))).toEqual([30, 90, 100]);
    expect(r.nodes.map((n) => n.done)).toEqual([true, false, false]);
  });

  it('the stages go in chronological order (not the typed one) and all done = 100 %', () => {
    const p = withPhases([phase('late', '2026-04-01', '2026-04-02', true), phase('early', '2026-03-01', '2026-03-02', true)]);
    const r = physicalProgress(p);
    expect(r.nodes.map((n) => n.id)).toEqual(['early', 'late']);
    expect(r.pct).toBe(100);
    expect(r.nodes.at(-1).at).toBe(100);
  });

  it('headerModel carries it next to the two bars (which stay time + cash)', () => {
    const p = withPhases([phase('a', '2026-03-02', '2026-03-03', true), phase('b', '2026-03-04', '2026-03-05')]);
    const h = headerModel({ project: p, total: 1000, valid: true, cash: cashSummary(1000, []) });
    expect(h.bars.map((b) => b.id)).toEqual(['time', 'cash']);
    expect(h.physical.pct).toBe(50);
  });
});

describe('HeaderZone: the dual track', () => {
  let host;
  let root;
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const render = async (project, { total = 1000, valid = true, payments = [] } = {}) => {
    const model = headerModel({ project, total, valid, cash: valid ? cashSummary(total, payments) : null });
    await act(async () => {
      root.render(
        React.createElement(
          I18nProvider,
          { lang: 'es', regionCode: 'CL' },
          React.createElement(HeaderZone, { project, model, title: 'Casa', client: 'Ana', region: getRegion('CL'), offline: false, onEdit() {}, onCash() {}, onUnlock() {} })
        )
      );
    });
  };
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('two lanes of 2 px, 1 px apart, over the base of the header: green money lane above, blue physical lane below', async () => {
    await render(withPhases([phase('a', '2026-03-02', '2026-03-04', true), phase('b', '2026-03-05', '2026-03-10')]), { payments: [{ id: 'p1', amount: 250, at: 1, note: '' }] });
    const lanes = q('ws-lanes');
    expect(lanes.className).toMatch(/absolute/);
    expect(lanes.className).toContain('bottom-0');
    expect(lanes.className).toContain('gap-px'); // the 1 px of black between the lanes
    expect([...lanes.children].map((c) => c.getAttribute('data-testid'))).toEqual(['ws-progress', 'ws-physical']); // money above, work below
    for (const id of ['ws-progress', 'ws-physical']) {
      expect(q(id).className).toContain('h-0.5'); // 2 px
      expect(q(id).getAttribute('role')).toBe('progressbar');
    }
    expect(q('ws-progress-fill').className).toContain('bg-brand');
    expect(q('ws-physical-fill').className).toContain('bg-cyan-500');
    expect(q('ws-progress-fill').style.width).toBe('25%');
    expect(q('ws-physical-fill').style.width).toBe('33.33333333333333%'); // 3 of 9 days are finished
    expect(q('ws-physical').dataset.pct).toBe('33');
    expect(q('ws-physical').getAttribute('aria-valuenow')).toBe('33');
  });

  it('smooth: every fill animates its first appearance and its later changes (transition-all duration-500)', async () => {
    await render(withPhases([phase('a', '2026-03-02', '2026-03-04', true)]));
    for (const id of ['ws-progress-fill', 'ws-physical-fill']) {
      expect(q(id).className).toContain('transition-all');
      expect(q(id).className).toContain('duration-500');
      expect(q(id).className).toContain('lane-grow');
    }
    expect(readFileSync('src/index.css', 'utf8')).toMatch(/@keyframes lane-grow[\s\S]*scaleX\(0\)/);
  });

  it('stage nodes: a 3 px dot over the lane at the end of each stage (the line is one piece), bright when done, dim when pending', async () => {
    await render(withPhases([phase('a', '2026-03-02', '2026-03-04', true), phase('b', '2026-03-05', '2026-03-10')]));
    const nodes = [...host.querySelectorAll('[data-testid="ws-node"]')];
    expect(nodes).toHaveLength(2);
    expect(q('ws-physical').querySelectorAll('[data-testid="ws-physical-fill"]')).toHaveLength(1); // never cut into pieces
    for (const n of nodes) {
      expect(n.className).toContain('h-[3px]');
      expect(n.className).toContain('w-[3px]');
      expect(n.className).toContain('rounded-full');
      expect(n.className).toContain('absolute');
      expect(n.getAttribute('aria-hidden')).toBe('true');
    }
    expect(nodes[0].dataset.done).toBe('true');
    expect(nodes[0].className).toContain('bg-cyan-200');
    expect(nodes[1].dataset.done).toBeUndefined();
    expect(nodes[1].className).toContain('bg-cyan-500/50');
    expect(nodes[0].style.left).toBe('33.33333333333333%');
    expect(nodes[1].style.left).toBe('100%'); // its right edge rests on the end of the lane: never outside the screen
    expect(nodes[1].className).toContain('-translate-x-full');
  });

  it('no data: both lanes at 0 %, no nodes; the legend names both lines with their share', async () => {
    await render(newProject({ regionCode: 'CL', name: 'Nueva' }));
    expect(q('ws-progress-fill').style.width).toBe('0%');
    expect(q('ws-physical-fill').style.width).toBe('0%');
    expect(host.querySelectorAll('[data-testid="ws-node"]')).toHaveLength(0);
    expect(q('ws-legend-cash').textContent).toBe('Cobrado 0%');
    expect(q('ws-legend-physical').textContent).toBe('Avance físico 0%');
  });

  it('the legend: a green dot for what was collected, a blue dot for the physical progress', async () => {
    await render(withPhases([phase('a', '2026-03-02', '2026-03-03', true), phase('b', '2026-03-04', '2026-03-05')]), { payments: [{ id: 'p1', amount: 400, at: 1, note: '' }] });
    expect(q('ws-legend-cash').textContent).toBe('Cobrado 40%');
    expect(q('ws-legend-physical').textContent).toBe('Avance físico 50%');
    expect(q('ws-legend-cash').querySelector('span').className).toContain('bg-brand');
    expect(q('ws-legend-physical').querySelector('span').className).toContain('bg-cyan-500');
    expect(q('ws-legend').className).toContain('text-xs');
    expect(q('ws-legend').className).toContain('text-neutral-400');
  });

  it('a quote that is not valid yet: no invented money lane (or legend item), the physical lane is still there', async () => {
    await render(withPhases([phase('a', '2026-03-02', '2026-03-03', true)]), { valid: false });
    expect(q('ws-progress')).toBeNull();
    expect(q('ws-legend-cash')).toBeNull();
    expect(q('ws-physical')).not.toBeNull();
    expect(q('ws-legend-physical').textContent).toBe('Avance físico 100%');
  });

  it('junk in the model never breaks the lane (NaN / out of range widths clamp to 0-100)', async () => {
    const project = withPhases([]);
    const model = { ...headerModel({ project, total: 1000, valid: true, cash: cashSummary(1000, []) }), physical: { pct: NaN, count: 1, done: 0, nodes: [{ id: 'x', at: 250, done: false }, { id: 'y', at: -5, done: true }] } };
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(HeaderZone, { project, model, title: 'Casa', client: '', region: getRegion('CL'), offline: false, onEdit() {}, onCash() {}, onUnlock() {} })));
    });
    expect(q('ws-physical-fill').style.width).toBe('0%');
    expect([...host.querySelectorAll('[data-testid="ws-node"]')].map((n) => n.style.left)).toEqual(['100%', '0%']);
    expect(host.textContent).not.toMatch(/NaN/);
  });
});

describe('OLED contract + words', () => {
  it('the header has no new border / outline / grey background', () => {
    const src = readFileSync('src/components/workspace/HeaderZone.jsx', 'utf8');
    const lanes = src.slice(src.indexOf('Dual liquidity track'), src.indexOf('</header>'));
    expect(lanes).not.toMatch(/\bborder|outline|bg-(neutral|gray|zinc|slate|stone)-\d|tracking-wide|text-neutral-600/);
  });
  it('"Avance físico" exists in the six languages, translated', () => {
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) expect(DICT[l]['ws.lane.physical']?.length, l).toBeGreaterThan(5);
    expect(new Set(['es', 'en', 'pt', 'fr', 'it', 'de'].map((l) => DICT[l]['ws.lane.physical'])).size).toBe(6);
  });
});
