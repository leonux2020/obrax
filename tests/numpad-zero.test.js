// @vitest-environment happy-dom
// The pad has a big zero key and accepts middle / trailing zeros ("105", "20", "10", "10.50").
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import { NumberField } from '../src/components/ui.jsx';
import { click, q } from './helpers/appHarness.js';

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
