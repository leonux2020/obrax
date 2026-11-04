// @vitest-environment happy-dom
// "Zero Stress" phase 4: no close x on any sheet (title on the left, at most ONE control on the right) and swipe-down + device Back on ALL of them.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { I18nProvider } from '../src/lib/i18n.jsx';
import BottomSheet from '../src/components/BottomSheet.jsx';
import NumberPad from '../src/components/workspace/NumberPad.jsx';
import { EditToggle } from '../src/components/EditControls.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const render = async (node) => {
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, node));
  });
  await flush();
};
const touch = (el, type, y) =>
  act(async () => {
    const e = new Event(type, { bubbles: true });
    e.touches = type === 'touchend' ? [] : [{ clientY: y }];
    el.dispatchEvent(e);
  });
const swipe = async (el, from = 0, to = 200) => {
  await touch(el, 'touchstart', from);
  await touch(el, 'touchmove', to);
  await touch(el, 'touchend', to);
};
const dialog = () => document.querySelector('[role="dialog"]');

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('no close x in any sheet header', () => {
  it('a plain sheet has only the title in its header; with a headerAction, the title on the left and ONE control on the right', async () => {
    await render(React.createElement(BottomSheet, { title: 'Solo título', onClose: () => {} }, 'x'));
    const header = dialog().querySelector('h2').parentElement;
    expect(header.children).toHaveLength(1);
    expect(dialog().querySelector('button')).toBeNull();
    expect(dialog().querySelector('[data-sheet-close]')).toBeNull();
    expect(dialog().textContent).not.toMatch(/[×✕]/);
    await render(React.createElement(BottomSheet, { title: 'Con lápiz', onClose: () => {}, headerAction: React.createElement(EditToggle, { active: false, onToggle: () => {}, label: 'Editar', doneLabel: 'Listo' }) }, 'x'));
    const row = dialog().querySelector('h2').parentElement;
    expect(row.className).toContain('justify-between');
    expect(row.children).toHaveLength(2);
    expect(row.lastElementChild.querySelectorAll('button')).toHaveLength(1);
  });

  it('the source of BottomSheet renders no close button and nothing in the app marks one', () => {
    const src = readFileSync('src/components/BottomSheet.jsx', 'utf8');
    expect(src).not.toContain('data-sheet-close');
    expect(src).not.toContain('common.close');
    const hits = execSync("grep -rn 'data-sheet-close' src || true", { encoding: 'utf8' }).trim();
    expect(hits).toBe('');
  });

  it('the Action Center is a sheet now: no ✕ button of its own', () => {
    expect(readFileSync('src/components/GlobalAlerts.jsx', 'utf8')).not.toMatch(/global-alerts-close|onClick=\{onClose\}/);
  });
});

describe('swipe-to-close is the default of every sheet', () => {
  it('BottomSheet and Block default to it; nobody passes the old opt-in prop any more', () => {
    expect(readFileSync('src/components/BottomSheet.jsx', 'utf8')).toContain('swipeToClose = true');
    const callers = execSync("grep -rn 'swipeToClose' src --include=*.jsx | grep -v 'BottomSheet.jsx' || true", { encoding: 'utf8' }).trim();
    expect(callers).toBe('');
  });

  it('a long drag down closes a plain sheet, a short one springs back (fullscreen and tall too)', async () => {
    for (const props of [{}, { fullscreen: true }, { tall: true }]) {
      const onClose = vi.fn();
      await render(React.createElement(BottomSheet, { title: 'T', onClose, ...props }, 'x'));
      await swipe(dialog(), 100, 140);
      expect(onClose).not.toHaveBeenCalled();
      expect(dialog().style.transform).toBe('');
      await swipe(dialog(), 100, 260);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });

  it('it never steals a touch from a signature canvas or a slider, nor when the sheet is scrolled', async () => {
    const onClose = vi.fn();
    await render(
      React.createElement(
        BottomSheet,
        { title: 'T', onClose },
        React.createElement('canvas', { 'data-testid': 'c' }),
        React.createElement('input', { type: 'range', 'data-testid': 'r', readOnly: true }),
        React.createElement('div', { 'data-testid': 'list', style: { overflowY: 'auto' } }, React.createElement('p', { 'data-testid': 'row' }, 'fila'))
      )
    );
    await swipe(document.querySelector('[data-testid="c"]'));
    await swipe(document.querySelector('[data-testid="r"]'));
    expect(onClose).not.toHaveBeenCalled();
    // an inner list that is scrolled down: the finger is scrolling it back up, not closing the sheet
    document.querySelector('[data-testid="list"]').scrollTop = 40;
    await swipe(document.querySelector('[data-testid="row"]'));
    expect(onClose).not.toHaveBeenCalled();
    document.querySelector('[data-testid="list"]').scrollTop = 0;
    dialog().scrollTop = 30; // the sheet itself scrolled
    await swipe(document.querySelector('[data-testid="row"]'));
    expect(onClose).not.toHaveBeenCalled();
    dialog().scrollTop = 0;
    await swipe(document.querySelector('[data-testid="row"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a sheet stacked on another one answers for itself: swiping the top one does not close the one below', async () => {
    const below = vi.fn();
    const above = vi.fn();
    await render(React.createElement(BottomSheet, { title: 'Abajo', onClose: below }, React.createElement(BottomSheet, { title: 'Arriba', onClose: above }, React.createElement('p', { 'data-testid': 'inner' }, 'x'))));
    await swipe(document.querySelector('[data-testid="inner"]'));
    expect(above).toHaveBeenCalledTimes(1);
    expect(below).not.toHaveBeenCalled();
  });

  it('the number pad (also a bottom sheet) closes with a swipe down, keeping what was typed like "Listo"', async () => {
    const onClose = vi.fn();
    await render(React.createElement(NumberPad, { title: 'Precio', value: null, onChange: () => {}, onClose }));
    expect(dialog().getAttribute('data-swipe-close')).toBe('true');
    await swipe(dialog());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the explicit opt-out still exists (swipeToClose={false}) but is not used anywhere', async () => {
    const onClose = vi.fn();
    await render(React.createElement(BottomSheet, { title: 'T', swipeToClose: false, onClose }, 'x'));
    await swipe(dialog());
    expect(onClose).not.toHaveBeenCalled();
  });
});
