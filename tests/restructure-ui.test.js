// @vitest-environment happy-dom
// The restructured screens: Dashboard + cards, new-project sheet, the project interior, the AI receipt flow
// and the global accounting export.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import Dashboard from '../src/components/Dashboard.jsx';
import ProjectSheet from '../src/components/ProjectSheet.jsx';
import ProjectView from '../src/components/ProjectView.jsx';
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
  act(() => {
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
    expect(host.querySelector('h1').textContent).toBe('Proyectos');
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
      expect(tri.getAttribute('stroke-width')).toBe('2');
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
    for (const c of cards) expect(c.style.borderBottomColor).toMatch(/^(#|rgb)/);
    expect(Object.values(LEVEL_COLOR).slice(0, 4)).toEqual(Object.values(colors));
  });

  it('PRO button: gold hard hat right above the label, subtle gold glow on hover / touch, always opens the plans screen', async () => {
    const onPro = vi.fn();
    await render(React.createElement(Dashboard, { projects: [], tab: 'active', onTab: () => {}, onNew: () => {}, onOpen: () => {}, onPro }));
    const btn = q('pro-scan');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.className).toContain('flex-col');
    const [hat, label] = [btn.firstElementChild, btn.lastElementChild];
    expect(hat.getAttribute('data-testid')).toBe('helmet-icon'); // above...
    expect(label.textContent).toBe('PRO'); // ...the text
    expect(btn.className).toMatch(/hover:shadow-\[0_0_\d+px_rgba\(212,175,55/);
    expect(btn.className).toMatch(/active:shadow-/);
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

  it('cards: the whole card is the only button, thick bottom border in the state colour, flag and late days', async () => {
    const opened = [];
    await render(React.createElement(Harness, { onOpen: (id) => opened.push(id), onNew: () => {} }));
    const cards = qa('project-card');
    for (const c of cards) {
      expect(c.tagName).toBe('BUTTON');
      expect(c.className).toContain('w-full');
      expect(c.className).toContain('border-b-[3px]'); // slightly thicker bottom edge...
      expect(c.className).toMatch(/\bborder\b/); // ...on a 1px perimeter
      expect(c.className).toContain('border-white/10'); // hairline, neutral
      expect(c.className).toContain('bg-transparent'); // no solid fill
      expect(c.className).not.toMatch(/bg-(black|gradient)|from-|border-2|border-b-\[8px\]/);
      expect(c.style.borderColor).toBe(''); // the state colour is ONLY on the bottom edge
      expect(c.style.borderBottomColor).not.toBe('');
      expect(c.querySelector('[data-testid="card-detail"]').style.color).toBe(''); // detail text is neutral too
      expect(c.querySelectorAll('button')).toHaveLength(0); // no Abrir / Editar inside
      expect(c.querySelector('[data-testid="card-flag"]').textContent).toBe('🇨🇱');
    }
    const late = cards.find((c) => c.getAttribute('data-level') === 'red');
    expect(late.style.borderBottomColor).not.toBe('');
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
  it('name, client, visual mode selector, dates and a one-tap current location; saves one payload', async () => {
    const saved = [];
    const locate = vi.fn().mockResolvedValue({ lat: -33.4489, lng: -70.6693 });
    await render(React.createElement(ProjectSheet, { onSave: (p) => saved.push(p), onClose: () => {}, locate }));
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
    expect(text).toHaveLength(3); // name, client, "Ciudad o Región de la Obra"
    await type(doc.querySelector('[data-testid="project-city"]'), 'Valparaíso');
    await click(doc.querySelector('[data-testid="mode-project"]'));
    expect(doc.querySelector('[data-testid="mode-project"]').getAttribute('aria-checked')).toBe('true');
    await click(doc.querySelector('[data-testid="project-locate"]'));
    expect(locate).toHaveBeenCalled();
    expect(doc.querySelector('[data-testid="project-location"]').textContent).toContain('-33.4489');
    await click(doc.querySelector('[data-testid="project-save"]'));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Casa Lo Barnechea', client: 'María', mode: 'project', cityOrRegion: 'Valparaíso', location: { lat: -33.4489, lng: -70.6693 } });
  });

  it('a refused location is a small message, not a blocker; editing shows the closed / unfreeze switches', async () => {
    const locate = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'denied' }));
    await render(React.createElement(ProjectSheet, { onSave: () => {}, onClose: () => {}, locate }));
    await click(document.querySelector('[data-testid="project-locate"]'));
    expect(document.querySelector('[data-testid="project-locate-error"]')).not.toBeNull();
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
    const p = { ...sized(mk('Casa', -2, 30)), location: { lat: -33.4489, lng: -70.6693, label: '' } };
    await render(React.createElement(ProjectSheet, { project: p, onSave: (v) => saved.push(v), onDelete: () => {}, onClose: () => {}, locate: async () => ({ lat: 10, lng: 20 }) }));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.className).toContain('h-[100dvh]');
    const headings = [...dialog.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual(['Datos de la obra', 'Fechas', 'Ubicación', 'Estado de la obra']);
    expect(dialog.querySelectorAll('input[type="text"]')).toHaveLength(3); // name + client + city/region
    expect(dialog.querySelectorAll('input[type="date"]')).toHaveLength(2);
    expect(document.querySelector('[data-testid="project-location"]').textContent).toContain('-33.4489');
    await click(document.querySelector('[data-testid="project-locate"]'));
    expect(document.querySelector('[data-testid="project-location"]').textContent).toContain('10.0000');
    await click(document.querySelector('[data-testid="project-save"]'));
    expect(saved[0]).toMatchObject({ name: 'Casa', location: { lat: 10, lng: 20 } });
  });
});

describe('Project interior', () => {
  const photos = [];
  function Harness({ initial, onEdit = () => {}, onEditor = () => {}, onPro = () => {}, extra = {} }) {
    const [project, setProject] = useState(initial);
    const setDraft = (fn) => setProject((p) => ({ ...p, draft: typeof fn === 'function' ? fn(p.draft) : fn }));
    return React.createElement(ProjectView, { project, setProject, setDraft, photos, setPhotos: () => {}, company: null, onBack: () => {}, onEdit, onEditor, onPro, ...extra });
  }
  const order = () => [...host.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid'));
  const before = (a, b) => order().indexOf(a) < order().indexOf(b);

  it('vertical order, pencil at the top right, status pill, budget total, no Open/Edit text buttons', async () => {
    const onEdit = vi.fn();
    await render(React.createElement(Harness, { initial: sized(mk('Casa', -2, 30)), onEdit }));
    for (const [a, b] of [['pv-edit', 'pv-status'], ['pv-status', 'budget-total'], ['budget-total', 'cash-bar'], ['cash-bar', 'selectors'], ['selectors', 'scan-receipt'], ['scan-receipt', 'supply-list'], ['supply-list', 'snap-grid'], ['snap-grid', 'log-input'], ['log-input', 'export-rendition'], ['export-rendition', 'pdf-generate']]) {
      expect(before(a, b), `${a} before ${b}`).toBe(true);
    }
    expect(q('budget-total').textContent).toMatch(/\d/);
    await click(q('pv-edit'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(q('pdf-generate').closest('.fixed').className).toContain('bottom-0');
  });

  it('Control de Caja: payments move the interactive progress bar and the pending amount', async () => {
    await render(React.createElement(Harness, { initial: sized(mk('Casa', -2, 30)) }));
    expect(q('cash-fill').getAttribute('data-pct')).toBe('0');
    await click(q('cash-bar'));
    expect(q('cash-sheet')).not.toBeNull();
    const field = document.querySelector('[data-testid="cash-sheet"] input');
    await type(field, '1000000');
    await click(q('cash-add'));
    expect(q('cash-list').querySelectorAll('li')).toHaveLength(1);
    const pct = Number(q('cash-fill').getAttribute('data-pct'));
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it('Mano de Obra: the hidden accordion adds an advance (worker + amount) and discounts it from the visible pool', async () => {
    await render(React.createElement(Harness, { initial: sized(mk('Casa', -2, 30)) }));
    expect(q('advances-panel')).toBeNull(); // hidden by default
    const pool0 = Number(q('labor-pool').getAttribute('data-available'));
    expect(pool0).toBeGreaterThan(0);
    await click(q('advances-toggle'));
    const inputs = q('advances-panel').querySelectorAll('input');
    await type(inputs[0], 'Juan Pérez');
    await type(inputs[1], '20000');
    expect(q('advance-date').value).toBe(toDayString(new Date())); // pre-filled with today
    await type(q('advance-date'), '2026-09-15'); // ...and editable
    await click(q('advance-add'));
    expect(q('advance-list').textContent).toContain('Juan Pérez');
    expect(q('advance-list').textContent).toMatch(/15/); // the chosen date is shown
    expect(q('advance-date').value).toBe(toDayString(new Date())); // the form resets to today
    expect(Number(q('labor-pool').getAttribute('data-available'))).toBe(pool0 - 20000);
  });

  const slide = (el, value) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('Mano de Obra / Imprevistos / Utilidad are single continuous sliders (no button grids); the number sits next to the title', async () => {
    await render(React.createElement(Harness, { initial: sized(mk('Casa', -2, 30)) }));
    const sel = q('selectors');
    expect(sel.querySelectorAll('button[role="radio"]')).toHaveLength(0);
    const ranges = [...sel.querySelectorAll('input[type="range"]')];
    expect(ranges).toHaveLength(3);
    for (const r of ranges) expect(r.getAttribute('step')).toBe('1');
    expect(q('slider-labor-value').textContent).toBe('35%');
    const pillCls = q('slider-labor-value').className;
    for (const k of ['bg-brand', 'text-black', 'rounded-md']) expect(pillCls).toContain(k); // green pill, black text
    for (const id of ['labor', 'contingency', 'profit']) {
      const box = q(`slider-${id}`);
      const kids = [...box.children];
      expect(kids[0].contains(q(`slider-${id}-value`))).toBe(true); // the pill row sits above the rail...
      expect(kids[0].className).toContain('justify-between'); // ...at its right end
      expect(kids[1].tagName).toBe('INPUT');
    }
    const total0 = q('budget-total').textContent;
    await slide(q('slider-contingency-input'), 10);
    expect(q('slider-contingency-value').textContent).toBe('10%');
    const total1 = q('budget-total').textContent;
    expect(total1).not.toBe(total0);
    await slide(q('slider-profit-input'), 20);
    expect(q('slider-profit-value').textContent).toBe('20%');
    expect(q('budget-total').textContent).not.toBe(total1);
    await slide(q('slider-labor-input'), 80);
    expect(q('slider-labor-value').textContent).toBe('80%');
  });

  it('"Escanear Boleta con IA" is PRO: a free user is sent to the paywall, not to the camera', async () => {
    const onPro = vi.fn();
    await render(React.createElement(Harness, { initial: sized(mk('Casa', -2, 30)), onPro }));
    await click(q('scan-receipt'));
    expect(onPro).toHaveBeenCalledWith('ai');
    expect(q('receipt-sheet')).toBeNull();
  });

  it('PRO scan: the AI tabulates the receipt and a rental due today gets the hourglass on its card; it can be marked returned', async () => {
    localStorage.setItem('cp.pro.sim.v1', '1');
    const today = dayOf(Date.now());
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          isReceipt: true,
          currency: 'CLP',
          supplier: 'Arriendos Sur',
          date: today,
          items: [
            { description: 'Rotomartillo', quantity: 1, amount: 15000, category: 'tool_rental', returnDate: today },
            { description: 'Cemento', quantity: 2, amount: 9980, category: 'material', returnDate: '' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const prepareReceipt = async () => ({ dataUrl: 'data:image/jpeg;base64,/9j/AAAA' });
    await render(React.createElement(Harness, { initial: sized(mk('Casa', -2, 30)), extra: { fetchImpl, prepareReceipt } }));
    await click(q('scan-receipt'));
    expect(q('receipt-sheet').getAttribute('data-phase')).toBe('pick');
    const input = q('receipt-file-input');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'r.jpg', { type: 'image/jpeg' })], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(30);
    expect(q('receipt-sheet').getAttribute('data-phase')).toBe('review');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/extract-invoice');
    expect(JSON.parse(init.body).kind).toBe('receipt');
    expect(qa('receipt-return-r0')).toHaveLength(1); // only the rental asks for the return day
    expect(qa('receipt-return-r1')).toHaveLength(0);
    await click(q('receipt-save'));
    expect(q('receipt-sheet')).toBeNull();
    const rows = q('expense-list').querySelectorAll('li');
    expect(rows).toHaveLength(2);
    const rented = [...rows].find((r) => r.textContent.includes('Rotomartillo'));
    expect(rented.getAttribute('data-due')).toBe('true');
    expect(rented.querySelector('[data-testid="hourglass"]')).not.toBeNull();
    expect([...rows].find((r) => r.textContent.includes('Cemento')).querySelector('[data-testid="hourglass"]')).toBeNull();
    await click(rented.querySelector('[data-testid^="expense-return-"]'));
    expect(q('expense-list').querySelectorAll('[data-testid="hourglass"]')).toHaveLength(0);
  });

  it('Ubicación block: the place plus "Abrir en Maps" and "Compartir" (navigator.share); editing happens only from the pencil', async () => {
    const withLoc = { ...sized(mk('Casa', -2, 30)), location: { lat: -33.4489, lng: -70.6693, label: '' } };
    const shared = [];
    Object.defineProperty(navigator, 'share', { value: async (d) => shared.push(d), configurable: true });
    await render(React.createElement(Harness, { initial: withLoc }));
    expect(q('pv-location-block').textContent).toContain('Ubicación');
    expect(q('pv-location').textContent).toContain('-33.4489');
    const open = q('loc-open');
    expect(open.tagName).toBe('A');
    expect(open.textContent).toBe('Abrir en Maps');
    expect(open.getAttribute('href')).toContain('-33.4489,-70.6693');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toContain('noopener');
    expect(q('loc-share').textContent).toBe('Compartir');
    await click(q('loc-share'));
    expect(shared).toHaveLength(1);
    expect(shared[0].url).toContain('-33.4489,-70.6693');
    expect(q('project-locate')).toBeNull(); // no location editing inside the view itself
    delete navigator.share;
    act(() => root.unmount());
    root = createRoot(host);
    await render(React.createElement(Harness, { initial: sized(mk('Sin ubicación', -2, 30)) }));
    expect(q('pv-location')).toBeNull();
    expect(q('loc-open')).toBeNull();
    expect(q('pv-location-empty').textContent).toContain('lápiz');
  });

  it('without navigator.share the link is copied to the clipboard', async () => {
    const copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (v) => copied.push(v) }, configurable: true });
    await render(React.createElement(Harness, { initial: { ...sized(mk('Casa', -2, 30)), location: { lat: 1, lng: 2, label: 'Obra Norte' } } }));
    await click(q('loc-share'));
    expect(copied[0]).toContain('1,2');
    expect(q('loc-note')).not.toBeNull();
    delete navigator.clipboard;
  });

  it('Bitácora: typing still works (and without Web Speech the mic says so, keyboard dictation remains)', async () => {
    await render(React.createElement(Harness, { initial: sized(mk('Casa', -2, 30)) }));
    const field = q('log-input');
    expect(field.tagName).toBe('TEXTAREA');
    expect(q('log-save')).toBeNull();
    expect(q('log-mic')).not.toBeNull(); // visual microphone that invites to dictate
    expect(q('log-mic').getAttribute('aria-label')).toBe('Dictar por voz');
    await click(q('log-mic'));
    expect(document.activeElement).toBe(field);
    expect(q('log-mic-hint').textContent).toContain('no admite dictado');
    await type(field, 'Se vació la losa del primer piso');
    await click(q('log-save'));
    expect(q('log-list').textContent).toContain('Se vació la losa');
    expect(q('log-input').value).toBe('');
  });

  it('a project without measures is not an error: the editor row invites to define them and PDF is disabled', async () => {
    await render(React.createElement(Harness, { initial: mk('Vacía', 0, 10) }));
    expect(q('pdf-generate').disabled).toBe(true);
    expect(q('editor-open').getAttribute('data-pending')).toBe('true');
    expect(q('editor-open').className).not.toContain('bg-brand'); // no giant green block
    expect(q('editor-open').closest('section')).toBe(q('budget-total').closest('section')); // quiet row inside the budget card
  });
});

describe('Contabilidad Global: pick several projects, one consolidated Excel through navigator.share', () => {
  it('exports only the ticked projects, with the file passed to navigator.share', async () => {
    const shared = [];
    Object.defineProperty(navigator, 'share', { value: async (data) => shared.push(data), configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    const a = sized(mk('Uno', -1, 10));
    const b = sized(mk('Dos', -1, 10));
    const c = sized(mk('Tres', -1, 10));
    await render(React.createElement(GlobalAccounting, { projects: [a, b, c] }));
    expect(q('acc-export').disabled).toBe(true);
    await click(q(`acc-check-${a.id}`));
    await click(q(`acc-check-${c.id}`));
    expect(q('acc-export').textContent).toContain('2');
    await click(q('acc-export'));
    await flush(30);
    expect(shared).toHaveLength(1);
    expect(shared[0].files).toHaveLength(1);
    expect(shared[0].files[0].name).toMatch(/\.xlsx$/);
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
