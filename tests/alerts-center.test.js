// @vitest-environment happy-dom
// Zero Stress alerts: the project tray exists ONLY with real exceptions; the Dashboard has a bell (left of PRO) that opens the
// global Action Center ("Allarmi" / "Nessun allarme per oggi").
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import AlertTray from '../src/components/workspace/AlertTray.jsx';
import Dashboard from '../src/components/Dashboard.jsx';
import { newProject, toDayString } from '../src/lib/projects.js';
import { projectAlerts } from '../src/lib/alerts.js';
import { DICT } from '../src/lib/dict.js';
import { click, q } from './helpers/appHarness.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const day = (n) => toDayString(new Date(Date.now() + n * 86400000));

describe('AlertTray', () => {
  let host;
  let root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const render = (node, lang = 'es') =>
    act(async () => {
      root.render(h(I18nProvider, { lang, regionCode: 'CL' }, node));
    });

  it('renders null with no alerts (undefined, null or empty): absolute visual silence', async () => {
    for (const alerts of [undefined, null, []]) {
      await render(h(AlertTray, { alerts }));
      expect(host.innerHTML).toBe('');
    }
  });

  it('renders one amber row per real alert and no hard-coded mock text exists any more', async () => {
    await render(h(AlertTray, { alerts: [{ id: 'a', text: 'Algo vence' }, { id: 'b', text: 'Otra cosa' }] }));
    expect([...host.querySelectorAll('[data-testid="ws-alert"]')].map((n) => n.textContent)).toEqual(['Algo vence', 'Otra cosa']);
    expect(readFileSync('src/components/workspace/AlertTray.jsx', 'utf8')).not.toMatch(/ESCAVATORE|MOCK/i);
  });
});

describe('projectAlerts', () => {
  const t = (key, p) => `${key}|${p?.name ?? ''}`;
  const proj = (expenses) => ({ ...newProject({ regionCode: 'CL', name: 'X' }), expenses });
  const rent = (id, returnDate, extra = {}) => ({ id, description: id, category: 'tool_rental', returnDate, returned: false, ...extra });

  it('only rentals due today or overdue and not returned; a future / returned / non-rental expense is silent', () => {
    const list = projectAlerts(proj([rent('hoy', day(0)), rent('tarde', day(-2)), rent('futuro', day(3)), rent('devuelto', day(0), { returned: true }), { id: 'x', category: 'materials', returnDate: day(-1) }]), t);
    expect(list.map((a) => [a.id, a.level])).toEqual([['rental-hoy', 'today'], ['rental-tarde', 'late']]);
    expect(list[0].text).toBe('ws.alert.rentalToday|hoy');
    expect(list[1].text).toBe('ws.alert.rentalLate|tarde');
    expect(projectAlerts(proj([]), t)).toEqual([]);
  });

  const tt = (key, p) => `${key}|${p?.name ?? ''}|${p?.amount ?? ''}`;
  const money = (n) => `$${n}`;

  it('late collection: balance pending and >15 days without a payment -> "client · amount"; silent without budget, paid or recent', () => {
    const old = { ...newProject({ regionCode: 'CL', name: 'Casa', client: 'Ana' }), createdAt: Date.now() - 30 * 86400000 };
    expect(projectAlerts(old, tt, { budget: 1000, money }).map((a) => [a.kind, a.text])).toEqual([['collection', 'ws.alert.collection|Ana|$1000']]);
    expect(projectAlerts({ ...old, client: undefined, draft: { ...old.draft, project: { name: 'Casa', client: '' } } }, tt, { budget: 1000, money })[0].text).toBe('ws.alert.collection|Casa|$1000'); // no client: the project name
    expect(projectAlerts(old, tt, { budget: null, money })).toEqual([]);
    expect(projectAlerts({ ...old, payments: [{ id: 'p', amount: 1000, at: Date.now() }] }, tt, { budget: 1000, money })).toEqual([]);
    expect(projectAlerts({ ...old, createdAt: Date.now() - 3 * 86400000 }, tt, { budget: 1000, money })).toEqual([]);
    expect(projectAlerts({ ...old, closedAt: Date.now() }, tt, { budget: 1000, money })).toEqual([]);
  });

  it('deadline: exceeded end date -> late; plan that cannot fit -> short; never both; a finished project is silent', () => {
    const over = newProject({ regionCode: 'CL', name: 'Torre', startDate: day(-20), endDate: day(-2) });
    expect(projectAlerts(over, tt).map((a) => [a.kind, a.level, a.text])).toEqual([['deadline', 'late', 'ws.alert.deadlineLate|Torre|']]);
    expect(projectAlerts(over, tt, { fits: false }).map((a) => a.text)).toEqual(['ws.alert.deadlineLate|Torre|']);
    const tight = newProject({ regionCode: 'CL', name: 'Torre', startDate: day(-1), endDate: day(5) });
    expect(projectAlerts(tight, tt)).toEqual([]);
    expect(projectAlerts(tight, tt, { fits: true })).toEqual([]);
    expect(projectAlerts(tight, tt, { fits: false }).map((a) => [a.level, a.text])).toEqual([['short', 'ws.alert.deadlineShort|Torre|']]);
    expect(projectAlerts({ ...over, closedAt: Date.now() }, tt, { fits: false })).toEqual([]);
  });

  it('receipts: only review / failed rows of THIS project; pending, sending and other projects stay silent', () => {
    const p = proj([]);
    const queue = [
      { id: 'a', projectId: p.id, status: 'review' },
      { id: 'b', projectId: p.id, status: 'failed' },
      { id: 'c', projectId: p.id, status: 'pending' },
      { id: 'd', projectId: p.id, status: 'sending' },
      { id: 'e', projectId: 'otro', status: 'failed' },
    ];
    expect(projectAlerts(p, tt, { queue }).map((a) => [a.id, a.kind, a.text])).toEqual([
      ['receipt-a', 'receipt', 'ws.alert.receiptReview||'],
      ['receipt-b', 'receipt', 'ws.alert.receiptFailed||'],
    ]);
  });
});

describe('Dashboard bell + GlobalAlerts', () => {
  let host;
  let root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const mount = (projects, lang = 'it', onOpen = () => {}, receiptRows = []) =>
    act(async () => {
      root.render(h(I18nProvider, { lang, regionCode: 'CL' }, h(Dashboard, { projects, tab: 'active', onTab: () => {}, onNew: () => {}, onOpen, onPro: () => {}, receiptRows })));
    });
  const withRental = () => ({ ...newProject({ regionCode: 'CL', name: 'Casa Pérez', startDate: day(-3), endDate: day(10) }), expenses: [{ id: 'e1', description: 'Taladro', category: 'tool_rental', returnDate: day(0), returned: false }] });

  it('the bell is an outline SVG (1.5 px) right before the PRO button in the header', async () => {
    await mount([]);
    const bell = q('dash-bell');
    const pro = q('pro-scan');
    expect(bell).not.toBeNull();
    expect(bell.nextElementSibling).toBe(pro); // just to the left of PRO
    const svg = bell.querySelector('svg');
    expect(svg.getAttribute('stroke-width')).toBe('1.5');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(bell.className).toContain('min-h-[52px]');
    expect(q('dash-bell-dot')).toBeNull(); // nothing to report: no dot
  });

  it('opens the Action Center: title "Allarmi", dim centred "Nessun allarme per oggi", and it closes', async () => {
    await mount([]);
    expect(q('global-alerts')).toBeNull();
    await click(q('dash-bell'));
    const view = q('global-alerts');
    expect(view).not.toBeNull();
    expect(view.querySelector('h1').textContent).toBe('Allarmi');
    const empty = q('global-alerts-empty');
    expect(empty.textContent).toBe('Nessun allarme per oggi');
    expect(empty.className).toContain('text-neutral-500');
    expect(empty.className).toContain('text-center');
    await click(q('global-alerts-close'));
    expect(q('global-alerts')).toBeNull();
  });

  it('with a real rental due, the bell shows an amber dot and the centre lists it; tapping opens that project', async () => {
    const p = withRental();
    const opened = [];
    await mount([p], 'it', (id) => opened.push(id));
    expect(q('dash-bell-dot')).not.toBeNull();
    await click(q('dash-bell'));
    expect(q('global-alerts-empty')).toBeNull();
    const row = q('global-alert');
    expect(row.textContent).toContain('Casa Pérez');
    expect(row.textContent).toContain('Restituzione di Taladro: scade oggi');
    await click(row);
    expect(opened).toEqual([p.id]);
    expect(q('global-alerts')).toBeNull();
  });

  it('the global bell also lists an exceeded deadline and failed / review receipts (and the project is opened by tapping)', async () => {
    const late = newProject({ regionCode: 'CL', name: 'Torre Sur', startDate: day(-20), endDate: day(-2) });
    const other = newProject({ regionCode: 'CL', name: 'Casa Norte', startDate: day(-1), endDate: day(30) });
    const rows = [{ id: 'r1', projectId: other.id, status: 'failed' }, { id: 'r2', projectId: other.id, status: 'review' }, { id: 'r3', projectId: other.id, status: 'pending' }];
    await mount([late, other], 'es', () => {}, rows);
    expect(q('dash-bell-dot')).not.toBeNull();
    await click(q('dash-bell'));
    const items = [...document.querySelectorAll('[data-testid="global-alert"]')].map((n) => [n.dataset.kind, n.textContent]);
    expect(items.map((i) => i[0])).toEqual(['deadline', 'receipt', 'receipt']);
    expect(items[0][1]).toContain('Plazo excedido: Torre Sur');
    expect(items[1][1]).toContain('Boleta fallida');
    expect(items[2][1]).toContain('Boleta pendiente de revisión');
    expect(items[1][1]).toContain('Casa Norte');
  });

  it('an old project WITHOUT a valid budget raises no collection alert (an amount is never invented)', async () => {
    const { projectSummary } = await import('../src/lib/projectTotals.js');
    const base = newProject({ regionCode: 'CL', name: 'Casa', client: 'Ana', startDate: day(-30), endDate: day(30) });
    const p = { ...base, createdAt: Date.now() - 40 * 86400000 };
    expect(projectSummary(p).total).toBeNull();
    await mount([p], 'es');
    expect(q('dash-bell-dot')).toBeNull();
  });

  it('the new keys exist in the six languages with the same placeholders', async () => {
    const { DICT: all } = await import('../src/lib/dict.js');
    for (const k of ['ws.alerts.title', 'ws.alerts.none', 'ws.alert.rentalToday', 'ws.alert.rentalLate', 'ws.alert.collection', 'ws.alert.deadlineLate', 'ws.alert.deadlineShort', 'ws.alert.receiptReview', 'ws.alert.receiptFailed']) {
      for (const lang of ['es', 'en', 'pt', 'fr', 'it', 'de']) expect(all[lang][k], `${lang}:${k}`).toBeTruthy();
    }
    expect(DICT.it['ws.alerts.title']).toBe('Allarmi');
    expect(DICT.it['ws.alerts.none']).toBe('Nessun allarme per oggi');
  });
});
