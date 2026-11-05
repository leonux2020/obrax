// @vitest-environment happy-dom
// Fase 11.3: the Squadra sheet, cleaned. (1) the labour budget lives in the HEADER, not in the body; (2) no "Modifica lavoratore" on the job;
// (3) "+ Anticipo" / "- Descuento" are two ultra-compact pills side by side. happy-dom cannot measure pixels, so the height saving is
// proven on the class contract (pill height, one row instead of two) and the arithmetic is written down below.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectWorkspace from '../src/components/ProjectWorkspace.jsx';
import { newProject } from '../src/lib/projects.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';
import { saveWorkers } from '../src/lib/workers.js';

vi.mock('../src/lib/exportActions.js', () => ({ EXPORT_KINDS: ['client', 'tech', 'xlsx'], runExport: vi.fn(async () => 'shared') }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AXEL = { id: 'wk000001', name: 'Axel Padilla', specialties: ['electrician'], rating: 4, address: 'Maipú' };
let host;
let root;
let spy;
const q = (id) => host.querySelector(`[data-testid="${id}"]`);
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
function Harness({ initial }) {
  const [project, set] = useState(initial);
  const setProject = (u) => set((p) => (typeof u === 'function' ? u(p) : u));
  const setDraft = (u) => set((p) => ({ ...p, draft: typeof u === 'function' ? u(p.draft) : u }));
  spy.project = project;
  return React.createElement(ProjectWorkspace, { project, setProject, setDraft, photos: [null, null, null, null], setPhotos: () => {}, company: project.company, receipts: null, enqueueReceipt: async () => {}, onBack: () => {}, onEdit: () => {}, onPro: () => {} });
}
/** Opens the Squadra sheet of a job and adds Axel Padilla from the directory through the master search. */
const setup = async () => {
  spy = {};
  const project = { ...newProject({ regionCode: 'CL', name: 'Casa Pérez', client: 'Ana' }), crew: [] };
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(Harness, { initial: project })));
  });
  await flush();
  await click(q('ws-crew'));
  await click(q('crew-range-all'));
  await typeInto(q('crew-search'), 'Axel Padilla');
  await click(q(`crew-pick-${AXEL.id}`));
  const id = spy.project.crew[0].id;
  return id;
};

beforeEach(() => {
  localStorage.clear();
  resetRegistry();
  resetToasts();
  saveWorkers([AXEL]);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

describe('Fase 11.3 hard audit 1: the spent total is in the header, NOT in the list', () => {
  it('"Mano de obra: X (Gastado: Y)" is the sheet subtitle: after the title, before the list, light and quiet', async () => {
    await setup();
    const pool = q('labor-pool');
    const sub = q('sheet-subtitle');
    expect(sub.contains(pool)).toBe(true);
    expect(pool.textContent).toMatch(/^Mano de obra: .*\(Gastado: .*\)$/);
    expect(pool.className).toContain('text-sm');
    expect(pool.className).toContain('font-light');
    expect(pool.className).toContain('text-neutral-400');
    const dialog = sub.closest('[role="dialog"]');
    expect(dialog.querySelector('h2').compareDocumentPosition(sub) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sub.compareDocumentPosition(q('crew-list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q('crew-bar')).toBeNull(); // the old control line is gone
  });
  it('nothing about the budget lives in the body or among the people (list, rows, accordion)', async () => {
    const id = await setup();
    await click(q(`worker-toggle-${id}`));
    expect(q('ws-crew-sheet').contains(q('labor-pool'))).toBe(false);
    expect(q('crew-list').textContent).not.toContain('Mano de obra');
    expect(q('crew-list').textContent).not.toContain('Gastado');
    expect(host.querySelectorAll('[data-testid="labor-pool"]')).toHaveLength(1);
  });
  it('the header figure follows the money: an advance lowers the balance and raises "spent"', async () => {
    const id = await setup();
    const before = Number(q('labor-pool').dataset.available);
    await click(q(`worker-toggle-${id}`));
    await click(q(`worker-adv-${id}`));
    for (const k of '1500') await click(q(`pad-${k}`));
    await click(q('pad-done'));
    const pool = q('labor-pool');
    expect(Number(pool.dataset.available)).toBe(before - 1500);
    expect(Number(pool.dataset.spent)).toBe(1500);
    expect(q('sheet-subtitle').contains(pool)).toBe(true);
  });
});

describe('Fase 11.3 hard audit 2: no "Modifica lavoratore" on the job', () => {
  it('expanding Axel Padilla shows no edit button, no edit sheet, no worker form; the name stays plain text', async () => {
    const id = await setup();
    await click(q(`worker-toggle-${id}`));
    expect(q(`worker-detail-${id}`)).not.toBeNull();
    expect(q(`worker-edit-${id}`)).toBeNull();
    expect(host.querySelector('[data-testid^="worker-edit-"]')).toBeNull();
    expect(q('worker-form')).toBeNull();
    expect(q('crew-name')).toBeNull();
    expect(q(`worker-detail-${id}`).textContent).not.toMatch(/Modifica|Editar|Edit/i);
    expect(q(`worker-name-${id}`).textContent).toBe('Axel Padilla');
    expect(q(`worker-name-${id}`).tagName).not.toBe('INPUT');
  });
  it('the code is gone for good: no WorkerSheet, no withWorkerEdited import, no edit callback in CrewBlock', () => {
    const src = readFileSync('src/components/workspace/CrewBlock.jsx', 'utf8');
    expect(src).not.toMatch(/WorkerSheet|withWorkerEdited|worker-edit-|onEdit/);
    expect(src).not.toMatch(/TextField/);
  });
});

describe('Fase 11.3 hard audit 3: "+ Anticipo" and "- Descuento" are two compact pills on ONE row', () => {
  it('same row container (flex flex-row gap-4), adjacent, in order; text-sm, rounded-full, light translucent fill, no border', async () => {
    const id = await setup();
    await click(q(`worker-toggle-${id}`));
    const row = q(`worker-actions-${id}`);
    const adv = q(`worker-adv-${id}`);
    const dis = q(`worker-discount-${id}`);
    expect(row.className).toContain('flex');
    expect(row.className).toContain('flex-row');
    expect(row.className).toContain('gap-4');
    expect(row.className).not.toContain('flex-col');
    expect(row.contains(adv) && row.contains(dis)).toBe(true);
    expect(row.children).toHaveLength(2);
    expect(adv.nextElementSibling).toBe(dis);
    expect(adv.textContent).toBe('+ Anticipo');
    expect(dis.textContent).toBe('- Descuento');
    for (const b of [adv, dis]) {
      expect(b.className).toContain('rounded-full');
      expect(b.className).toContain('text-sm');
      expect(b.className).toContain('bg-white/5'); // very light translucent fill on OLED black
      const base = b.className.split(/\s+/).filter((c) => !c.includes(':')); // resting state only
      expect(base.some((c) => /^border/.test(c) || /^bg-neutral/.test(c))).toBe(false);
      expect(base.filter((c) => c.startsWith('bg-'))).toEqual(['bg-white/5']);
      expect(b.className).toContain('min-h-[32px]');
      expect(b.className).toContain('before:-inset-y-1.5'); // invisible halo: 32 + 12 = 44px touch target
    }
  });
  it('height maths: before, two 44px actions stacked (88px); now one 32px row (-56px, far over the 40px asked)', async () => {
    const id = await setup();
    await click(q(`worker-toggle-${id}`));
    const px = (el) => Number(/min-h-\[(\d+)px\]/.exec(el.className)[1]);
    const rowHeight = Math.max(px(q(`worker-adv-${id}`)), px(q(`worker-discount-${id}`)));
    const before = 44 + 44; // old layout: two full-width 44px buttons, one under the other
    expect(rowHeight).toBe(32);
    expect(before - rowHeight).toBeGreaterThanOrEqual(40);
  });
  it('the pill still works: "+ Anticipo" opens the keypad', async () => {
    const id = await setup();
    await click(q(`worker-toggle-${id}`));
    await click(q(`worker-adv-${id}`));
    expect(q('pad-done')).not.toBeNull();
  });
});
