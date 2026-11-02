// @vitest-environment happy-dom
// "Solo lectura" must be unmistakable (cement-grey sliders) and the OS keyboard must NEVER open for a number:
// numeric fields are read-only + inputMode="none" and a tap opens the app's own NumberPad.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { I18nProvider } from '../src/lib/i18n.jsx';
import PercentSlider from '../src/components/PercentSlider.jsx';
import { NumberField } from '../src/components/ui.jsx';
import { click, q, typeInto } from './helpers/appHarness.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe('locked sliders are cement grey, never a dimmed green', () => {
  const css = readFileSync('src/index.css', 'utf8');
  const block = css.slice(css.indexOf("input[type='range'].slider-min:disabled {"), css.indexOf("input[type='range'].slider-min:focus-visible {"));

  it('the :disabled rules paint fill, handle and focus in #737373 and use no green', () => {
    expect(block).toContain('#737373');
    expect(block).toContain('::-webkit-slider-runnable-track');
    expect(block).toContain('::-webkit-slider-thumb');
    expect(block).toContain('::-moz-range-progress');
    expect(block).toContain('::-moz-range-thumb');
    expect(block).not.toMatch(/#22c55e/i);
  });

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
  const mount = (disabled) =>
    act(async () => {
      root.render(h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(PercentSlider, { label: 'Ganancia', testId: 's', value: 20, min: 0, max: 50, disabled, onChange: () => {} })));
    });

  it('locked: disabled, grey class, no opacity, pure white number; unlocked: green pill and no grey class', async () => {
    await mount(true);
    expect(q('s-input').disabled).toBe(true);
    expect(q('s-input').className).toContain('slider-locked');
    expect(q('s-input').className).not.toMatch(/opacity/);
    expect(q('s-value').className).toContain('text-neutral-200');
    expect(q('s-value').className).not.toContain('bg-brand');
    await mount(false);
    expect(q('s-input').disabled).toBe(false);
    expect(q('s-input').className).not.toContain('slider-locked');
    expect(q('s-value').className).toContain('bg-brand');
  });
});

describe('no OS keyboard for numbers', () => {
  it('no source file asks for the native numeric keyboard', () => {
    const offenders = walk('src')
      .filter((f) => /\.jsx?$/.test(f))
      .filter((f) => /inputMode=["'{]+\s*['"]?(decimal|numeric)|type=["']number["']/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

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

  function Probe({ seen }) {
    const [v, setV] = useState(1500);
    seen.v = v;
    return h(NumberField, { label: 'Tarifa diaria', unit: '$', value: v, onChange: setV, decimals: 0, testId: 'rate' });
  }
  const mount = (seen) =>
    act(async () => {
      root.render(h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(Probe, { seen })));
    });

  it('the field is read-only with inputMode="none"; a tap opens the big pad (bottom sheet) and Confirmar closes it', async () => {
    const seen = {};
    await mount(seen);
    const input = q('rate');
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute('inputmode')).toBe('none');
    expect(q('field-numpad')).toBeNull();
    await click(input);
    const pad = q('field-numpad');
    expect(pad).not.toBeNull();
    expect(pad.className).toContain('items-end'); // anchored to the bottom
    for (const k of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'back']) {
      expect(q(`pad-${k}`).className).toContain('h-16');
      expect(q(`pad-${k}`).className).toContain('min-w-16');
    }
    const done = q('pad-done');
    expect(done.textContent).toBe('Confirmar');
    expect(done.className).toContain('min-h-[72px]');
    await click(q('pad-2'));
    await click(q('pad-5'));
    await click(q('pad-0'));
    expect(seen.v).toBe(250);
    await click(q('pad-back'));
    expect(seen.v).toBe(25);
    await click(done);
    expect(q('field-numpad')).toBeNull();
    expect(q('rate').value).toBe('25');
  });

  it('Restablecer empties the field (null) and a harness typeInto drives the same pad', async () => {
    const seen = {};
    await mount(seen);
    await typeInto(q('rate'), '8000');
    expect(seen.v).toBe(8000);
    await typeInto(q('rate'), '');
    expect(seen.v).toBeNull();
    expect(q('rate').value).toBe('');
  });
});
