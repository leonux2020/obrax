// @vitest-environment happy-dom
// Forward geocoding (Nominatim) for the city field: debounce, country sync by ISO code, silent coordinates; plus the clean edit toggle.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectSheet from '../src/components/ProjectSheet.jsx';
import { EditToggle } from '../src/components/EditControls.jsx';
import { CSP_DIRECTIVES } from '../security/policy.js';
import { NOMINATIM_SEARCH_URL, clearPlaceCache, parsePlaces, searchPlaces } from '../src/lib/forwardGeocode.js';
import { newProject } from '../src/lib/projects.js';
import { freezeQuote } from '../src/lib/signature.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const json = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });

const COLONIA = [
  { place_id: 1, lat: '50.9367', lon: '6.9603', name: 'Köln', address: { city: 'Köln', state: 'Nordrhein-Westfalen', country: 'Alemania', country_code: 'de' } },
  { place_id: 2, lat: '-34.4714', lon: '-57.8442', name: 'Colonia del Sacramento', address: { city: 'Colonia del Sacramento', state: 'Colonia', country: 'Uruguay', country_code: 'uy' } },
  { place_id: 3, lat: '35.0', lon: '135.0', name: 'Colonia', address: { town: 'Colonia', country: 'Japón', country_code: 'jp' } },
];

beforeEach(() => clearPlaceCache());

describe('forwardGeocode: the service', () => {
  it('asks the search endpoint with the text, addressdetails, a limit and the interface language; no cookies', async () => {
    const fetchImpl = vi.fn(() => json(COLONIA));
    await searchPlaces('Colonia', { fetchImpl, lang: 'es' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.startsWith(`${NOMINATIM_SEARCH_URL}?`)).toBe(true);
    const p = new URL(url).searchParams;
    expect(p.get('format')).toBe('json');
    expect(p.get('q')).toBe('Colonia');
    expect(p.get('addressdetails')).toBe('1');
    expect(p.get('accept-language')).toBe('es');
    expect(Number(p.get('limit'))).toBeGreaterThan(1);
    expect(init.credentials).toBe('omit');
  });

  it('the country is the ISO code of the answer (never the words): same code whatever the language', async () => {
    const es = parsePlaces(COLONIA);
    expect(es.map((x) => x.label)).toEqual(['Köln, Alemania', 'Colonia del Sacramento, Uruguay', 'Colonia, Japón']);
    expect(es.map((x) => x.countryCode)).toEqual(['DE', 'UY', 'JP']);
    const de = parsePlaces(COLONIA.map((x) => ({ ...x, address: { ...x.address, country: 'XYZ-' + x.address.country_code } })));
    expect(de.map((x) => x.countryCode)).toEqual(['DE', 'UY', 'JP']);
    expect(es[0]).toMatchObject({ lat: 50.9367, lng: 6.9603 });
  });

  it('two answers that would read the same are told apart by their state; garbage rows are dropped', () => {
    const rows = parsePlaces([
      { place_id: 1, lat: '1', lon: '2', address: { city: 'Santiago', state: 'RM', country: 'Chile', country_code: 'cl' } },
      { place_id: 2, lat: '3', lon: '4', address: { city: 'Santiago', state: 'Ñuble', country: 'Chile', country_code: 'cl' } },
      { place_id: 3, lat: 'x', lon: '4', address: { city: 'Nope' } },
      { place_id: 4, lat: '5', lon: '6', address: {} },
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Santiago, RM, Chile', 'Santiago, Ñuble, Chile']);
    expect(parsePlaces(null)).toEqual([]);
  });

  it('fewer than 3 letters, offline, a refused answer or a crash = an empty list, never an error; repeated text is cached', async () => {
    const fetchImpl = vi.fn(() => json(COLONIA));
    expect(await searchPlaces('Co', { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await searchPlaces('Colo', { fetchImpl: () => json({}, false) })).toEqual([]);
    expect(await searchPlaces('Colom', { fetchImpl: () => Promise.reject(new Error('net')) })).toEqual([]);
    await searchPlaces('Kolonia', { fetchImpl });
    await searchPlaces('kolonia', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('the CSP lets the app reach the search endpoint (policy.js and vercel.json in sync)', () => {
    expect(CSP_DIRECTIVES['connect-src']).toContain('https://nominatim.openstreetmap.org/search');
    expect(readFileSync('vercel.json', 'utf8')).toContain('https://nominatim.openstreetmap.org/search');
  });
});

describe('ProjectSheet: the city autocomplete', () => {
  let host;
  let root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  const mount = (props, lang = 'de') =>
    act(async () => {
      root.render(h(I18nProvider, { lang, regionCode: 'CL' }, h(ProjectSheet, { onSave: () => {}, onClose: () => {}, searchDelay: 40, ...props })));
    });
  const type = async (value) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(q('project-city'), value);
      q('project-city').dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const places = () => parsePlaces(COLONIA);

  it('debounces: nothing is asked while typing, ONE request after the pause, and only from the 3rd letter', async () => {
    const search = vi.fn(async () => places());
    await mount({ search });
    await type('Co');
    await flush(80);
    expect(search).not.toHaveBeenCalled();
    await type('Col');
    await type('Colo');
    await type('Colon');
    await flush(10);
    expect(search).not.toHaveBeenCalled(); // still inside the pause
    await flush(80);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0]).toBe('Colon');
    expect(search.mock.calls[0][1].lang).toBe('de');
    expect(q('project-city-results').querySelectorAll('[role="option"]')).toHaveLength(3);
  });

  it('the dropdown is soft (no hard borders) and shows "City, Country" with the flag of supported markets', async () => {
    await mount({ search: async () => places() });
    await type('Colonia');
    await flush(80);
    const list = q('project-city-results');
    expect(list.className).not.toMatch(/\bborder\b/);
    expect(list.className).toContain('bg-white/5');
    expect(q('project-city-option-1').textContent).toContain('Colonia del Sacramento, Uruguay');
    expect(q('project-city-option-1').textContent).toContain('🇺🇾');
    expect(q('project-city-option-2').getAttribute('data-country')).toBe('JP'); // no market for it: no flag, still listed
  });

  it('choosing a match fills the city, switches the market to ITS country (UI in German) and saves the coordinates silently', async () => {
    const saved = [];
    await mount({ search: async () => places(), onSave: (p) => saved.push(p) });
    expect(q('project-market').textContent).toContain('CLP');
    await type('Colonia');
    await flush(80);
    await act(async () => q('project-city-option-1').click());
    expect(q('project-city').value).toBe('Colonia del Sacramento');
    expect(q('project-city-results')).toBeNull(); // the list closes
    expect(q('project-market').textContent).toContain('UYU');
    expect(q('project-market-hint').textContent).toContain('🇺🇾');
    await flush(80);
    expect(q('project-city-results')).toBeNull(); // the chosen name is not searched again
    await act(async () => q('new-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ cityOrRegion: 'Colonia del Sacramento', regionCode: 'UY', location: { lat: -34.4714, lng: -57.8442, label: 'Colonia del Sacramento' } });
  });

  it('a country the app has no market for leaves the market alone (the city and the point are still saved)', async () => {
    const saved = [];
    await mount({ search: async () => places(), onSave: (p) => saved.push(p) });
    await type('Colonia');
    await flush(80);
    await act(async () => q('project-city-option-2').click());
    expect(q('project-city').value).toBe('Colonia');
    expect(q('project-market').textContent).toContain('CLP');
    await act(async () => q('new-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(saved[0].regionCode).toBe('CL');
    expect(saved[0].location).toMatchObject({ lat: 35, lng: 135 });
  });

  it('typing again after a pick drops the old point (it would feed the weather of another place)', async () => {
    const saved = [];
    await mount({ search: async () => places(), onSave: (p) => saved.push(p) });
    await type('Colonia');
    await flush(80);
    await act(async () => q('project-city-option-0').click());
    await type('Colonia 2');
    await act(async () => q('new-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(saved[0].location).toBeNull();
  });

  it('a market with a signed quote is NOT changed by the choice', async () => {
    const p = newProject({ regionCode: 'CL', name: 'Obra' });
    const locked = { ...p, draft: freezeQuote(p.draft, { pricedAt: Date.now(), total: 1, live: p }) };
    await mount({ project: locked, search: async () => places() });
    expect(q('project-market-locked')).not.toBeNull();
    await type('Colonia');
    await flush(80);
    await act(async () => q('project-city-option-1').click());
    expect(q('project-city').value).toBe('Colonia del Sacramento');
    expect(q('project-market-locked').textContent).toContain('CLP');
  });

  it('keyboard: arrows move, Enter picks, Escape closes the list but not the sheet', async () => {
    const onClose = vi.fn();
    await mount({ search: async () => places(), onClose });
    await type('Colonia');
    await flush(80);
    const key = (k) => act(async () => q('project-city').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })));
    await key('ArrowDown');
    await key('ArrowDown');
    expect(q('project-city-option-1').parentElement.getAttribute('aria-selected')).toBe('true');
    await key('Enter');
    expect(q('project-city').value).toBe('Colonia del Sacramento');
    await type('Colonia');
    await flush(80);
    expect(q('project-city-results')).not.toBeNull();
    await key('Escape');
    expect(q('project-city-results')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a failing search is silent: no list, no error text', async () => {
    await mount({ search: async () => { throw new Error('down'); } });
    await type('Colonia');
    await flush(80);
    expect(q('project-city-results')).toBeNull();
    expect(q('project-city-error')).toBeNull();
  });
});

describe('EditToggle: no coloured box, only the colour of the icon', () => {
  const html = (active) => renderToStaticMarkup(h(EditToggle, { active, onToggle: () => {}, label: 'Editar', doneLabel: 'Listo' }));
  it('inactive and active are transparent, with neutral-400 / brand icons and no green background or outline', () => {
    for (const active of [false, true]) {
      const cls = html(active).match(/class="([^"]*)"/)[1];
      expect(cls).toContain('bg-transparent');
      expect(cls).not.toMatch(/(^|\s)(hover:|focus:|active:)?bg-(?!transparent)[a-z]/);
      expect(cls).not.toMatch(/\b(border|ring|shadow)\b/);
      expect(cls).toContain('focus-visible:outline-none');
    }
    expect(html(false)).toContain('text-neutral-400');
    expect(html(true)).toContain('text-brand');
    expect(html(true)).toContain('data-icon="check"');
    expect(html(false)).toContain('data-icon="pencil"');
  });
});
