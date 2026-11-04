// @vitest-environment happy-dom
// "Zero Stress" phase 3: every bottom sheet rises smoothly (and stays still under reduced motion / eco mode) and no window.confirm is left:
// the app confirms in its own OLED sheet.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { I18nProvider } from '../src/lib/i18n.jsx';
import BottomSheet from '../src/components/BottomSheet.jsx';
import ConfirmSheet, { useConfirm } from '../src/components/ConfirmSheet.jsx';
import { DICT } from '../src/lib/dict.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host;
let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};
const render = async (node) => {
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, node));
  });
  await flush();
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

describe('fluid sheets: every BottomSheet animates by default', () => {
  const css = readFileSync('src/index.css', 'utf8');

  it('a plain sheet (no swipeToClose, not tall) already carries the rise animation and the soft backdrop fade', async () => {
    await render(React.createElement(BottomSheet, { title: 'Plain', onClose: () => {} }, React.createElement('p', null, 'hola')));
    const backdrop = q('sheet-backdrop');
    const dialog = backdrop.querySelector('[role="dialog"]');
    expect(dialog.className).toContain('sheet-slide');
    expect(backdrop.className).toContain('sheet-fade');
    expect(dialog.hasAttribute('data-swipe-close')).toBe(false); // the swipe is still opt-in
  });
  it('fullscreen and tall sheets too', async () => {
    await render(React.createElement(BottomSheet, { title: 'Full', fullscreen: true, onClose: () => {} }));
    expect(q('sheet-backdrop').querySelector('[role="dialog"]').className).toContain('sheet-slide');
    await render(React.createElement(BottomSheet, { title: 'Tall', tall: true, onClose: () => {} }));
    expect(q('sheet-backdrop').querySelector('[role="dialog"]').className).toContain('sheet-slide');
  });
  it('the keyframes exist and are switched off by prefers-reduced-motion and by body.eco-mode', () => {
    expect(css).toMatch(/@keyframes sheet-up/);
    expect(css).toMatch(/@keyframes sheet-fade/);
    expect(css).toMatch(/\.sheet-slide\s*\{[^}]*animation:\s*sheet-up/);
    expect(css).toMatch(/\.sheet-fade\s*\{[^}]*animation:\s*sheet-fade/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced.slice(0, reduced.indexOf('}\n}') + 3)).toMatch(/animation:\s*none\s*!important/);
    expect(css).toMatch(/body\.eco-mode \*,[\s\S]*animation:\s*none\s*!important/);
  });
  it('the numpad (a sheet too) rises like the rest', () => {
    expect(readFileSync('src/components/workspace/NumberPad.jsx', 'utf8')).toContain('sheet-slide');
  });
});

describe('no native window.confirm anywhere in the source', () => {
  it('src has no confirm( call to the browser', () => {
    const hits = execSync("grep -rnE '(window\\.)?confirm\\(' src --include=*.js --include=*.jsx || true", { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l && !/^\S+:\d+:\s*(\*|\/\/)/.test(l));
    expect(hits).toEqual([]);
  });
  it('every language has the sheet title', () => {
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) expect(DICT[l]['confirm.title'], l).toBeTruthy();
  });
});

describe('ConfirmSheet / useConfirm', () => {
  function Demo({ onYes, opts }) {
    const [ask, node] = useConfirm();
    return React.createElement(
      'div',
      null,
      React.createElement('button', { 'data-testid': 'open', onClick: () => ask(opts, onYes) }, 'open'),
      node
    );
  }
  const opts = { message: '¿Borrar la nota?', confirmLabel: 'Eliminar' };

  it('opens an OLED black sheet with the message, Cancel first (safe default) and the red confirm; nothing runs until you confirm', async () => {
    const native = vi.spyOn(window, 'confirm');
    const yes = vi.fn();
    await render(React.createElement(Demo, { onYes: yes, opts }));
    expect(q('confirm-sheet')).toBeNull();
    await click(q('open'));
    expect(q('confirm-sheet-message').textContent).toBe('¿Borrar la nota?');
    const dialog = q('confirm-sheet').closest('[role="dialog"]');
    expect(dialog.className).toContain('bg-black');
    expect(dialog.className).toContain('sheet-slide');
    const [first, second] = [...q('confirm-sheet').querySelectorAll('button')];
    expect(first.dataset.testid).toBe('confirm-sheet-cancel');
    expect(second.dataset.testid).toBe('confirm-sheet-ok');
    expect(second.textContent).toBe('Eliminar');
    expect(second.className).toContain('text-red-300'); // destructive
    expect(document.activeElement).toBe(first); // the safe answer holds the focus
    expect(yes).not.toHaveBeenCalled();
    await click(q('confirm-sheet-ok'));
    expect(yes).toHaveBeenCalledTimes(1);
    expect(q('confirm-sheet')).toBeNull();
    expect(native).not.toHaveBeenCalled();
  });

  it('Cancel, the backdrop and Escape close it without running the action', async () => {
    const yes = vi.fn();
    await render(React.createElement(Demo, { onYes: yes, opts }));
    await click(q('open'));
    await click(q('confirm-sheet-cancel'));
    expect(q('confirm-sheet')).toBeNull();
    await click(q('open'));
    await click(q('sheet-backdrop'));
    expect(q('confirm-sheet')).toBeNull();
    await click(q('open'));
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(q('confirm-sheet')).toBeNull();
    expect(yes).not.toHaveBeenCalled();
  });

  it('a non-destructive confirmation uses the green primary button', async () => {
    await render(React.createElement(ConfirmSheet, { message: 'Reabrir?', confirmLabel: 'Reabrir', danger: false, onConfirm: () => {}, onCancel: () => {} }));
    expect(q('confirm-sheet-ok').className).toContain('bg-brand');
  });
});
