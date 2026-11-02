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
  const mount = (projects, lang = 'it', onOpen = () => {}) =>
    act(async () => {
      root.render(h(I18nProvider, { lang, regionCode: 'CL' }, h(Dashboard, { projects, tab: 'active', onTab: () => {}, onNew: () => {}, onOpen, onPro: () => {} })));
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

  it('the new keys exist in the six languages with the same placeholders', async () => {
    const { DICT: all } = await import('../src/lib/dict.js');
    for (const k of ['ws.alerts.title', 'ws.alerts.none', 'ws.alert.rentalToday', 'ws.alert.rentalLate']) {
      for (const lang of ['es', 'en', 'pt', 'fr', 'it', 'de']) expect(all[lang][k], `${lang}:${k}`).toBeTruthy();
    }
    expect(DICT.it['ws.alerts.title']).toBe('Allarmi');
    expect(DICT.it['ws.alerts.none']).toBe('Nessun allarme per oggi');
  });
});
