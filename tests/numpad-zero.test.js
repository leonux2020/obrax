// @vitest-environment happy-dom
// The pad has a big zero key and accepts middle / trailing zeros ("105", "20", "10", "10.50").
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import { NumberField } from '../src/components/ui.jsx';
import { click, q } from './helpers/appHarness.js';
import { padInit, padIsZero, padReduce, padValue, padDisplay } from '../src/lib/numpad.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;

describe('NumberPad zero', () => {
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

  function Probe({ seen, decimals }) {
    const [v, setV] = useState(null);
    seen.v = v;
    return h(NumberField, { label: 'Monto', value: v, onChange: setV, decimals, testId: 'amt' });
  }
  const keysOf = async (seen, decimals, seq) => {
    await act(async () => {
      root.render(h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(Probe, { seen, decimals })));
    });
    await click(q('amt'));
    for (const k of seq) await click(q(`pad-${k}`));
  };

  it('the zero key exists, is as big as the others and sits in the bottom row between the point and backspace', async () => {
    const seen = {};
    await keysOf(seen, 2, []);
    const zero = q('pad-0');
    expect(zero).not.toBeNull();
    expect(zero.textContent).toBe('0');
    expect(zero.className).toContain('h-16');
    const keys = [...q('field-numpad').querySelectorAll('.grid-cols-3 > button')];
    expect(keys.map((b) => b.dataset.testid)).toEqual(['pad-1', 'pad-2', 'pad-3', 'pad-4', 'pad-5', 'pad-6', 'pad-7', 'pad-8', 'pad-9', 'pad-dot', 'pad-0', 'pad-back']);
  });

  it.each([
    ['105', ['1', '0', '5'], 105],
    ['20', ['2', '0'], 20],
    ['10', ['1', '0'], 10],
    ['1000', ['1', '0', '0', '0'], 1000],
    ['10.05', ['1', '0', 'dot', '0', '5'], 10.05],
    ['10.50', ['1', '0', 'dot', '5', '0'], 10.5],
  ])('typing %s gives a number', async (_label, seq, expected) => {
    const seen = {};
    await keysOf(seen, 2, seq);
    expect(seen.v).toBe(expected);
  });

  it('a lone zero applies nothing yet and the next digit replaces it: 0 then 7 = 7', async () => {
    const seen = {};
    await keysOf(seen, 2, ['0']);
    expect(seen.v).toBeNull();
    expect(q('pad-display').dataset.value).toBe('0');
    await click(q('pad-7'));
    expect(seen.v).toBe(7);
  });
});

describe('transient zero (pure state)', () => {
  const run = (seq, start = padInit(null)) => seq.reduce((st, a) => padReduce(st, typeof a === 'string' && a !== 'dot' && a !== 'back' ? { type: 'digit', digit: a } : { type: a }), start);

  it('"0" is shown at once, "0" + point = "0.", "0.5" applies, "0" + 7 = "7"', () => {
    const z = run(['0']);
    expect(z.text).toBe('0');
    expect(padIsZero(z)).toBe(true);
    expect(padDisplay(z, 'en')).toBe('0');
    expect(padValue(z)).toBeNull(); // a lone zero is shown, but it is not an amount to apply
    const dot = run(['0', 'dot']);
    expect(dot.text).toBe('0.');
    expect(padDisplay(dot, 'es')).toBe('0,');
    expect(padIsZero(dot)).toBe(true);
    expect(run(['0', 'dot', '0']).text).toBe('0.0');
    expect(padIsZero(run(['0', 'dot', '0']))).toBe(true);
    const half = run(['0', 'dot', '5']);
    expect(half.text).toBe('0.5');
    expect(padValue(half)).toBe(0.5);
    expect(padIsZero(half)).toBe(false);
    expect(run(['0', '7']).text).toBe('7');
    expect(run(['0', '0', '7']).text).toBe('7'); // no "007"
    expect(run(['dot', '5']).text).toBe('0.5'); // the point alone starts "0."
  });

  it('on a field with a value, pressing 0 replaces it with a visible 0; backspace on the last digit goes back to the empty placeholder', () => {
    const z = run(['0'], padInit(1500));
    expect(z.text).toBe('0');
    expect(run(['5', 'back']).text).toBe('');
    expect(run(['0', 'back']).text).toBe('');
  });

  it('the display tells "nothing typed" (dim placeholder) from "0 typed" (solid white)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    function Probe() {
      const [v, setV] = useState(null);
      return h(NumberField, { label: 'Monto', value: v, onChange: setV, decimals: 2, testId: 'amt' });
    }
    await act(async () => {
      root.render(h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(Probe)));
    });
    await click(q('amt'));
    const d = () => q('pad-display');
    expect(d().dataset.empty).toBe('true');
    expect(d().className).toContain('text-neutral-500');
    await click(q('pad-0'));
    expect(d().textContent).toBe('0');
    expect(d().dataset.empty).toBeUndefined();
    expect(d().dataset.zero).toBe('true');
    expect(d().className).toContain('text-neutral-200');
    expect(d().className).not.toContain('text-neutral-500');
    await click(q('pad-dot'));
    expect(d().textContent).toBe('0,');
    await click(q('pad-5'));
    expect(d().textContent).toBe('0,5');
    expect(d().dataset.zero).toBeUndefined();
    act(() => root.unmount());
    host.remove();
  });
});
