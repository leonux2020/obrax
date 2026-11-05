// @vitest-environment happy-dom
// The rows of the omnibox drop-up: the TRADE leads ("¿este Juan era el pintor o el eléctrico?"). Line 1: Name “Nickname” Surname; line 2:
// Trade · Distance, and a missing part collapses with its separator (no gaps, no orphan dots / parentheses); long texts are truncated, not overflowed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import CrewSuggest, { distanceText, nameParts, tradesFor } from '../src/components/workspace/CrewSuggest.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host;
let root;
const q = (id, scope = host) => scope.querySelector(`[data-testid="${id}"]`);
const row = (id) => q(`crew-pick-${id}`);

const render = async (rows, { lang = 'es', query = '' } = {}) => {
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang, regionCode: 'CL' }, React.createElement(CrewSuggest, { rows, hint: '', placed: true, hidden: 0, range: 'local', onPick: () => {}, query })));
  });
};
const W = (id, extra = {}) => ({ id, name: 'Juan Pérez', specialties: ['electrician'], rating: 4, ...extra });

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('line 2: Trade · Distance', () => {
  it('1) a trade AND a distance: "Electricista · Local (12 km)", the trade in the accent colour, the distance in a quieter one', async () => {
    await render([{ worker: W('wk000001'), near: 0, km: 12.2, unknown: false }]);
    const note = q('crew-pick-note', row('wk000001'));
    expect(note.textContent).toBe('Electricista · Local (12 km)');
    expect(q('crew-pick-specialty', note).textContent).toBe('Electricista');
    expect(q('crew-pick-specialty', note).className).toContain('text-brand/90');
    expect(q('crew-pick-distance', note).textContent).toBe('Local (12 km)');
    expect(q('crew-pick-distance', note).className).toContain('text-neutral-300');
    expect(note.className).toContain('text-sm');
  });
  it('2) NO trade but a distance: only the distance, no separator, no empty slot', async () => {
    await render([{ worker: W('wk000002', { specialties: [] }), near: 0, km: 12, unknown: false }]);
    const note = q('crew-pick-note', row('wk000002'));
    expect(note.textContent).toBe('Local (12 km)');
    expect(q('crew-pick-specialty', note)).toBeNull();
    expect(note.textContent).not.toContain('·');
    expect(note.querySelectorAll('span[aria-hidden]')).toHaveLength(0); // no separator element at all
  });
  it('3) a trade but the distance is unknown: "Electricista · Distancia desconocida" (quiet, italic)', async () => {
    await render([{ worker: W('wk000003'), near: 3, km: null, unknown: true }]);
    const note = q('crew-pick-note', row('wk000003'));
    expect(note.textContent).toBe('Electricista · Distancia desconocida');
    expect(q('crew-pick-unknown', note).className).toContain('italic');
    expect(q('crew-pick-distance', note)).toBeNull();
  });
  it('a trade and nothing known about the distance (a job without place): just the trade', async () => {
    await render([{ worker: W('wk000004'), near: 3, km: null, unknown: false }]);
    expect(q('crew-pick-note', row('wk000004')).textContent).toBe('Electricista');
  });
  it('no trade and no distance: line 2 has no note at all (only the stars), no blank text', async () => {
    await render([{ worker: W('wk000005', { specialties: [] }), near: 3, km: null, unknown: false }]);
    expect(q('crew-pick-note', row('wk000005'))).toBeNull();
    expect(q('stars', row('wk000005'))).not.toBeNull();
  });
  it('distance words: the town name alone, a measured distance far away, regional with its km', async () => {
    await render([
      { worker: W('wk000006'), near: 0, km: null, unknown: false }, // placed by the name of the town only
      { worker: W('wk000007'), near: 2, km: 419.6, unknown: false }, // measured, far (listed in "Todos")
      { worker: W('wk000008'), near: 1, km: 130, unknown: false },
      { worker: W('wk000009'), near: 0, km: 0.2, unknown: false }, // never "0 km"
    ]);
    expect(q('crew-pick-note', row('wk000006')).textContent).toBe('Electricista · Local');
    expect(q('crew-pick-note', row('wk000007')).textContent).toBe('Electricista · 420 km');
    expect(q('crew-pick-note', row('wk000008')).textContent).toBe('Electricista · Regional (130 km)');
    expect(q('crew-pick-note', row('wk000009')).textContent).toBe('Electricista · Local (1 km)');
  });
  it('every combination of (trade, distance, unknown) in every language: never an orphan separator, bracket, double space or empty text', async () => {
    for (const lang of ['es', 'en', 'pt', 'fr', 'it', 'de']) {
      const rows = [];
      let n = 0;
      for (const specialties of [[], ['mason'], ['mason', 'painter', 'plumber']])
        for (const [near, km, unknown] of [[0, 12, false], [1, null, false], [2, 300, false], [3, null, true], [3, null, false], [0, null, false]]) {
          n += 1;
          rows.push({ worker: W(`wk0000${String(n).padStart(2, '0')}`, { specialties }), near, km, unknown });
        }
      await render(rows, { lang });
      for (const r of rows) {
        const note = q('crew-pick-note', row(r.worker.id));
        if (!note) continue; // collapsed line: nothing to leak
        const text = note.textContent;
        expect(text, `${lang} ${text}`).toBe(text.trim());
        expect(text).not.toMatch(/^·|·$|·\s*·|\(\s*\)|\s{2,}|\(\s|\s\)/);
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('line 1: Name “Nickname” Surname', () => {
  it('the nickname sits between the first name and the surname; classes of the brief', async () => {
    await render([{ worker: W('wk000010', { name: 'Juan Pérez Soto', apodo: 'El Flaco' }), near: 0, km: 12, unknown: false }]);
    const name = q('crew-pick-name', row('wk000010'));
    expect(name.textContent).toBe('Juan “El Flaco” Pérez Soto');
    expect(q('crew-pick-apodo', name).textContent.trim()).toBe('“El Flaco”');
    for (const c of ['text-neutral-100', 'text-base', 'font-medium']) expect(name.className).toContain(c);
  });
  it('one-word names and people without nickname read normally', async () => {
    await render([
      { worker: W('wk000011', { name: 'Pepe', apodo: 'Chispas' }), near: 0, km: 5, unknown: false },
      { worker: W('wk000012', { name: 'Marta Lopez' }), near: 0, km: 5, unknown: false },
    ]);
    expect(q('crew-pick-name', row('wk000011')).textContent).toBe('Pepe “Chispas”');
    expect(q('crew-pick-name', row('wk000012')).textContent).toBe('Marta Lopez');
    expect(q('crew-pick-apodo', row('wk000012'))).toBeNull();
  });
  it('nameParts', () => {
    expect(nameParts('  Ana   María Ruiz ')).toEqual({ first: 'Ana', rest: 'María Ruiz' });
    expect(nameParts('Ana')).toEqual({ first: 'Ana', rest: '' });
    expect(nameParts(undefined)).toEqual({ first: '', rest: '' });
  });
});

describe('the trade that was searched leads', () => {
  const label = (id) => ({ painter: 'Pintor', electrician: 'Electricista', mason: 'Albañil' })[id];
  it('tradesFor puts the trades matching the typed words first (accents ignored) and keeps the rest', () => {
    const w = { specialties: ['painter', 'electrician', 'mason'] };
    expect(tradesFor(w, 'electri', label)).toEqual(['electrician', 'painter', 'mason']);
    expect(tradesFor(w, 'ALBANIL', label)).toEqual(['mason', 'painter', 'electrician']);
    expect(tradesFor(w, 'juan', label)).toEqual(['painter', 'electrician', 'mason']);
    expect(tradesFor({}, 'x', label)).toEqual([]);
    expect(tradesFor(null, '', label)).toEqual([]);
  });
  it('the row shows the searched trade first and "+N" for the others', async () => {
    const w = W('wk000013', { specialties: ['painter', 'electrician'] });
    await render([{ worker: w, near: 0, km: 8, unknown: false }], { query: 'juan electri' });
    const note = q('crew-pick-note', row('wk000013'));
    expect(q('crew-pick-specialty', note).textContent).toBe('Electricista +1');
    expect(note.textContent).toBe('Electricista +1 · Local (8 km)');
    await render([{ worker: w, near: 0, km: 8, unknown: false }], { query: '' });
    expect(q('crew-pick-specialty', row('wk000013')).textContent).toBe('Pintor +1');
  });
});

describe('narrow screens: the text is cut with an ellipsis, never overflows', () => {
  it('every level of the row can shrink (min-w-0) and the long parts truncate; the distance never pushes the trade out', async () => {
    const long = { ...W('wk000014', { name: 'Maximiliano Alejandro de la Santísima Trinidad Pérez', apodo: 'El Gran Constructor de Casas' }), specialties: ['electrician'] };
    await render([{ worker: long, near: 1, km: 212, unknown: false }]);
    const li = row('wk000014').closest('li');
    const name = q('crew-pick-name', li);
    const note = q('crew-pick-note', li);
    expect(name.className).toMatch(/\bmin-w-0\b/);
    expect(name.className).toMatch(/\btruncate\b/);
    expect(q('crew-pick-specialty', note).className).toMatch(/\bmin-w-0\b/);
    expect(q('crew-pick-specialty', note).className).toMatch(/\btruncate\b/);
    expect(q('crew-pick-distance', note).className).toMatch(/\btruncate\b/);
    expect(q('crew-pick-distance', note).className).toMatch(/\bshrink-0\b/);
    expect(q('crew-pick-distance', note).className).toMatch(/max-w-\[60%\]/); // so a long distance text cannot swallow the trade
    expect(note.className).toMatch(/\bmin-w-0\b/);
    // every ancestor between the text and the button is allowed to shrink
    let el = note.parentElement;
    const chain = [];
    while (el && el !== row('wk000014')) {
      chain.push(el.className);
      el = el.parentElement;
    }
    expect(chain.every((c) => /\bmin-w-0\b/.test(c))).toBe(true);
    expect(note.textContent).toBe('Electricista · Regional (212 km)');
  });
  it('the unknown-distance text can be cut too', async () => {
    await render([{ worker: W('wk000015'), near: 3, km: null, unknown: true }], { lang: 'de' });
    expect(q('crew-pick-unknown', row('wk000015')).className).toMatch(/\btruncate\b/);
  });
});

describe('distanceText', () => {
  const t = (k) => ({ 'crew.near.local': 'Local', 'crew.near.regional': 'Regional' })[k];
  it('combines the label and the rounded km without orphans', () => {
    expect(distanceText(t, 0, 12.4)).toBe('Local (12 km)');
    expect(distanceText(t, 1, null)).toBe('Regional');
    expect(distanceText(t, 2, 300.2)).toBe('300 km');
    expect(distanceText(t, 3, null)).toBe('');
    expect(distanceText(t, 0, NaN)).toBe('Local');
  });
});
