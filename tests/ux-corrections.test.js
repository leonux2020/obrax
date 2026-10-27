// @vitest-environment happy-dom
// UX corrections: (1) a quiet "←" back arrow in the header, (2) "Anticipos y pagos del cliente" in Zone B on the app's numpad
// moving the Caja % of Zone A, (3) the big green "Crear proyecto" button that closes the new-project form.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';
import App from '../src/App.jsx';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectWorkspace from '../src/components/ProjectWorkspace.jsx';
import ToastHost from '../src/components/workspace/ToastHost.jsx';
import { projectStore } from '../src/lib/projectStore.js';
import { receiptQueue } from '../src/lib/receiptQueue.js';
import { newProject, toDayString } from '../src/lib/projects.js';
import { computeAll } from '../src/lib/engine.js';
import { cashSummary } from '../src/lib/ledger.js';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';
import { freezeQuote } from '../src/lib/signature.js';
import { DICT } from '../src/lib/dict.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const read = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toDayString(d);
};

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
const keys = async (s) => {
  for (const k of s) await click(q(`pad-${k}`));
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
  vi.restoreAllMocks();
});

// ---- the workspace on its own ------------------------------------------------------------------------------------------
let spy;
function Harness({ initial, onBack }) {
  const [project, set] = useState(initial);
  const setProject = (u) => set((p) => (typeof u === 'function' ? u(p) : u));
  const setDraft = (u) => set((p) => ({ ...p, draft: typeof u === 'function' ? u(p.draft) : u }));
  spy.project = project;
  return React.createElement(
    I18nProvider,
    { lang: 'es', regionCode: 'CL' },
    React.createElement(ProjectWorkspace, { project, setProject, setDraft, photos: [null, null, null, null], setPhotos: () => {}, company: project.company, receipts: null, enqueueReceipt: async () => {}, onBack, onEdit: () => {}, onPro: () => {} }),
    React.createElement(ToastHost)
  );
}
const mk = () => {
  const p = newProject({ regionCode: 'CL', name: 'Casa Pérez', client: 'Ana', startDate: day(-5), endDate: day(20) });
  p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 };
  return p;
};
const mount = async (initial, onBack = () => {}) => {
  spy = {};
  await act(async () => {
    root.render(React.createElement(Harness, { initial, onBack }));
  });
  await flush();
};

describe('1. back arrow', () => {
  it('is a quiet "←" in smoke colour #E0E0E0, FIRST in the header (before the title), and leaves the project', async () => {
    const onBack = vi.fn();
    await mount(mk(), onBack);
    const back = q('ws-back');
    expect(back.textContent).toBe('←');
    expect(back.className).toContain('text-[#E0E0E0]');
    expect(back.className).not.toMatch(/border/); // no box around it: no visual noise
    expect(back.compareDocumentPosition(q('ws-title')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(back.closest('[data-testid="ws-zone-a"]')).not.toBeNull();
    expect(back.getAttribute('aria-label')).toBeTruthy();
    await click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('it is still there while the quote is locked and with the sheets open', async () => {
    const p = mk();
    await mount({ ...p, draft: freezeQuote(p.draft, { pricedAt: Date.now(), total: 1, live: p }) });
    expect(q('ws-back')).not.toBeNull();
  });
});

describe('2. Anticipos y pagos del cliente', () => {
  it('is an accordion (<details>) in Zone B, after the finance block, with its own title', async () => {
    await mount(mk());
    const block = q('ws-cash');
    expect(block.tagName).toBe('DETAILS');
    expect(q('ws-zone-a').contains(block)).toBe(false);
    expect(block.textContent).toContain('Anticipos y pagos del cliente');
    expect(block.compareDocumentPosition(q('ws-finance') ?? q('ws-crew')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('the amount is typed on the app\'s numpad, the preview says what Caja will read, and adding moves the bar of Zone A', async () => {
    await mount(mk());
    const total = spy.project && computeAll(spy.project.draft, Date.now(), { timeline: { startDate: day(-5), endDate: day(20) }, chains: false }).quote.total;
    expect(total).toBeGreaterThan(0);
    expect(q('bar-cash').dataset.pct).toBe('0');
    await click(q('ws-cash').querySelector('summary'));
    expect(q('cash-add').disabled).toBe(true); // nothing typed
    await click(q('cash-amount'));
    expect(q('cash-pad')).not.toBeNull(); // the custom pad, never the OS keyboard
    expect(q('cash-pad').querySelector('input')).toBeNull();
    await keys('1000');
    expect(q('pad-display').dataset.value).toBe('1000');
    const expected = Math.round(cashSummary(total, [{ amount: 1000 }]).pct);
    expect(q('cash-pad').textContent).toContain(`${expected} %`); // live preview inside the pad
    await click(q('pad-done'));
    await click(q('cash-add'));
    expect(spy.project.payments).toHaveLength(1);
    expect(spy.project.payments[0]).toMatchObject({ amount: 1000 });
    expect(Number(q('bar-cash').dataset.pct)).toBe(expected); // the header moved, same render
    expect(q('cash-paid').textContent).toMatch(/1\.000/);
    expect(q('cash-panel').dataset.paid).toBe('1000');
    expect(qa('cash-list')[0].querySelectorAll('li')).toHaveLength(1);
    // a second one adds up; the quick "50 %" chip fills the amount without the keyboard
    await click(q('cash-quick-0.5'));
    await click(q('cash-add'));
    const paid = 1000 + Math.round(total * 0.5 * 100) / 100;
    expect(spy.project.payments).toHaveLength(2);
    expect(Number(q('bar-cash').dataset.pct)).toBe(Math.round(cashSummary(total, spy.project.payments).pct));
    expect(Math.abs(cashSummary(total, spy.project.payments).paid - paid)).toBeLessThanOrEqual(0.5); // the chip rounds to whole currency units
    // deleting a payment moves it back
    await click(qa('cash-list')[0].querySelector('button'));
    expect(spy.project.payments).toHaveLength(1);
  });

  it('"Resto" completes the budget (100 %), a payment above it is flagged, and the header total opens the accordion', async () => {
    await mount(mk());
    await click(q('ws-total')); // header -> Zone B accordion
    expect(q('ws-cash').open).toBe(true);
    await click(q('cash-quick-1'));
    await click(q('cash-add'));
    expect(q('bar-cash').dataset.pct).toBe('100');
    expect(q('cash-over')).toBeNull();
    await click(q('cash-amount'));
    await keys('5');
    await click(q('pad-done'));
    await click(q('cash-add'));
    expect(q('cash-over')).not.toBeNull();
    expect(q('bar-cash').dataset.pct).toBe('100'); // clamped
  });

  it('payments are not part of the quote: they can be registered while it is LOCKED', async () => {
    const p = mk();
    await mount({ ...p, draft: freezeQuote(p.draft, { pricedAt: Date.now(), total: 1, live: p }) });
    await click(q('ws-cash').querySelector('summary'));
    await click(q('cash-amount'));
    await keys('2500');
    await click(q('pad-done'));
    await click(q('cash-add'));
    expect(spy.project.payments[0].amount).toBe(2500);
    expect(q('cash-amount').closest('fieldset')).toBeNull();
  });

  it('i18n: the new keys exist in the six languages with the same parameters', () => {
    for (const k of ['ws.cash.title', 'ws.cash.pad', 'ws.cash.after', 'ws.cash.over', 'ws.cash.empty']) {
      for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) {
        expect(DICT[l][k], `${l} ${k}`).toBeTruthy();
        expect((DICT[l][k].match(/\{\w+\}/g) || []).sort()).toEqual((DICT.es[k].match(/\{\w+\}/g) || []).sort());
      }
    }
  });
});

// ---- inside the real App: the new-project form and persistence ---------------------------------------------------------------
async function mountApp() {
  act(() => root.unmount());
  host.remove();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(App, { splash: { hold: 0, fade: 0 } }));
    await new Promise((r) => setTimeout(r, 60));
  });
}
const seed = async () => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
  for (const p of await projectStore.load()) await projectStore.remove(p.id);
  for (const r of await receiptQueue.list()) await receiptQueue.remove(r.id);
};

describe('3. new project: the closing button', () => {
  it('the form ends with a big OLED button (green border + lettering, black inside) "Crear proyecto"; tapping it confirms and lands in the living list', async () => {
    await seed();
    await mountApp();
    await click(q('fab-new'));
    const dialog = document.querySelector('[role="dialog"]');
    const form = q('new-form');
    const button = q('project-save');
    expect(button.textContent).toContain('Crear proyecto');
    expect(button.className).toContain('border-brand');
    expect(button.className).toContain('text-brand');
    expect(button.className).toContain('bg-black');
    expect(button.className).not.toContain('bg-brand');
    expect(button.className).toContain('min-h-[64px]');
    expect(button.type).toBe('submit');
    // it is the LAST thing of the form: nothing but the cancel link comes after it
    const after = [...form.querySelectorAll('button')].slice([...form.querySelectorAll('button')].indexOf(button) + 1);
    expect(after).toHaveLength(1);
    expect(dialog.contains(button)).toBe(true);
    await typeInto(dialog.querySelector('input'), 'Casa Soto');
    await click(button);
    expect(q('project-workspace')).not.toBeNull();
    expect(q('ws-title').textContent).toBe('Casa Soto');
    expect(q('new-form')).toBeNull();
  });

  it('the project (and a payment registered in it) is really persisted; the back arrow returns to the dashboard with the card', async () => {
    await seed();
    await mountApp();
    await click(q('fab-new'));
    await typeInto(document.querySelector('[role="dialog"] input'), 'Casa Soto');
    await click(q('project-save'));
    await click(q('ws-cash').querySelector('summary'));
    await click(q('cash-amount'));
    await keys('7500');
    await click(q('pad-done'));
    await click(q('cash-add'));
    expect(q('cash-paid').textContent).toMatch(/7\.500/);
    await click(q('ws-back'));
    expect(q('project-workspace')).toBeNull();
    expect(q('project-card')).not.toBeNull();
    await flush(400);
    const [saved] = await projectStore.load();
    expect(saved.draft.project.name).toBe('Casa Soto');
    expect(saved.payments).toHaveLength(1);
    expect(saved.payments[0].amount).toBe(7500);
    // reopen: the payment is still there
    await click(q('project-card'));
    await click(q('ws-cash').querySelector('summary'));
    expect(q('cash-panel').dataset.paid).toBe('7500');
  });

  it('editing an existing project keeps the normal Cancel / Save pair (the big button is only for creating)', async () => {
    await seed();
    await mountApp();
    await click(q('fab-new'));
    await typeInto(document.querySelector('[role="dialog"] input'), 'Casa Soto');
    await click(q('project-save'));
    await click(q('ws-edit'));
    const save = q('project-save');
    expect(save.textContent).toBe('Guardar cambios');
    expect(save.className).not.toContain('min-h-[64px]');
  });

  it('structure: the OLED rules still hold for the new classes', () => {
    const src = read('src/components/ProjectSheet.jsx') + read('src/components/workspace/CashBlock.jsx') + read('src/components/workspace/HeaderZone.jsx');
    expect(src).not.toMatch(/bg-(neutral|gray|zinc|slate|stone)-\d/);
  });
});
