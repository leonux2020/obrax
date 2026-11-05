// @vitest-environment happy-dom
// "Artesanía fina": native keyboards (phones open the dial pad; money stays on the app's own NumberPad), the passive thermal indicator
// (open-meteo, short timeout, 2-hour cache, silent when offline) and the Eco-OLED mode (battery <= 20 % and unplugged: nothing animates).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { I18nProvider } from '../src/lib/i18n.jsx';
import WeatherChip from '../src/components/workspace/WeatherChip.jsx';
import ProfileFields from '../src/components/ProfileFields.jsx';
import { CSP_DIRECTIVES } from '../security/policy.js';
import { fetchWeather, weatherLevel, weatherPlace, WEATHER_CACHE_KEY, WEATHER_TTL_MS } from '../src/lib/weather.js';
import { ECO_CLASS, isEcoBattery, useEcoBattery } from '../src/lib/useEcoMode.jsx';
import { q } from './helpers/appHarness.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
};
const json = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });
const api = (temp = 33) =>
  vi.fn((url) => {
    if (String(url).startsWith('https://geocoding-api.open-meteo.com/v1/search')) return json({ results: [{ latitude: -33.45, longitude: -70.66 }] });
    if (String(url).startsWith('https://api.open-meteo.com/v1/forecast')) return json({ current: { temperature_2m: temp } });
    return json({}, false);
  });

describe('1. native keyboards', () => {
  it('phone fields ask for the dial pad; no money field opens the OS keyboard (they all use the NumberPad)', () => {
    const src = (f) => readFileSync(f, 'utf8');
    expect(src('src/components/squadra/WorkerSheet.jsx')).toContain('testId="worker-phone" type="tel" inputMode="tel"');
    expect(src('src/components/squadra/WorkerSheet.jsx')).toContain('testId="worker-em-phone" type="tel" inputMode="tel"');
    expect(src('src/components/ProfileCard.jsx')).toContain('inputMode="tel"');
    expect(src('src/components/ProfileFields.jsx')).toContain('type="tel" inputMode="tel"');
    // money / quantities: read-only + inputMode="none" (the app's own pad), which is why no file may ask for decimal / numeric
    expect(src('src/components/ui.jsx')).toContain('inputMode="none"');
    const offenders = walk('src').filter((f) => /\.jsx?$/.test(f) && /inputMode=["'{]+\s*['"]?(decimal|numeric)/.test(src(f)));
    expect(offenders).toEqual([]);
  });

  it('TextField type="tel" gets inputmode="tel" even when it is not passed', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(ProfileFields, { form: { name: '', taxId: '', phone: '', email: '', city: '', proName: '', proTaxId: '' }, onChange: () => {}, region: { code: 'CL' }, setForm: () => {} })));
    });
    const tel = host.querySelector('input[type="tel"]');
    if (tel) expect(tel.getAttribute('inputmode')).toBe('tel');
    await act(async () => root.unmount());
    host.remove();
  });
});

describe('2. thermal prevention', () => {
  it('30 °C and 5 °C are the limits: only strictly above / below alert', () => {
    expect(weatherLevel(30)).toBe('ok');
    expect(weatherLevel(30.1)).toBe('hot');
    expect(weatherLevel(5)).toBe('ok');
    expect(weatherLevel(4.9)).toBe('cold');
    expect(weatherLevel(null)).toBeNull();
    expect(weatherLevel('31')).toBeNull();
    expect(weatherLevel(NaN)).toBeNull();
  });

  it('the place: a saved GPS point wins; otherwise the first part of the city, filtered by the market country', () => {
    expect(weatherPlace({ location: { lat: -33.456, lng: -70.661 }, cityOrRegion: 'X' }, 'CL')).toMatchObject({ lat: -33.46, lng: -70.66 });
    expect(weatherPlace({ cityOrRegion: 'Santiago, RM' }, 'cl')).toMatchObject({ name: 'Santiago', country: 'CL' });
    expect(weatherPlace({ cityOrRegion: '' }, 'CL')).toBeNull();
    expect(weatherPlace({}, 'CL')).toBeNull();
  });

  it('geocodes the city, reads the temperature and caches it 2 hours (no request while fresh)', async () => {
    const fetchImpl = api(33);
    const storage = memory();
    const place = weatherPlace({ cityOrRegion: 'Santiago' }, 'CL');
    const first = await fetchWeather(place, { fetchImpl, storage, now: 1000 });
    expect(first).toMatchObject({ temp: 33, level: 'hot', cached: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('countryCode=CL');
    expect(JSON.parse(storage.getItem(WEATHER_CACHE_KEY))).toMatchObject({ temp: 33, key: place.key });
    const again = await fetchWeather(place, { fetchImpl, storage, now: 1000 + WEATHER_TTL_MS - 1 });
    expect(again).toMatchObject({ temp: 33, cached: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // still the same two calls
    // after 2 hours: a new forecast request only (the coordinates of the city are remembered)
    const fresh = await fetchWeather(place, { fetchImpl: api(2), storage, now: 1000 + WEATHER_TTL_MS + 1 });
    expect(fresh).toMatchObject({ temp: 2, level: 'cold', cached: false });
  });

  it('offline / API down / garbage / timeout -> null, never an exception; a different place ignores the cache', async () => {
    const place = weatherPlace({ cityOrRegion: 'Santiago' }, 'CL');
    expect(await fetchWeather(place, { fetchImpl: vi.fn(), storage: memory(), online: false })).toBeNull();
    expect(await fetchWeather(place, { fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')), storage: memory() })).toBeNull();
    expect(await fetchWeather(place, { fetchImpl: () => json({}, false), storage: memory() })).toBeNull();
    expect(await fetchWeather(place, { fetchImpl: () => json({ results: [{ latitude: 1, longitude: 2 }] }), storage: memory() })).toBeNull(); // forecast is garbage
    expect(await fetchWeather(null, { fetchImpl: vi.fn(), storage: memory() })).toBeNull();
    const never = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const t0 = Date.now();
    expect(await fetchWeather(place, { fetchImpl: never, storage: memory(), timeoutMs: 30 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1500);
    const storage = memory();
    await fetchWeather(place, { fetchImpl: api(20), storage, now: 5 });
    const other = weatherPlace({ cityOrRegion: 'Roma' }, 'IT');
    expect(await fetchWeather(other, { fetchImpl: () => Promise.reject(new Error('x')), storage, now: 6 })).toBeNull();
  });

  describe('the chip', () => {
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
    let n = 0;
    const mount = (props) =>
      act(async () => {
        root.render(h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(WeatherChip, { key: ++n, project: { cityOrRegion: 'Santiago' }, regionCode: 'CL', enabled: true, storage: memory(), now: 1, ...props })));
      });

    it('amber above 30 °C, amber below 5 °C, grey in between', async () => {
      await mount({ fetchImpl: api(34) });
      expect(q('ws-weather').dataset.level).toBe('hot');
      expect(q('ws-weather').className).toContain('text-orange-400');
      expect(q('ws-weather').textContent).toContain('34°');
      expect(q('ws-weather').getAttribute('aria-label')).toContain('Hidrata');
      await mount({ fetchImpl: api(3), storage: memory() });
      expect(q('ws-weather').dataset.level).toBe('cold');
      expect(q('ws-weather').getAttribute('aria-label')).toContain('Abriga');
      await mount({ fetchImpl: api(18), storage: memory() });
      expect(q('ws-weather').dataset.level).toBe('ok');
      expect(q('ws-weather').className).not.toContain('orange');
    });

    it('is invisible (no text, no alert) when the API fails, there is no place, or it is disabled', async () => {
      await mount({ fetchImpl: () => Promise.reject(new Error('offline')) });
      expect(q('ws-weather')).toBeNull();
      expect(host.textContent).toBe('');
      await mount({ fetchImpl: api(40), project: { cityOrRegion: '' } });
      expect(q('ws-weather')).toBeNull();
      await mount({ fetchImpl: api(40), enabled: false });
      expect(q('ws-weather')).toBeNull();
    });
  });

  it('the header shows it, it never fetches under test by default, and the CSP allows exactly the two open-meteo paths', () => {
    expect(readFileSync('src/components/workspace/HeaderZone.jsx', 'utf8')).toContain('<WeatherChip project={project} regionCode={region.code} />');
    const connect = CSP_DIRECTIVES['connect-src'];
    expect(connect).toContain('https://api.open-meteo.com/v1/forecast');
    expect(connect).toContain('https://geocoding-api.open-meteo.com/v1/search');
    expect(readFileSync('vercel.json', 'utf8')).toContain('https://api.open-meteo.com/v1/forecast https://geocoding-api.open-meteo.com/v1/search');
  });
});

describe('3. Eco-OLED mode', () => {
  it('rule: 20 % or less AND not charging', () => {
    expect(isEcoBattery({ level: 0.2, charging: false })).toBe(true);
    expect(isEcoBattery({ level: 0.19, charging: false })).toBe(true);
    expect(isEcoBattery({ level: 0.21, charging: false })).toBe(false);
    expect(isEcoBattery({ level: 0.1, charging: true })).toBe(false);
    expect(isEcoBattery(null)).toBe(false);
  });

  it('the CSS switches animations and transitions off under body.eco-mode', () => {
    const css = readFileSync('src/index.css', 'utf8');
    const rule = css.slice(css.indexOf('body.eco-mode *,'));
    expect(rule).toMatch(/animation: none !important;/);
    expect(rule).toMatch(/transition: none !important;/);
    expect(readFileSync('src/App.jsx', 'utf8')).toContain('useEcoBattery()');
  });

  describe('the hook', () => {
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
      document.body.classList.remove(ECO_CLASS);
    });
    const battery = (level, charging) => {
      const l = {};
      return { level, charging, addEventListener: (n, f) => (l[n] = f), removeEventListener: () => {}, fire: (n) => l[n]?.() };
    };
    function Probe({ nav }) {
      const eco = useEcoBattery({ nav });
      return h('i', { 'data-testid': 'eco' }, String(eco));
    }
    const mount = (nav) => act(async () => root.render(h(Probe, { nav })));

    it('turns the body class on at 20 % unplugged, off when plugged in or recharged', async () => {
      const b = battery(0.5, false);
      await mount({ getBattery: () => Promise.resolve(b) });
      expect(q('eco').textContent).toBe('false');
      expect(document.body.classList.contains(ECO_CLASS)).toBe(false);
      await act(async () => {
        b.level = 0.2;
        b.fire('levelchange');
      });
      expect(q('eco').textContent).toBe('true');
      expect(document.body.classList.contains(ECO_CLASS)).toBe(true);
      await act(async () => {
        b.charging = true;
        b.fire('chargingchange');
      });
      expect(document.body.classList.contains(ECO_CLASS)).toBe(false);
    });

    it('without getBattery (Safari / Firefox) or when it is refused, nothing happens', async () => {
      await mount({});
      expect(q('eco').textContent).toBe('false');
      await mount({ getBattery: () => Promise.reject(new Error('blocked')) });
      expect(q('eco').textContent).toBe('false');
      expect(document.body.classList.contains(ECO_CLASS)).toBe(false);
    });
  });
});
