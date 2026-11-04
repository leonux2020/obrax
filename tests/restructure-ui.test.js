// @vitest-environment happy-dom
// The restructured screens: Dashboard + cards, new-project sheet, the project interior, the AI receipt flow
// and the global accounting export.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { typeInto as padType } from './helpers/appHarness.js';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import Dashboard from '../src/components/Dashboard.jsx';
import ProjectSheet from '../src/components/ProjectSheet.jsx';
import GlobalAccounting from '../src/components/GlobalAccounting.jsx';
import { newProject, toDayString } from '../src/lib/projects.js';
import { normalizeExpenses, dayOf } from '../src/lib/ledger.js';
import { LEVEL_COLOR } from '../src/components/levelStyle.js';

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
const type = (el, value) =>
  el.dataset?.numpad === 'true' ? padType(el, value) : act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const render = async (node) => {
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, node));
  });
  await flush();
};

const dayFrom = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toDayString(d);
};
const mk = (name, start, end, extra = {}) => ({ ...newProject({ regionCode: 'CL', name, client: 'Cli', startDate: dayFrom(start), endDate: dayFrom(end) }), ...extra });
const sized = (p) => {
  p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 };
  return p;
};

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

describe('Dashboard: counters instead of sentences, tabs, full-width clickable cards, FAB', () => {
  const projects = () => [
    mk('Atrasada', -30, -4),
    mk('Por vencer', -10, 2),
    mk('A tiempo 1', -5, 60),
    mk('A tiempo 2', -5, 90),
    mk('Futura', 10, 40),
    mk('Cerrada', -50, -40, { closedAt: Date.now() }),
  ];

  function Harness({ onOpen, onNew }) {
    const [tab, setTab] = useState('active');
    return React.createElement(Dashboard, { projects: projects(), tab, onTab: setTab, onNew, onOpen, onPro: () => {} });
  }

  it('shows red / orange / green / blue counters for ACTIVE projects only, with no status sentence', async () => {
    await render(React.createElement(Harness, { onOpen: () => {}, onNew: () => {} }));
    expect(['red', 'orange', 'green', 'future'].map((l) => q(`pill-${l}`).getAttribute('data-count'))).toEqual(['1', '1', '2', '1']);
    // no big visible title: the heading survives only for screen readers
    expect(host.querySelector('h1').textContent).toBe('Proyectos');
    expect(host.querySelector('h1').className).toContain('sr-only');
    expect(host.querySelector('h1').className).not.toMatch(/text-2xl/);
    // top bar (logo + PRO) and, right below, the triangles
    const main = host.querySelector('main');
    const kids = [...main.children];
    expect(kids[0].tagName).toBe('HEADER');
    expect(kids.find((k) => k.getAttribute?.('data-testid') === 'dash-pills')).toBeTruthy();
    expect(kids.filter((k) => k.tagName !== 'H1').indexOf(kids.find((k) => k.getAttribute?.('data-testid') === 'dash-pills'))).toBe(1);
    expect(host.querySelector('header img, header svg')).not.toBeNull();
    expect(host.textContent).not.toMatch(/proyectos? activos?|tienes \d/i);
  });

  it('indicators are small warning triangles: vivid state colour + number when > 0, EMPTY and dimmed at 0; undated started jobs count as on time', async () => {
    const list = [mk('Atrasada', -30, -4), mk('Sin fecha fin', -3, 0)];
    list[1].endDate = '';
    await render(React.createElement(Dashboard, { projects: list, tab: 'active', onTab: () => {}, onNew: () => {}, onOpen: () => {}, onPro: () => {} }));
    expect(q('pill-red').getAttribute('data-count')).toBe('1');
    expect(q('pill-green').getAttribute('data-count')).toBe('1'); // real dates: no end date = cannot be late
    expect(host.querySelectorAll('[data-testid="dash-pills"] svg polygon')).toHaveLength(4);
    const colors = { red: '#ff2b2b', orange: '#ff9500', green: '#00d95f', future: '#2d8cff' };
    for (const [level, color] of Object.entries(colors)) {
      const tri = q(`tri-${level}`);
      const li = q(`pill-${level}`);
      const n = Number(li.getAttribute('data-count'));
      expect(tri.getAttribute('stroke-width')).toBe('1.25'); // hairline
      expect(tri.getAttribute('fill')).toBe('none'); // OLED black / transparent inside
      expect(li.className).not.toMatch(/opacity|bg-/);
      expect(li.className).toContain('h-[54px]'); // small, not a giant rectangle
      if (n > 0) {
        expect(tri.getAttribute('stroke')).toBe(color); // vivid state colour
        expect(tri.getAttribute('stroke-opacity')).toBe('1');
        expect(li.textContent).toBe(String(n)); // the number, centred in the triangle
        expect(li.getAttribute('data-empty')).toBeNull();
      } else {
        expect(tri.getAttribute('stroke')).not.toBe(color); // neutral, muted
        expect(Number(tri.getAttribute('stroke-opacity'))).toBeLessThan(0.4);
        expect(li.textContent).toBe(''); // completely empty inside
        expect(li.getAttribute('data-empty')).toBe('true');
        expect(li.getAttribute('aria-label')).toMatch(/: 0$/); // screen readers still hear the zero
      }
    }
    const cards = qa('project-card');
    expect(cards.map((c) => c.getAttribute('data-level')).sort()).toEqual(['green', 'red']);
    for (const c of cards) expect(c.style.borderLeftColor).toMatch(/^(#|rgb)/);
    expect(Object.values(LEVEL_COLOR).slice(0, 4)).toEqual(Object.values(colors));
  });

  it('PRO button: titanium hard hat beside the label in a slim pill, subtle silver glow on hover / touch, always opens the plans screen', async () => {
    const onPro = vi.fn();
    await render(React.createElement(Dashboard, { projects: [], tab: 'active', onTab: () => {}, onNew: () => {}, onOpen: () => {}, onPro }));
    const btn = q('pro-scan');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.className).toContain('min-h-[44px]'); // 44 px touch area...
    const pill = q('pro-pill');
    expect(pill.className).toContain('h-9'); // ...around a slim 36 px pill
    expect(pill.className).not.toContain('flex-col'); // hat and label on ONE line
    const [hat, label] = [pill.firstElementChild, pill.lastElementChild];
    expect(hat.getAttribute('data-testid')).toBe('helmet-icon'); // left...
    expect(label.textContent).toBe('PRO'); // ...the text
    expect(pill.className).toMatch(/group-hover:shadow-\[0_0_\d+px_rgba\(203,213,225/); // silver glow
    expect(pill.className).toMatch(/group-active:shadow-/);
    expect(btn.outerHTML).not.toMatch(/d4af37|e8c35f|yellow|amber|rgba\(212,175,55/i); // no gold at all
    await click(btn);
    expect(onPro).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    root = createRoot(host);
    localStorage.setItem('cp.pro.sim.v1', '1'); // already PRO: still a button that opens the plans
    await render(React.createElement(Dashboard, { projects: [], tab: 'active', onTab: () => {}, onNew: () => {}, onOpen: () => {}, onPro }));
    expect(q('pro-active').tagName).toBe('BUTTON');
    await click(q('pro-active'));
    expect(onPro).toHaveBeenCalledTimes(2);
  });

  it('tabs switch Activos / Historial; closed jobs only live in the history', async () => {
    await render(React.createElement(Harness, { onOpen: () => {}, onNew: () => {} }));
    expect(qa('project-card')).toHaveLength(5);
    expect(qa('project-card').some((c) => c.textContent.includes('Cerrada'))).toBe(false);
    await click(q('tab-history'));
    expect(qa('project-card')).toHaveLength(1);
    expect(qa('project-card')[0].textContent).toContain('Cerrada');
    expect(qa('project-card')[0].getAttribute('data-level')).toBe('closed');
    await click(q('tab-active'));
    expect(qa('project-card')).toHaveLength(5);
  });

  it('tabs: Activos keeps the green underline, Historial gets a cement-grey one, the inactive tab is dimmed', async () => {
    await render(React.createElement(Harness, { onOpen: () => {}, onNew: () => {} }));
    const cls = (id) => q(id).className;
    expect(cls('tab-active')).toContain('border-brand');
    expect(cls('tab-active')).toContain('text-neutral-200');
    expect(cls('tab-history')).toContain('border-transparent');
    expect(cls('tab-history')).toContain('text-neutral-500'); // inactive: dimmed
    await click(q('tab-history'));
    expect(cls('tab-history')).toContain('border-neutral-500'); // NOT green
    expect(cls('tab-history')).not.toContain('border-brand');
    expect(cls('tab-history')).toContain('text-neutral-200');
    expect(cls('tab-active')).toContain('border-transparent');
    expect(cls('tab-active')).toContain('text-neutral-500');
    expect(cls('tab-active')).not.toContain('border-brand');
    await click(q('tab-active'));
    expect(cls('tab-active')).toContain('border-brand');
  });

  it('bottom navigation: the middle label is the short "Contabilidad" (the page keeps its full title), in every language', async () => {
    const { makeI18n } = await import('../src/lib/i18n.jsx');
    const short = { es: 'Contabilidad', en: 'Accounting', pt: 'Contabilidade', fr: 'Comptabilité', it: 'Contabilità', de: 'Buchhaltung' };
    for (const [lang, label] of Object.entries(short)) {
      expect(makeI18n(lang, 'IT').t('nav.accountingShort')).toBe(label);
      expect(makeI18n(lang, 'IT').t('nav.accounting')).not.toBe(label); // the title of the screen is unchanged
    }
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/components/BottomNav.jsx', 'utf8');
    expect(src).toContain("t('nav.accountingShort')");
    expect(src).toMatch(/text-center/);
  });

  it('cards: the whole card is the only button, thick LEFT stripe in the state colour (nothing on the bottom), flag and late days', async () => {
    const opened = [];
    await render(React.createElement(Harness, { onOpen: (id) => opened.push(id), onNew: () => {} }));
    const cards = qa('project-card');
    for (const c of cards) {
      expect(c.tagName).toBe('BUTTON');
      expect(c.className).toContain('w-full');
      expect(c.className).toContain('border-l-2'); // a thin neon thread on the left (never a thick bar)...
      expect(c.className).not.toContain('border-l-[6px]');
      expect(c.className).not.toMatch(/border-b-\[|border-b-\d/); // ...and no coloured/thick bottom edge any more
      expect(c.style.borderBottomColor).toBe('');
      expect(c.className).toMatch(/\bborder\b/); // ...on a 1px perimeter
      expect(c.className).toMatch(/\bpl-4\b/); // the text breathes next to the stripe
      expect(c.className).toContain('border-white/10'); // hairline, neutral
      expect(c.className).toContain('bg-transparent'); // no solid fill
      expect(c.className).not.toMatch(/bg-(black|gradient)|from-|border-2|border-b-\[8px\]/);
      expect(c.style.borderColor).toBe(''); // the state colour is ONLY on the left edge
      const probe = document.createElement('div');
      probe.style.borderLeftColor = LEVEL_COLOR[c.getAttribute('data-level')];
      expect(c.style.borderLeftColor).not.toBe('');
      expect(c.style.borderLeftColor).toBe(probe.style.borderLeftColor); // same colour logic as before, per state
      expect(c.querySelector('[data-testid="card-detail"]').style.color).toBe(''); // detail text is neutral too
      expect(c.querySelectorAll('button')).toHaveLength(0); // no Abrir / Editar inside
      expect(c.querySelector('[data-testid="card-flag"]').textContent).toBe('🇨🇱');
    }
    const late = cards.find((c) => c.getAttribute('data-level') === 'red');
    expect(late.style.borderLeftColor).not.toBe('');
    expect(late.querySelector('[data-testid="card-detail"]').textContent).toContain('4');
    expect(LEVEL_COLOR.red).toBe('#ff2b2b');
    expect(cards.find((c) => c.getAttribute('data-level') === 'future')).toBeTruthy();
    await click(late);
    expect(opened).toHaveLength(1);
  });

  it('the FAB creates a project and a rented tool due today shows an hourglass on the card', async () => {
    const onNew = vi.fn();
    const rental = normalizeExpenses([{ amount: 10, category: 'tool_rental', returnDate: dayOf(Date.now()) }]);
    await render(React.createElement(Dashboard, { projects: [mk('Con alquiler', -1, 20, { expenses: rental }), mk('Sin alquiler', -1, 20)], tab: 'active', onTab: () => {}, onNew, onOpen: () => {}, onPro: () => {} }));
    await click(q('fab-new'));
    expect(onNew).toHaveBeenCalledTimes(1);
    const [withRental, without] = qa('project-card');
    expect([withRental, without].map((c) => c.querySelectorAll('[data-testid="hourglass"]').length).sort()).toEqual([0, 1]);
  });
});

describe('New project sheet: agile form, no money', () => {
  it('name, client, visual mode selector, dates and the city target that fills the name AND saves the point; saves one payload', async () => {
    const saved = [];
    const locate = vi.fn().mockResolvedValue({ lat: -33.4489, lng: -70.6693 });
    const reverse = vi.fn().mockResolvedValue('Valparaíso');
    await render(React.createElement(ProjectSheet, { onSave: (p) => saved.push(p), onClose: () => {}, locate, reverse }));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.querySelectorAll('input[type="date"]')).toHaveLength(2);
    expect(dialog.querySelectorAll('[role="radio"]')).toHaveLength(2);
    expect(document.body.textContent).toContain('Partida Única');
    expect(document.body.textContent).toContain('Proyecto Completo');
    expect(document.body.textContent).not.toMatch(/presupuesto|precio|\$|%/i); // zero financial fields here
    const doc = document;
    const text = [...doc.querySelectorAll('[role="dialog"] input[type="text"]')];
    await type(text[0], 'Casa Lo Barnechea');
    await type(text[1], 'María');
    expect(text).toHaveLength(4); // name, client, the country / market combobox, "Ciudad o Región de la Obra"
    await click(doc.querySelector('[data-testid="mode-project"]'));
    expect(doc.querySelector('[data-testid="mode-project"]').getAttribute('aria-checked')).toBe('true');
    await click(doc.querySelector('[data-testid="project-city-locate"]'));
    await flush(5);
    expect(locate).toHaveBeenCalled();
    expect(doc.querySelector('[data-testid="project-city"]').value).toBe('Valparaíso');
    expect(doc.querySelector('[data-testid="project-locate"]')).toBeNull(); // the old big GPS button is gone
    await click(doc.querySelector('[data-testid="project-save"]'));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Casa Lo Barnechea', client: 'María', mode: 'project', cityOrRegion: 'Valparaíso', location: { lat: -33.4489, lng: -70.6693, label: 'Valparaíso' }, regionCode: 'CL' });
  });

  it('a refused location is a small message, not a blocker; editing shows the closed / unfreeze switches', async () => {
    const locate = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'denied' }));
    await render(React.createElement(ProjectSheet, { onSave: () => {}, onClose: () => {}, locate }));
    await click(document.querySelector('[data-testid="project-city-locate"]'));
    await flush(5);
    expect(document.querySelector('[data-testid="project-city-error"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="project-save"]').disabled).toBe(false);
    expect(document.querySelector('[data-testid="project-closed"]')).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    const p = sized(mk('Obra', 0, 10));
    p.draft.frozen = { at: 1, pricedAt: 1, total: 1, timeline: { startDate: '', endDate: '' } };
    await render(React.createElement(ProjectSheet, { project: p, onSave: () => {}, onDelete: () => {}, onClose: () => {} }));
    expect(document.querySelector('[data-testid="project-closed"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="project-unfreeze"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="mode-selector"]')).toBeNull(); // the type is chosen once, at creation
  });
});

describe('Edit modal (the pencil)', () => {
  it('opens a clean full-height modal with name, client, dates and location in labelled sections', async () => {
    const saved = [];
    const p = { ...sized(mk('Casa', -2, 30)), cityOrRegion: 'Valparaíso', location: { lat: -33.4489, lng: -70.6693, label: 'Valparaíso' } };
    await render(React.createElement(ProjectSheet, { project: p, onSave: (v) => saved.push(v), onDelete: () => {}, onClose: () => {}, locate: async () => ({ lat: 10, lng: 20 }), reverse: async () => 'Roma' }));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.className).toContain('h-[100dvh]');
    const headings = [...dialog.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual(['Datos de la obra', 'Fechas', 'Ubicación', 'Estado de la obra']);
    expect(dialog.querySelectorAll('input[type="text"]')).toHaveLength(4); // name + client + the market combobox + city/region
    expect(dialog.querySelectorAll('input[type="date"]')).toHaveLength(2);
    expect(document.querySelector('[data-testid="project-locate"]')).toBeNull();
    await click(document.querySelector('[data-testid="project-city-locate"]'));
    await flush(5);
    expect(document.querySelector('[data-testid="project-city"]').value).toBe('Roma');
    await click(document.querySelector('[data-testid="project-save"]'));
    expect(saved[0]).toMatchObject({ name: 'Casa', cityOrRegion: 'Roma', location: { lat: 10, lng: 20, label: 'Roma' } });
  });
});

describe('Contabilidad Global: pick several projects, one consolidated Excel that goes to Drive (never downloaded)', () => {
  it('hands only the ticked projects to the Drive delivery; navigator.share and downloads are not used', async () => {
    const shared = [];
    Object.defineProperty(navigator, 'share', { value: async (data) => shared.push(data), configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    const a = sized(mk('Uno', -1, 10));
    const b = sized(mk('Dos', -1, 10));
    const c = sized(mk('Tres', -1, 10));
    const onExportGlobal = vi.fn(async () => ({ status: 'uploaded' }));
    await render(React.createElement(GlobalAccounting, { projects: [a, b, c], onExportGlobal }));
    expect(q('acc-export').disabled).toBe(true);
    await click(q(`acc-check-${a.id}`));
    await click(q(`acc-check-${c.id}`));
    expect(q('acc-export').textContent).toContain('2');
    await click(q('acc-export'));
    await flush(30);
    expect(onExportGlobal).toHaveBeenCalledTimes(1);
    expect(onExportGlobal.mock.calls[0][0]).toEqual([a.id, c.id]);
    expect(shared).toHaveLength(0);
    expect(q('acc-export').disabled).toBe(false); // released
    await click(q('acc-all'));
    expect(q('acc-export').textContent).toContain('3');
    delete navigator.share;
    delete navigator.canShare;
  });

  it('with no projects there is nothing to export', async () => {
    await render(React.createElement(GlobalAccounting, { projects: [] }));
    expect(q('acc-empty')).not.toBeNull();
    expect(q('acc-export')).toBeNull();
  });
});
