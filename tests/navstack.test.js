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
import { saveDraftAs } from './helpers/appHarness.js';

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
/** A thumb dragging the topmost sheet down past the close threshold. */
const swipeDown = async () => {
  const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1);
  const touch = (type, y) =>
    act(async () => {
      const e = new Event(type, { bubbles: true });
      e.touches = type === 'touchend' ? [] : [{ clientY: y }];
      dialog.dispatchEvent(e);
    });
  await touch('touchstart', 0);
  await touch('touchmove', 200);
  await touch('touchend', 200);
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
    await click(q('dock-export')); // any sheet: the export one
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

  it('Ajustes is a top-level screen (a tab): Back returns to Proyectos, the app is not reset and no layer is left', async () => {
    await click(q('nav-settings'));
    expect(q('settings-view')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull(); // not a floating sheet
    expect(q('project-card')).toBeNull(); // the projects are hidden: the whole viewport is Ajustes
    await deviceBack();
    expect(q('settings-view')).toBeNull();
    expect(q('project-card')).not.toBeNull();
    expect(window.history.state).toBeNull();
    expect(layerDepth()).toBe(0);
  });

  it('Ajustes -> Squadra: Back closes ONLY the sheet; Ajustes stays, and a second Back goes to Proyectos', async () => {
    await click(q('nav-settings'));
    await click(q('settings-squadra'));
    expect(q('squadra-sheet') ?? document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(layerDepth()).toBe(1);
    await deviceBack();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(q('settings-view')).not.toBeNull(); // still on Ajustes
    expect(q('project-card')).toBeNull();
    expect(window.history.state).toEqual({ cubraxTab: 'settings' });
    expect(layerDepth()).toBe(0);
    await deviceBack();
    expect(q('settings-view')).toBeNull();
    expect(q('project-card')).not.toBeNull();
  });

  it('Ajustes -> editar perfil: the signature canvas lives in the form; Back folds the accordion and drops the draft, then Ajustes, then Proyectos', async () => {
    await click(q('nav-settings'));
    await openAcc('settings-profile');
    await click(q('settings-profile-edit'));
    expect(q('pro-signature')).not.toBeNull();
    expect(q('contractor-sign-sheet')).toBeNull(); // no full-screen swap any more
    expect(layerDepth()).toBe(1);
    await deviceBack();
    expect(q('settings-profile').open).toBe(false);
    expect(q('settings-view')).not.toBeNull();
    await openAcc('settings-profile');
    expect(q('settings-profile-form')).toBeNull(); // folded -> back on the read card
    expect(q('settings-profile-card')).not.toBeNull();
    await deviceBack();
    await deviceBack();
    expect(q('project-card')).not.toBeNull();
  });

  it('Ajustes -> Squadra -> worker file: Back unwinds one layer at a time (file, directory, Ajustes, Proyectos)', async () => {
    await click(q('nav-settings'));
    await click(q('settings-squadra'));
    await click([...document.querySelectorAll('button')].find((b) => /^worker-new|squadra-new/.test(b.dataset.testid || '')) ?? q('squadra-new'));
    expect(layerDepth()).toBe(2);
    await deviceBack();
    expect(layerDepth()).toBe(1);
    expect(q('settings-view')).not.toBeNull();
    await deviceBack();
    expect(layerDepth()).toBe(0);
    expect(q('settings-view')).not.toBeNull();
    await deviceBack();
    expect(q('settings-view')).toBeNull();
    expect(q('project-card')).not.toBeNull();
  });

  const openAcc = async (id) => {
    const d = q(id);
    d.open = true;
    await act(async () => {
      d.dispatchEvent(new Event('toggle'));
    });
    await flush(10);
  };

  it('Ajustes: an open accordion is a layer; Back folds the last opened first and Ajustes stays, then Proyectos', async () => {
    await click(q('nav-settings'));
    await openAcc('settings-profile');
    await openAcc('settings-ops');
    expect(layerDepth()).toBe(2);
    await deviceBack();
    expect(q('settings-ops').open).toBe(false);
    expect(q('settings-profile').open).toBe(true);
    expect(q('settings-view')).not.toBeNull();
    await deviceBack();
    expect(q('settings-profile').open).toBe(false);
    expect(q('settings-view')).not.toBeNull();
    expect(window.history.state).toEqual({ cubraxTab: 'settings' });
    expect(layerDepth()).toBe(0);
    await deviceBack();
    expect(q('settings-view')).toBeNull();
    expect(q('project-card')).not.toBeNull();
  });

  it('Ajustes with an accordion open: tapping another tab, then Back, never strands the user', async () => {
    await click(q('nav-settings'));
    await openAcc('settings-profile');
    await click(q('nav-accounting'));
    expect(q('accounting')).not.toBeNull();
    expect(layerDepth()).toBe(0);
    await deviceBack();
    await flush(30);
    expect(q('accounting')).toBeNull();
    expect(q('project-card')).not.toBeNull(); // (a leftover Ajustes entry may remain underneath: it is inert, nothing reacts to it)
  });

  it('switching between tabs keeps ONE history entry: Contabilidad -> Ajustes -> Back lands on Proyectos', async () => {
    await click(q('nav-accounting'));
    await click(q('nav-settings'));
    expect(q('settings-view')).not.toBeNull();
    await deviceBack();
    expect(q('settings-view')).toBeNull();
    expect(q('accounting')).toBeNull();
    expect(q('project-card')).not.toBeNull();
    expect(window.history.state).toBeNull();
  });

  it('closing a real sheet with the backdrop or a swipe leaves no entry behind (no "Back twice"); there is no x', async () => {
    const back = vi.spyOn(window.history, 'back');
    await click(q('fab-new')); // the draft project screen (it owns ONE history entry)
    const entry = window.history.state;
    expect(entry?.cubraxProject).toBeTruthy();
    await click(q('draft-save')); // no name yet: the soft naming sheet (a layer) opens
    expect(q('draft-name-sheet')).not.toBeNull();
    expect(document.querySelector('[data-sheet-close]')).toBeNull();
    await click(q('sheet-backdrop'));
    await flush(30);
    expect(back).toHaveBeenCalledTimes(1);
    expect(q('draft-name-sheet')).toBeNull();
    expect(window.history.state?.cubraxProject).toBeTruthy(); // the draft's own entry is still there, nothing extra
    await click(q('draft-save'));
    await swipeDown();
    await flush(30);
    expect(back).toHaveBeenCalledTimes(2);
    expect(q('draft-name-sheet')).toBeNull();
    expect(window.history.state?.cubraxProject).toBeTruthy();
  });

  it('create flow: "New project" opens the project screen as a draft; saving it keeps it open; Back from it lands on the Dashboard in order', async () => {
    await click(q('fab-new'));
    expect(q('draft-bar')).not.toBeNull();
    expect(q('new-form')).toBeNull(); // no isolated form any more
    await saveDraftAs('Casa Nueva');
    expect(q('ws-title')).not.toBeNull(); // the project is saved and open, the draft cleanup did not undo it
    expect(q('draft-bar')).toBeNull();
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
    await swipeDown(); // the edit sheet is full screen: it closes with a swipe (or the device Back)
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
    expect(sheet).toContain('useSheetSwipe');
    expect(readFileSync('src/lib/useSheetSwipe.js', 'utf8')).toContain('onTouchStart');
    expect(sheet).toContain('overscroll-contain');
  });
});

describe('device Back and the accordions of a project (Parámetros, Diario, Anticipos, Gastos)', () => {
  const summary = (id) => q(id); // the grid tile that opens the bottom sheet
  const openProject = async () => {
    await click(q('project-card'));
    expect(q('ws-title')).not.toBeNull();
  };

  it('Back closes the open accordion and the user stays in the project; the next Back leaves it', async () => {
    await openProject();
    const base = window.history.state;
    await click(summary('ws-cash'));
    expect(!!q('ws-cash-sheet')).toBe(true);
    expect(window.history.state).toMatchObject({ modalOpen: true }); // the "fake" entry
    await deviceBack();
    expect(!!q('ws-cash-sheet')).toBe(false);
    expect(q('ws-title')).not.toBeNull(); // NOT thrown out to the list
    expect(window.history.state).toEqual(base);
    await deviceBack();
    expect(q('ws-title')).toBeNull();
    expect(q('project-card')).not.toBeNull();
  });

  it('every main menu of the project works the same: Parámetros, Diario, Anticipos and Gastos', async () => {
    await openProject();
    for (const id of ['ws-finance', 'ws-log', 'ws-cash', 'ws-expenses']) {
      expect(q(id), id).not.toBeNull();
      await click(summary(id));
      expect(!!q(`${id}-sheet`), id).toBe(true);
      await deviceBack();
      expect(!!q(`${id}-sheet`), id).toBe(false);
      expect(q('ws-title'), id).not.toBeNull();
    }
  });

  it('several open: Back closes them one per press, the last opened first, and only then leaves the project', async () => {
    await openProject();
    await click(summary('ws-log'));
    await click(summary('ws-cash'));
    await deviceBack();
    expect(!!q('ws-cash-sheet')).toBe(false);
    expect(!!q('ws-log-sheet')).toBe(true);
    await deviceBack();
    expect(!!q('ws-log-sheet')).toBe(false);
    expect(q('ws-title')).not.toBeNull();
    await deviceBack();
    expect(q('ws-title')).toBeNull();
  });

  it('Escape clears the master search first (inside the Personal sheet), then closes the menu sheet', async () => {
    await openProject();
    await click(summary('ws-crew'));
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(q('crew-search'), 'Pedro');
      q('crew-search').dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(q('crew-suggest')).not.toBeNull();
    await act(async () => q('crew-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(q('crew-suggest')).toBeNull();
    expect(q('crew-search').value).toBe('');
    expect(!!q('ws-crew-sheet')).toBe(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(!!q('ws-crew-sheet')).toBe(false);
    expect(q('ws-title')).not.toBeNull();
  });

  it('closing it by hand cleans the fake entry: ONE Back leaves the project (never twice)', async () => {
    await openProject();
    await click(summary('ws-cash'));
    await click(q('sheet-backdrop')); // closed by the user (tap outside)
    await flush(30);
    expect(!!q('ws-cash-sheet')).toBe(false);
    expect(window.history.state?.modalOpen).toBeUndefined();
    await deviceBack();
    expect(q('ws-title')).toBeNull();
    expect(q('project-card')).not.toBeNull();
  });

  it('a sheet opened from an accordion closes first; then the accordion; then the project', async () => {
    await openProject();
    await click(summary('ws-cash'));
    await click(q('cash-amount')); // the number pad: a layer above the accordion
    expect(q('cash-pad')).not.toBeNull();
    await deviceBack();
    expect(q('cash-pad')).toBeNull();
    expect(!!q('ws-cash-sheet')).toBe(true);
    await deviceBack();
    expect(!!q('ws-cash-sheet')).toBe(false);
    expect(q('ws-title')).not.toBeNull();
    await deviceBack();
    expect(q('ws-title')).toBeNull();
  });

  it('leaving the project with the arrow-less header total + accordion open leaves no garbage entries', async () => {
    await openProject();
    await click(q('ws-total')); // opens Anticipos
    expect(!!q('ws-cash-sheet')).toBe(true);
    await deviceBack();
    await deviceBack();
    expect(q('project-card')).not.toBeNull();
    expect(window.history.state?.modalOpen).toBeUndefined();
    expect(window.history.state?.cubraxProject).toBeUndefined();
    expect(layerDepth()).toBe(0);
  });
});
