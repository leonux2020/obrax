// @vitest-environment happy-dom
// Weather icons in semantic colours (OLED glanceability) and the target button of the city field (GPS -> Nominatim -> city name).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectSheet from '../src/components/ProjectSheet.jsx';
import { SkyIcon } from '../src/components/WeatherBadge.jsx';
import { CSP_DIRECTIVES } from '../security/policy.js';
import { NOMINATIM_URL, placeName, reverseCity } from '../src/lib/reverseGeocode.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const svg = (sky, night) => renderToStaticMarkup(h(SkyIcon, { sky, night }));
const json = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });

describe('weather icons: semantic colours', () => {
  it('clear = yellow sun; night = pale moon', () => {
    expect(svg('clear')).toContain('text-yellow-400');
    expect(svg('clear', true)).toContain('text-amber-200');
    expect(svg('clear', true)).not.toContain('text-yellow-400');
  });
  it('partly = grey cloud + yellow sun', () => {
    const s = svg('partly');
    expect(s).toContain('text-yellow-400');
    expect(s).toContain('text-neutral-300');
  });
  it('rain = grey cloud + blue drops', () => {
    const s = svg('rain');
    expect(s).toContain('text-neutral-300');
    expect(s).toContain('text-blue-400');
  });
  it('storm = grey cloud + yellow lightning bolt', () => {
    const s = svg('storm');
    expect(s).toContain('text-neutral-300');
    expect(s).toContain('text-yellow-400');
  });
  it('snow = a pale-sky snowflake (no cloud)', () => {
    const s = svg('snow');
    expect(s).toContain('text-sky-200');
    expect(s).not.toContain('text-neutral-300');
  });
  it('cloud = grey; fog = muted grey; every icon is an outline svg with no fill box', () => {
    expect(svg('cloud')).toContain('text-neutral-300');
    expect(svg('fog')).toContain('text-neutral-400');
    for (const sky of ['clear', 'partly', 'cloud', 'fog', 'rain', 'snow', 'storm']) expect(svg(sky)).toContain('data-outline-icon="true"');
  });
});

describe('reverseGeocode: Nominatim', () => {
  it('picks city, else town, else village (then wider names)', () => {
    expect(placeName({ city: 'Milano', town: 'X', village: 'Y' })).toBe('Milano');
    expect(placeName({ town: 'Asti', village: 'Y' })).toBe('Asti');
    expect(placeName({ village: 'Cogne' })).toBe('Cogne');
    expect(placeName({ municipality: 'Bressanone' })).toBe('Bressanone');
    expect(placeName({ road: 'Via Roma' })).toBe('');
    expect(placeName(null)).toBe('');
  });

  it('asks the global reverse endpoint with lat / lon, addressdetails and the interface language; no cookies', async () => {
    const fetchImpl = vi.fn(() => json({ address: { town: 'Bolzano' } }));
    const name = await reverseCity({ lat: 46.4983, lng: 11.3548 }, { fetchImpl, lang: 'it' });
    expect(name).toBe('Bolzano');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.startsWith(`${NOMINATIM_URL}?`)).toBe(true);
    expect(url).toContain('format=json');
    expect(url).toContain('lat=46.4983');
    expect(url).toContain('lon=11.3548');
    expect(url).toContain('addressdetails=1');
    expect(url).toContain('accept-language=it');
    expect(init.credentials).toBe('omit');
  });

  it('rejects with a code: notfound / failed / offline; a hung request is cut by the timeout', async () => {
    await expect(reverseCity({ lat: 1, lng: 1 }, { fetchImpl: () => json({ address: { road: 'x' } }) })).rejects.toMatchObject({ code: 'notfound' });
    await expect(reverseCity({ lat: 1, lng: 1 }, { fetchImpl: () => json({}, false) })).rejects.toMatchObject({ code: 'failed' });
    await expect(reverseCity({ lat: 1, lng: 1 }, { fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) })).rejects.toMatchObject({ code: 'failed' });
    await expect(reverseCity({ lat: NaN, lng: 1 }, { fetchImpl: vi.fn() })).rejects.toMatchObject({ code: 'failed' });
    const never = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    await expect(reverseCity({ lat: 1, lng: 1 }, { fetchImpl: never, timeoutMs: 30 })).rejects.toMatchObject({ code: 'failed' });
  });

  it('the CSP (policy.js and vercel.json) allows exactly the Nominatim reverse path', () => {
    expect(CSP_DIRECTIVES['connect-src']).toContain('https://nominatim.openstreetmap.org/reverse');
    expect(readFileSync('vercel.json', 'utf8')).toContain('https://nominatim.openstreetmap.org/reverse');
  });
});

describe('ProjectSheet: the target button of the city field', () => {
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
  const mount = (props) =>
    act(async () => {
      root.render(h(I18nProvider, { lang: 'it', regionCode: 'IT' }, h(ProjectSheet, { onSave: () => {}, onClose: () => {}, ...props })));
    });
  const tap = async () => {
    await act(async () => {
      q('project-city-locate').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  it('sits INSIDE the city input (side button), as a crosshair icon, floating (no box)', async () => {
    await mount({});
    const btn = q('project-city-locate');
    expect(btn.closest('.relative').contains(q('project-city'))).toBe(true);
    expect(btn.querySelector('svg[data-icon="target"]')).not.toBeNull();
    expect(btn.className).not.toMatch(/\b(border|bg-|ring|shadow)\b/);
    expect(btn.getAttribute('aria-label')).toBe('Compila con la mia posizione');
  });

  it('GPS -> reverse geocoding -> the city name lands in the field; the icon pulses while it searches; no alert()', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    let resolveName;
    const locate = vi.fn().mockResolvedValue({ lat: 45.4642, lng: 9.19 });
    const reverse = vi.fn(() => new Promise((r) => (resolveName = r)));
    await mount({ locate, reverse });
    await tap();
    await flush(5);
    expect(locate).toHaveBeenCalled();
    expect(reverse).toHaveBeenCalledWith({ lat: 45.4642, lng: 9.19 }, { lang: 'it' });
    expect(q('project-city-locate').querySelector('svg').getAttribute('class')).toContain('animate-pulse');
    expect(q('project-city-locate').getAttribute('aria-busy')).toBe('true');
    await act(async () => resolveName('Milano'));
    await flush(5);
    expect(q('project-city').value).toBe('Milano');
    expect(q('project-city-locate').querySelector('svg').getAttribute('class')).toBeNull();
    expect(q('project-city-error')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('works for Europe: a town or a village is enough (the real reverse() is used with the fake fetch)', async () => {
    const fetchImpl = vi.fn(() => json({ address: { village: 'Cogne', county: 'Aosta' } }));
    const realReverse = (pos, opts) => reverseCity(pos, { ...opts, fetchImpl });
    await mount({ locate: vi.fn().mockResolvedValue({ lat: 45.6, lng: 7.35 }), reverse: realReverse });
    await tap();
    await flush(5);
    expect(q('project-city').value).toBe('Cogne');
  });

  it('failures are a quiet inline line, never a blocker: denied GPS, no connection, nothing found; typing clears it', async () => {
    await mount({ locate: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'denied' })) });
    await tap();
    await flush(5);
    expect(q('project-city-error').textContent).toMatch(/permess|autorizz|negat/i);
    await mount({ locate: vi.fn().mockResolvedValue({ lat: 1, lng: 1 }), reverse: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'notfound' })) });
    await tap();
    await flush(5);
    expect(q('project-city-error').textContent).toContain('Nome del luogo non trovato');
    expect(q('project-save').disabled).toBe(false);
    await act(async () => {
      const input = q('project-city');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Roma');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(q('project-city-error')).toBeNull();
    expect(q('project-city').value).toBe('Roma');
  });
});

describe('ProjectSheet: ONE GPS control (the target) does both jobs', () => {
  let host;
  let root;
  const saved = [];
  beforeEach(() => {
    saved.length = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  const mount = (props) =>
    act(async () => {
      root.render(h(I18nProvider, { lang: 'it', regionCode: 'IT' }, h(ProjectSheet, { onSave: (p) => saved.push(p), onClose: () => {}, ...props })));
    });
  const tap = async () => {
    await act(async () => {
      q('project-city-locate').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush(5);
  };
  const type = (v) =>
    act(async () => {
      const input = q('project-city');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const save = async () => {
    await act(async () => {
      q('project-save').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  it('one tap fills the city AND saves the coordinates (label = the city) in the saved project', async () => {
    await mount({ locate: vi.fn().mockResolvedValue({ lat: 45.4642, lng: 9.19 }), reverse: vi.fn().mockResolvedValue('Milano') });
    await tap();
    expect(q('project-city').value).toBe('Milano');
    await save();
    expect(saved[0]).toMatchObject({ cityOrRegion: 'Milano', location: { lat: 45.4642, lng: 9.19, label: 'Milano' } });
  });

  it('the old GPS controls are gone: no big button, no clear x, no coordinates line, no emoji pin', async () => {
    await mount({});
    for (const id of ['project-locate', 'project-locate-clear', 'project-location', 'project-locate-error']) expect(q(id), id).toBeNull();
    expect(document.body.textContent).not.toContain('📍');
    expect(document.querySelectorAll('[data-testid="project-city-locate"]')).toHaveLength(1);
    const src = readFileSync('src/components/ProjectSheet.jsx', 'utf8');
    expect(src).not.toMatch(/useHere|project-locate"|newp\.locate/);
  });

  it('if the lookup of the NAME fails nothing is half-saved (no coordinates without a city)', async () => {
    await mount({ locate: vi.fn().mockResolvedValue({ lat: 1, lng: 2 }), reverse: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'offline' })) });
    await tap();
    expect(q('project-city-error')).not.toBeNull();
    await save();
    expect(saved[0].location).toBeNull();
    expect(saved[0].cityOrRegion).toBe('');
  });

  it('typing another place by hand drops the old point (it would feed the weather of the wrong city)', async () => {
    await mount({ locate: vi.fn().mockResolvedValue({ lat: 45.4642, lng: 9.19 }), reverse: vi.fn().mockResolvedValue('Milano') });
    await tap();
    await type('Torino');
    await save();
    expect(saved[0]).toMatchObject({ cityOrRegion: 'Torino', location: null });
  });
});
