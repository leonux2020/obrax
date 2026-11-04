// @vitest-environment happy-dom
// Zero Stress fase 5: the project card carries a PASSIVE weather badge (temperature, sky, wind warning above 30 km/h) and the Ajustes /
// Contabilidad screens lose their big visible titles (the bottom nav already says where you are).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectCard from '../src/components/ProjectCard.jsx';
import { newProject } from '../src/lib/projects.js';
import { CARD_WEATHER_KEY, WIND_ALERT_KMH, fetchCardWeather, readCardWeather, skyOf, windAlert, windDisplay } from '../src/lib/weatherService.js';
import { weatherPlace, WEATHER_TTL_MS } from '../src/lib/weather.js';
import { q, flush, click, createHost } from './helpers/appHarness.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
};
const json = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });
const api = ({ temp = 24, code = 0, wind = 10, day = 1 } = {}) =>
  vi.fn((url) => {
    if (String(url).startsWith('https://geocoding-api.open-meteo.com/v1/search')) return json({ results: [{ latitude: -33.45, longitude: -70.66 }] });
    if (String(url).startsWith('https://api.open-meteo.com/v1/forecast')) return json({ current: { temperature_2m: temp, weather_code: code, wind_speed_10m: wind, is_day: day } });
    return json({}, false);
  });

describe('weatherService: pure rules', () => {
  it('WMO codes map to a sky; unknown ones to null', () => {
    expect(skyOf(0)).toBe('clear');
    expect(skyOf(2)).toBe('partly');
    expect(skyOf(3)).toBe('cloud');
    expect(skyOf(45)).toBe('fog');
    expect(skyOf(61)).toBe('rain');
    expect(skyOf(81)).toBe('rain');
    expect(skyOf(73)).toBe('snow');
    expect(skyOf(95)).toBe('storm');
    expect(skyOf(1234)).toBeNull();
    expect(skyOf('0')).toBeNull();
  });

  it('the wind warning is STRICTLY above 30 km/h and ignores garbage; mph only in the US / UK', () => {
    expect(WIND_ALERT_KMH).toBe(30);
    expect(windAlert(30)).toBe(false);
    expect(windAlert(30.1)).toBe(true);
    expect(windAlert(null)).toBe(false);
    expect(windAlert(NaN)).toBe(false);
    expect(windAlert('50')).toBe(false);
    expect(windDisplay(45, 'CL')).toEqual({ value: 45, unit: 'km/h' });
    expect(windDisplay(48.3, 'US')).toEqual({ value: 30, unit: 'mph' });
    expect(windDisplay(30, 'gb').unit).toBe('mph');
  });
});

describe('weatherService: background fetching', () => {
  it('reads temperature, sky and wind; caches per place for 2 hours (a fresh cache needs no request)', async () => {
    const fetchImpl = api({ temp: 31, code: 3, wind: 42 });
    const storage = memory();
    const place = weatherPlace({ cityOrRegion: 'Santiago' }, 'CL');
    const first = await fetchCardWeather(place, { fetchImpl, storage, now: 1000 });
    expect(first).toMatchObject({ temp: 31, sky: 'cloud', wind: 42, windAlert: true, cached: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // geocoding + forecast
    expect(String(fetchImpl.mock.calls[1][0])).toContain('weather_code');
    expect(readCardWeather(place, { storage, now: 1001 })).toMatchObject({ temp: 31, cached: true }); // synchronous
    const again = await fetchCardWeather(place, { fetchImpl, storage, now: 1000 + WEATHER_TTL_MS - 1 });
    expect(again.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(readCardWeather(place, { storage, now: 1000 + WEATHER_TTL_MS + 1 })).toBeNull();
  });

  it('several places live side by side in the cache (a Dashboard has many cities)', async () => {
    const storage = memory();
    const a = weatherPlace({ cityOrRegion: 'Santiago' }, 'CL');
    const b = weatherPlace({ cityOrRegion: 'Roma' }, 'IT');
    await fetchCardWeather(a, { fetchImpl: api({ temp: 20 }), storage, now: 5 });
    await fetchCardWeather(b, { fetchImpl: api({ temp: 12 }), storage, now: 6 });
    expect(Object.keys(JSON.parse(storage.getItem(CARD_WEATHER_KEY)))).toHaveLength(2);
    expect(readCardWeather(a, { storage, now: 7 }).temp).toBe(20);
    expect(readCardWeather(b, { storage, now: 7 }).temp).toBe(12);
  });

  it('the same place asked by many cards shares ONE request', async () => {
    const fetchImpl = api();
    const place = weatherPlace({ cityOrRegion: 'Santiago' }, 'CL');
    const storage = memory();
    await Promise.all([1, 2, 3, 4].map(() => fetchCardWeather(place, { fetchImpl, storage, now: 9 })));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('offline / API down / garbage / timeout / no place -> null, never an exception', async () => {
    const place = weatherPlace({ cityOrRegion: 'Santiago' }, 'CL');
    expect(await fetchCardWeather(place, { fetchImpl: vi.fn(), storage: memory(), online: false })).toBeNull();
    expect(await fetchCardWeather(place, { fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')), storage: memory() })).toBeNull();
    expect(await fetchCardWeather(place, { fetchImpl: () => json({}, false), storage: memory() })).toBeNull();
    expect(await fetchCardWeather(place, { fetchImpl: api({ temp: 999 }), storage: memory() })).toBeNull(); // not believable
    expect(await fetchCardWeather(null, { fetchImpl: vi.fn(), storage: memory() })).toBeNull();
    const never = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await fetchCardWeather(place, { fetchImpl: never, storage: memory(), timeoutMs: 30 })).toBeNull();
  });
});

describe('ProjectCard: the weather badge', () => {
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
  const card = (extra = {}, regionCode = 'CL') => {
    const p = newProject({ regionCode, name: 'Casa Soto', client: 'Luis', cityOrRegion: 'Santiago' });
    return { ...p, ...extra };
  };
  const mount = (project, weatherOpts, lang = 'es') =>
    act(async () => {
      root.render(h(I18nProvider, { lang, regionCode: project.draft.regionCode }, h('ul', null, h(ProjectCard, { project, now: Date.now(), onOpen: () => {}, weatherOpts }))));
    });

  it('renders the card FIRST (no weather yet), then the badge fades in; the card is still the one tap target', async () => {
    let release;
    const slow = vi.fn((url) => new Promise((r) => (release = () => r(api({ temp: 24, code: 0, wind: 8 })(url)))));
    // geocoding and forecast both pass through `slow`; resolve them in turn
    const fetchImpl = (url) => (String(url).includes('geocoding') ? api()(url) : slow(url));
    await mount(card(), { enabled: true, fetchImpl, storage: memory() });
    expect(q('project-card')).not.toBeNull();
    expect(q('card-weather')).toBeNull(); // painted without waiting
    await flush(400);
    expect(q('card-weather')).toBeNull(); // still waiting on the forecast: the card is unaffected
    await act(async () => release());
    await flush(20);
    expect(q('card-weather-temp').textContent).toBe('24°');
    expect(q('card-weather').dataset.sky).toBe('clear');
    expect(q('card-weather').className).toContain('wx-in');
    expect(q('card-weather').querySelector('button, a, [tabindex]')).toBeNull();
    expect(q('project-card').contains(q('card-weather'))).toBe(true);
  });

  it('the wind warning shows ONLY above 30 km/h, orange, with the speed', async () => {
    await mount(card(), { enabled: true, fetchImpl: api({ temp: 18, code: 61, wind: 45 }), storage: memory() });
    await flush(400);
    expect(q('card-weather').dataset.sky).toBe('rain');
    expect(q('card-weather').dataset.wind).toBe('alert');
    expect(q('card-weather-wind').textContent).toContain('45 km/h');
    expect(q('card-weather-wind').className).toContain('text-orange-400');
    expect(q('card-weather-wind').getAttribute('aria-label')).toContain('Viento fuerte');
  });

  it('no wind icon at or below the threshold', async () => {
    await mount(card(), { enabled: true, fetchImpl: api({ temp: 18, code: 3, wind: 30 }), storage: memory() });
    await flush(400);
    expect(q('card-weather')).not.toBeNull();
    expect(q('card-weather-wind')).toBeNull();
    expect(q('card-weather').dataset.wind).toBe('ok');
  });

  it('mph in the US', async () => {
    await mount(card({}, 'US'), { enabled: true, fetchImpl: api({ wind: 40 }), storage: memory() });
    await flush(400);
    expect(q('card-weather-wind').textContent).toContain('25 mph');
  });

  it('a fresh cached reading is there on the very first render (no flicker)', async () => {
    const storage = memory();
    const project = card();
    await fetchCardWeather(weatherPlace(project, 'CL'), { fetchImpl: api({ temp: 27, code: 2 }), storage, now: Date.now() });
    await mount(project, { enabled: true, fetchImpl: vi.fn(), storage });
    expect(q('card-weather-temp').textContent).toBe('27°');
  });

  it('offline, API failure, no place, closed job, or tests by default: no badge, no error text', async () => {
    await mount(card(), { enabled: true, fetchImpl: () => Promise.reject(new Error('offline')), storage: memory() });
    await flush(400);
    expect(q('card-weather')).toBeNull();
    await mount(card({ cityOrRegion: '' }), { enabled: true, fetchImpl: api({ wind: 80 }), storage: memory() });
    await flush(400);
    expect(q('card-weather')).toBeNull();
    const spy = api();
    await mount(card({ closedAt: Date.now() }), { enabled: true, fetchImpl: spy, storage: memory() });
    await flush(400);
    expect(q('card-weather')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    await mount(card()); // MODE is 'test': never touches the network on its own
    await flush(400);
    expect(q('card-weather')).toBeNull();
  });

  it('is localized (Italian) and the colour rule holds: only the wind is orange', async () => {
    await mount(card(), { enabled: true, fetchImpl: api({ temp: 9, code: 95, wind: 60 }), storage: memory() }, 'it');
    await flush(400);
    expect(q('card-weather-temp').getAttribute('aria-label')).toBe('Temporale, 9 °C');
    expect(q('card-weather-wind').getAttribute('aria-label')).toContain('Vento forte');
    expect(q('card-weather-temp').className).not.toContain('orange');
  });
});

describe('Ajustes and Contabilidad: no big page title', () => {
  let App;
  let host;
  beforeEach(async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'x');
    App = (await import('../src/App.jsx')).default;
    localStorage.clear();
    window.history.replaceState(null, '');
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'it', langLocked: true }));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana', email: '' }));
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
    host = createHost(App);
    await host.mount();
  });
  afterEach(() => host?.unmount());

  it('both headings stay for screen readers only (sr-only): the bottom nav carries the visible name', async () => {
    await click(host.tab('Impostazioni'));
    expect(q('settings-title').textContent).toBe('Impostazioni');
    expect(q('settings-title').className).toContain('sr-only');
    expect(q('settings-title').className).not.toContain('text-2xl');
    await click(q('nav-accounting'));
    const h1 = q('accounting').querySelector('h1');
    expect(h1.textContent).toBe('Contabilità');
    expect(h1.className).toContain('sr-only');
  });

  it('the source keeps no visible page title in either view', () => {
    expect(readFileSync('src/components/SettingsView.jsx', 'utf8')).not.toMatch(/<h1 className="text-2xl/);
    expect(readFileSync('src/components/GlobalAccounting.jsx', 'utf8')).not.toMatch(/<h1 className="min-w-0 flex-1 truncate text-lg/);
  });
});

describe('ProjectCard: the place under the title', () => {
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
  const mount = (extra) =>
    act(async () => {
      const project = { ...newProject({ regionCode: 'CL', name: 'Casa Soto', client: 'Luis' }), ...extra };
      root.render(h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h('ul', null, h(ProjectCard, { project, now: Date.now(), onOpen: () => {} }))));
    });

  it('shows a quiet pin + the city right under the title, before the client (text-neutral-400 text-xs font-medium)', async () => {
    await mount({ cityOrRegion: 'Valparaíso' });
    const place = q('card-place');
    expect(place.textContent).toBe('Valparaíso');
    expect(place.querySelector('svg[data-icon="map-pin"]')).not.toBeNull();
    expect(place.className).toContain('text-neutral-400');
    expect(place.className).toContain('text-xs');
    expect(place.className).toContain('font-medium');
    const title = q('project-card').querySelector('.text-lg');
    expect(title.nextElementSibling).toBe(place);
    expect(place.nextElementSibling.textContent).toBe('Luis');
  });

  it('falls back to the label of the saved point, never to bare coordinates', async () => {
    await mount({ cityOrRegion: '', location: { lat: -33.4, lng: -70.6, label: 'Obra Las Condes' } });
    expect(q('card-place').textContent).toBe('Obra Las Condes');
    await mount({ cityOrRegion: '', location: { lat: -33.4, lng: -70.6, label: '' } });
    expect(q('card-place')).toBeNull();
  });

  it('no place -> the line does not exist in the DOM (no dead space)', async () => {
    await mount({ cityOrRegion: '   ', location: null });
    expect(q('card-place')).toBeNull();
    expect(q('project-card').querySelector('svg[data-icon="map-pin"]')).toBeNull();
  });
});
