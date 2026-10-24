// @vitest-environment happy-dom
// Usability audit: voice logbook (permissions + visible state), price-source indicator, microphone policy.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import { Logbook } from '../src/components/ProjectView.jsx';
import StepPrices from '../src/components/steps/StepPrices.jsx';
import { createDictation } from '../src/lib/speech.js';
import { newDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { refreshPrices, failureReason } from '../src/lib/priceFeed.js';
import { publish, resetRegistry } from '../src/lib/priceRegistry.js';
import { createPriceStore, memoryPriceBackend } from '../src/lib/priceStore.js';
import { SECURITY_HEADERS } from '../security/policy.js';
import { makeI18n } from '../src/lib/i18n.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 5)); });
const NOW = new Date(2026, 9, 22, 9, 0, 0).getTime();

let host;
let root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  resetRegistry();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete window.webkitSpeechRecognition;
});

// ---------------------------------------------------------------------------------------------------------------
describe('voice logbook', () => {
  let recs;
  class Fake {
    constructor() {
      recs.push(this);
    }
    start() {}
    stop() {
      queueMicrotask(() => this.onend?.());
    }
  }
  const say = (rec, parts, resultIndex = 0) =>
    rec.onresult({ resultIndex, results: parts.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) });
  function Wrap() {
    const [entries, setEntries] = useState([]);
    return h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(Logbook, { entries, onChange: setEntries }));
  }
  beforeEach(() => {
    recs = [];
    window.webkitSpeechRecognition = Fake;
  });

  it('the microphone itself turns red and blinks while listening, with a red "listening" line; back to normal when it stops', async () => {
    await act(async () => root.render(h(Wrap)));
    const mic = q('log-mic');
    expect(mic.className).not.toContain('bg-red-500');
    await click(mic);
    expect(mic.dataset.listening).toBe('true');
    expect(mic.className).toContain('bg-red-500');
    expect(mic.className).toContain('animate-pulse');
    expect(mic.querySelector('rect[width="6"]')).not.toBeNull(); // still the microphone glyph, not a stop square
    expect(q('log-mic-hint').dataset.kind).toBe('listening');
    expect(q('log-mic-hint').className).toContain('text-red-400');
    await act(async () => recs[0].onaudiostart());
    expect(q('log-mic-hint').textContent).toContain('Escuchando');
    await click(mic);
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(mic.className).not.toContain('bg-red-500');
  });

  it('onresult injects the text into the textarea (React state) live, from the whole result list, even when resultIndex jumps', async () => {
    await act(async () => root.render(h(Wrap)));
    await click(q('log-mic'));
    await act(async () => say(recs[0], [['hola', false]]));
    expect(q('log-input').value).toBe('hola');
    // a browser that re-sends earlier results and moves resultIndex: nothing is lost or duplicated
    await act(async () => say(recs[0], [['hola equipo', true], ['vaciado de', false]], 1));
    expect(q('log-input').value).toBe('hola equipo vaciado de');
    await act(async () => say(recs[0], [['hola equipo', true], ['vaciado de losa', true]], 2));
    expect(q('log-input').value).toBe('hola equipo vaciado de losa');
  });

  it('a denied microphone shows a visible red alert on screen (not just a hint); network failures get their own message', async () => {
    await act(async () => root.render(h(Wrap)));
    await click(q('log-mic'));
    await act(async () => recs[0].onerror({ error: 'not-allowed' }));
    const hint = q('log-mic-hint');
    expect(hint.getAttribute('role')).toBe('alert');
    expect(hint.dataset.kind).toBe('error');
    expect(hint.className).toContain('border-red-500');
    expect(hint.textContent).toContain('bloqueado');
    expect(q('log-mic').dataset.listening).toBe('false');
    await click(q('log-mic'));
    await act(async () => recs[1].onerror({ error: 'network' }));
    expect(q('log-mic-hint').textContent).toContain('servicio de voz');
    expect(q('log-mic-hint').getAttribute('role')).toBe('alert');
  });

  it('createDictation: service-not-allowed (blocked by a Permissions-Policy) is reported as denied, network as network', () => {
    const errors = [];
    const d = createDictation({ win: { SpeechRecognition: Fake }, onError: (k) => errors.push(k) });
    d.start();
    recs.at(-1).onerror({ error: 'service-not-allowed' });
    recs.at(-1).onerror({ error: 'network' });
    recs.at(-1).onerror({ error: 'language-not-supported' });
    expect(errors).toEqual(['denied', 'network', 'error']);
  });

  it('the page policy lets the app itself use the microphone (it used to be blocked for everybody: microphone=())', () => {
    expect(SECURITY_HEADERS['Permissions-Policy']).toContain('microphone=(self)');
    expect(SECURITY_HEADERS['Permissions-Policy']).not.toContain('microphone=()');
    const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
    const rule = JSON.stringify(vercel.headers);
    expect(rule).toContain('microphone=(self)');
    expect(rule).not.toContain('microphone=()');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('price source indicator', () => {
  function Harness() {
    const [draft, setDraft] = useState(() => {
      const d = newDraft('CL');
      d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
      return d;
    });
    const result = useMemo(() => computeAll(draft, NOW), [draft]);
    return h(I18nProvider, { lang: 'es', regionCode: 'CL' }, h(StepPrices, { draft, setDraft, result, now: NOW, onRefresh: () => {}, onPro: () => {} }));
  }
  const feed = () => q('prices-feed');

  it('says where the numbers come from: AI request / saved prices (Offline) / simulation mode / live AI', async () => {
    await act(async () => root.render(h(Harness)));
    expect(feed().dataset.state).toBe('idle');
    expect(feed().textContent).toContain('Modo Simulación');

    await act(async () => publish('CL', { state: 'loading' }));
    expect(feed().dataset.state).toBe('loading');
    expect(feed().textContent).toContain('Obteniendo precios de IA');
    expect(feed().querySelector('span[aria-hidden]').className).toContain('animate-pulse');

    await act(async () => publish('CL', { state: 'cached', at: NOW, reason: 'offline' }));
    expect(feed().textContent).toContain('Usando precios guardados (Offline)');
    expect(feed().dataset.reason).toBe('offline');

    await act(async () => publish('CL', { state: 'sim', reason: 'not_configured' }));
    expect(feed().textContent).toContain('Modo Simulación');
    expect(q('prices-feed-why').textContent).toContain('clave de IA'); // the actionable diagnosis

    await act(async () => publish('CL', { state: 'fresh', at: NOW }));
    expect(feed().textContent).toContain('IA');
    expect(q('prices-feed-why')).toBeNull();
  });

  it('every language words the three states', () => {
    for (const lang of ['es', 'en', 'pt', 'fr', 'it', 'de']) {
      const { t } = makeI18n(lang, 'CL');
      for (const k of ['prices.live.updating', 'prices.live.cached', 'prices.live.sim', 'prices.live.noKey', 'log.dictateNetwork']) expect(t(k, { date: 'x' }), `${lang} ${k}`).not.toBe(k);
    }
  });

  it('priceFeed publishes WHY it fell back (offline, proxy without key, timeout, network) next to the state', async () => {
    const store = createPriceStore(memoryPriceBackend());
    const status = async (fetchImpl, online) => {
      resetRegistry();
      const state = await refreshPrices('CL', { fetchImpl, store, now: NOW, force: true, ...(online ? { online } : {}) });
      return state;
    };
    const { currentStatus } = await import('../src/lib/priceRegistry.js');
    expect(await status(async () => ({ ok: false, status: 503, json: async () => ({ ok: false, error: 'not_configured' }) }))).toBe('sim');
    expect(currentStatus('CL').reason).toBe('not_configured');
    await status(async () => { throw new TypeError('fetch failed'); });
    expect(currentStatus('CL').reason).toBe('network');
    await status(async () => ({ ok: false, status: 502, json: async () => null }));
    expect(currentStatus('CL').reason).toBe('http_502');
    await status(async () => { throw new Error('never'); }, () => false);
    expect(currentStatus('CL')).toMatchObject({ state: 'sim', reason: 'offline' });
    expect(failureReason(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('timeout');
  });
});
