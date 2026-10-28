// @vitest-environment happy-dom
// SPA navigation stack: Contabilidad is ONE history entry over Proyectos, a sheet over it is another one, and the device's Back
// unwinds them in order (sheet -> Contabilidad -> Proyectos) without ever restarting the app or skipping steps.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App, { resetBoot } from '../src/App.jsx';
import { projectStore } from '../src/lib/projectStore.js';
import { receiptQueue } from '../src/lib/receiptQueue.js';
import { newProject } from '../src/lib/projects.js';
import { useBackLayer, layerDepth } from '../src/lib/backStack.js';
import BottomSheet from '../src/components/BottomSheet.jsx';
import { PhotoLightbox } from '../src/components/workspace/NotePhoto.jsx';
import NumberPad from '../src/components/workspace/NumberPad.jsx';
import { I18nProvider } from '../src/lib/i18n.jsx';
import { resetRegistry } from '../src/lib/priceRegistry.js';
import { resetToasts } from '../src/lib/notify.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host;
let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush(10);
};
const deviceBack = async () => {
  await act(async () => {
    window.history.back();
  });
  await flush(30);
};

beforeEach(async () => {
  localStorage.clear();
  resetRegistry();
  resetToasts();
  window.history.replaceState(null, '');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
  for (const p of await projectStore.load()) await projectStore.remove(p.id);
  for (const r of await receiptQueue.list()) await receiptQueue.remove(r.id);
  const p = newProject({ regionCode: 'CL', name: 'Casa Soto', client: 'Luis' });
  p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 };
  p.payments = [{ id: 'pay001', amount: 1000, at: Date.now() - 3600_000, note: '' }];
  await projectStore.save(p);
  resetBoot();
  await act(async () => {
    root.render(React.createElement(App, { splash: { hold: 0, fade: 0 } }));
    await new Promise((r) => setTimeout(r, 150));
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('navigation stack (device Back)', () => {
  it('Proyectos -> Contabilidad pushes one entry; Back returns to Proyectos, ordered', async () => {
    expect(q('project-card')).not.toBeNull();
    await click(q('nav-accounting'));
    expect(q('accounting')).not.toBeNull();
    expect(window.history.state).toEqual({ cubraxTab: 'accounting' });
    await deviceBack();
    expect(q('accounting')).toBeNull();
    expect(q('project-card')).not.toBeNull(); // the Dashboard, not a restarted app
    expect(window.history.state?.cubraxTab).toBeUndefined();
  });

  it('tapping the Proyectos tab drops the entry: Back is not needed twice', async () => {
    const back = vi.spyOn(window.history, 'back');
    await click(q('nav-accounting'));
    await click(q('nav-projects'));
    await flush(30);
    expect(back).toHaveBeenCalledTimes(1);
    expect(window.history.state?.cubraxTab).toBeUndefined();
    expect(q('project-card')).not.toBeNull();
  });

  it('with the breakdown sheet open Back closes ONLY the sheet; a second Back leaves Contabilidad', async () => {
    await click(q('nav-accounting'));
    await click(q('acc-hud'));
    expect(q('acc-sheet')).not.toBeNull();
    expect(window.history.state).toMatchObject({ modalOpen: true });
    await deviceBack();
    expect(q('acc-sheet')).toBeNull();
    expect(q('accounting')).not.toBeNull(); // still in Contabilidad Global
    expect(window.history.state).toEqual({ cubraxTab: 'accounting' });
    await deviceBack();
    expect(q('accounting')).toBeNull();
    expect(q('project-card')).not.toBeNull();
  });

  it('closing the sheet with the backdrop leaves exactly the Contabilidad entry (one Back goes to Proyectos)', async () => {
    await click(q('nav-accounting'));
    await click(q('acc-hud'));
    await click(q('sheet-backdrop'));
    await flush(30);
    expect(q('acc-sheet')).toBeNull();
    expect(window.history.state).toEqual({ cubraxTab: 'accounting' });
    await deviceBack();
    expect(q('project-card')).not.toBeNull();
  });

  it('opening a project from Proyectos and pressing Back still lands on the Dashboard (unchanged)', async () => {
    await click(q('project-card'));
    expect(window.history.state?.cubraxProject).toBeTruthy();
    await deviceBack();
    expect(q('project-card')).not.toBeNull();
  });
});

describe('universal back stack: sheets inside the real app', () => {
  it('a sheet over a project: Back closes ONLY the sheet, the project stays open', async () => {
    await click(q('project-card'));
    expect(q('ws-title')).not.toBeNull();
    await click(q('ws-market'));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(window.history.state).toMatchObject({ modalOpen: true });
    await deviceBack();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(q('ws-title')).not.toBeNull(); // still inside the project
    expect(window.history.state?.cubraxProject).toBeTruthy(); // its own entry is intact
    await deviceBack();
    expect(q('ws-title')).toBeNull();
    expect(q('project-card')).not.toBeNull(); // now the Dashboard
  });

  it('the Settings sheet over the Dashboard: Back closes it and the app is not reset', async () => {
    await click(q('nav-settings'));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await deviceBack();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(q('project-card')).not.toBeNull();
    expect(window.history.state).toBeNull();
    expect(layerDepth()).toBe(0);
  });

  it('closing a sheet with its x or the backdrop leaves no entry behind (no "Back twice")', async () => {
    const back = vi.spyOn(window.history, 'back');
    await click(q('nav-settings'));
    await click(document.querySelector('[data-sheet-close]'));
    await flush(30);
    expect(back).toHaveBeenCalledTimes(1);
    expect(window.history.state).toBeNull();
    await click(q('nav-settings'));
    await click(q('sheet-backdrop'));
    await flush(30);
    expect(back).toHaveBeenCalledTimes(2);
    expect(window.history.state).toBeNull();
  });

  it('create flow: the new-project sheet (a layer) saves and the project opens; Back from it lands on the Dashboard in order', async () => {
    await click(q('fab-new'));
    expect(q('new-form')).not.toBeNull();
    await act(async () => {
      q('new-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush(60);
    expect(q('ws-title')).not.toBeNull(); // the project opened, the sheet cleanup did not undo it
    expect(window.history.state?.cubraxProject).toBeTruthy();
    await deviceBack();
    await flush(60);
    expect(q('ws-title')).toBeNull();
    expect(q('fab-new')).not.toBeNull(); // Dashboard
    expect(layerDepth()).toBe(0);
  });

  it('opening a project from a sheet action (create flow) is not undone by the sheet cleanup', async () => {
    await click(q('project-card'));
    await click(q('ws-edit')); // the edit sheet is a layer; closing it by the app must not pop the project entry
    await click(document.querySelector('[data-sheet-close]'));
    await flush(30);
    expect(q('ws-title')).not.toBeNull();
    expect(window.history.state?.cubraxProject).toBeTruthy();
  });
});

describe('universal back stack: LIFO and cleanup of any overlay', () => {
  function Layer({ name, onClose }) {
    useBackLayer(onClose);
    return React.createElement('div', { 'data-testid': `layer-${name}` });
  }
  function Stack() {
    const [open, setOpen] = React.useState([]);
    globalThis.__toggle = (name) => setOpen((o) => (o.includes(name) ? o.filter((x) => x !== name) : [...o, name]));
    return React.createElement(
      'div',
      { 'data-testid': 'stack-root' },
      open.map((n) => React.createElement(Layer, { key: n, name: n, onClose: () => setOpen((o) => o.filter((x) => x !== n)) }))
    );
  }
  const mountStack = async () => {
    await act(async () => {
      root.render(React.createElement(Stack));
    });
  };
  const toggle = async (n) => {
    await act(async () => globalThis.__toggle(n));
    await flush(10);
  };
  beforeEach(async () => {
    await act(async () => root.render(null)); // drop the App mounted by the outer beforeEach
    window.history.replaceState(null, '');
  });

  it('each layer registers its own entry; Back closes the LAST one first, then the one below', async () => {
    await mountStack();
    await toggle('a');
    await toggle('b');
    expect(layerDepth()).toBe(2);
    await deviceBack();
    expect(q('layer-b')).toBeNull();
    expect(q('layer-a')).not.toBeNull();
    expect(q('stack-root')).not.toBeNull(); // the main app is still mounted
    expect(layerDepth()).toBe(1);
    await deviceBack();
    expect(q('layer-a')).toBeNull();
    expect(layerDepth()).toBe(0);
    expect(window.history.state?.cubraxLayer).toBeUndefined();
  });

  it('closing the TOP layer by hand pops exactly its entry; the one below still answers to Back', async () => {
    await mountStack();
    await toggle('a');
    await toggle('b');
    await toggle('b'); // closed by x / backdrop / swipe
    await flush(30);
    expect(q('layer-a')).not.toBeNull();
    expect(window.history.state?.cubraxLayer).toBeTruthy(); // A's entry is the current one
    await deviceBack();
    expect(q('layer-a')).toBeNull();
  });

  it('closing a LOWER layer first leaves a dead entry that Back skips: nothing is left and no extra press is needed', async () => {
    await mountStack();
    await toggle('a');
    await toggle('b');
    await toggle('a'); // A's owner closes it while B is above
    await flush(30);
    expect(q('layer-b')).not.toBeNull();
    await deviceBack(); // closes B and then silently skips A's dead entry
    await flush(60);
    expect(q('layer-b')).toBeNull();
    expect(window.history.state?.cubraxLayer).toBeUndefined();
    expect(layerDepth()).toBe(0);
  });

  it('two layers closed in the same commit leave a clean history', async () => {
    await mountStack();
    await toggle('a');
    await toggle('b');
    await act(async () => {
      globalThis.__toggle('a');
      globalThis.__toggle('b');
    });
    await flush(80);
    expect(layerDepth()).toBe(0);
    expect(window.history.state?.cubraxLayer).toBeUndefined();
  });

  it('the photo viewer, the number pad and a sheet over it stack: Back unwinds them one by one', async () => {
    const closed = [];
    function Everything() {
      const [lb, setLb] = React.useState(true);
      const [pad, setPad] = React.useState(false);
      const [sheet, setSheet] = React.useState(false);
      globalThis.__open = (n) => ({ pad: setPad, sheet: setSheet })[n](true);
      return React.createElement(
        I18nProvider,
        { lang: 'es', regionCode: 'CL' },
        React.createElement('main', { 'data-testid': 'main-app' }),
        lb && React.createElement(PhotoLightbox, { url: 'blob:x', onClose: () => (closed.push('lightbox'), setLb(false)) }),
        pad && React.createElement(NumberPad, { title: 'Precio', value: 1, onChange() {}, onClose: () => (closed.push('pad'), setPad(false)) }),
        sheet && React.createElement(BottomSheet, { title: 'Hoja', onClose: () => (closed.push('sheet'), setSheet(false)) }, 'x')
      );
    }
    await act(async () => root.render(React.createElement(Everything)));
    await act(async () => globalThis.__open('sheet'));
    await act(async () => globalThis.__open('pad'));
    expect(layerDepth()).toBe(3);
    await deviceBack();
    await deviceBack();
    await deviceBack();
    expect(closed).toEqual(['pad', 'sheet', 'lightbox']); // last in, first out
    expect(q('main-app')).not.toBeNull();
    expect(layerDepth()).toBe(0);
    expect(window.history.state?.cubraxLayer).toBeUndefined();
  });

  it('a stale layer marker left by a reload is cleared when the stack starts', async () => {
    window.history.replaceState({ cubraxLayer: 'L999' }, '');
    const { acquireLayer, releaseLayer } = await import('../src/lib/backStack.js');
    const id = acquireLayer(() => {});
    releaseLayer(id);
    await flush(30);
    expect(window.history.state?.cubraxLayer).not.toBe('L999');
  });
});

describe('global styles: no pull-to-refresh', () => {
  it('html and body have overscroll-behavior-y: none; the swipe-to-close sheet keeps its own touch handling', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/index.css', 'utf8');
    expect(css).toMatch(/html,\s*body\s*\{[^}]*overscroll-behavior-y:\s*none/);
    const sheet = readFileSync('src/components/BottomSheet.jsx', 'utf8');
    expect(sheet).toContain('onTouchStart');
    expect(sheet).toContain('overscroll-contain');
  });
});
