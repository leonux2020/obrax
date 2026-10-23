// @vitest-environment happy-dom
// The 7 structural repairs: PWA install, date fields, routing of a new project, local price engine with fallback,
// voice logbook, dev-only AI bypass and the audit improvements.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import fs from 'node:fs';
import path from 'node:path';
import { I18nProvider } from '../src/lib/i18n.jsx';
import { DateInput } from '../src/components/ui.jsx';
import InstallButton from '../src/components/InstallButton.jsx';
import { Logbook } from '../src/components/ProjectView.jsx';
import { __resetInstallForTests, startInstallCapture, getInstallState, promptInstall } from '../src/pwa/installPrompt.js';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, backToDashboard, q, flush, click, typeInto, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { createDictation, getSpeechRecognition, joinSpeech, speechLocale } from '../src/lib/speech.js';
import { devAiBypass, aiAccess } from '../src/lib/pro.js';
import { computeAll } from '../src/lib/engine.js';
import { newDraft } from '../src/lib/draft.js';
import { normalizeBook, mergeBooks, effectiveBook, liveMaterial, PRICE_BAND } from '../src/lib/priceBook.js';
import { CATALOG } from '../src/lib/catalog.js';
import { getRegion } from '../src/lib/regions.js';
import { machineryRate } from '../src/lib/machinery.js';
import { normalizeFrozen, normalizeSignature, freezeQuote } from '../src/lib/signature.js';
import { createPriceStore, memoryPriceBackend } from '../src/lib/priceStore.js';
import { refreshPrices, requestPriceBook, setPriceFeedEnabled } from '../src/lib/priceFeed.js';
import { resetRegistry, currentBook, currentStatus } from '../src/lib/priceRegistry.js';
import { createInvoiceHandler, buildPricesPrompt, PRICES_SCHEMA } from '../server/geminiProxy.js';
import { projectTotal } from '../src/lib/projectTotals.js';
import { newProject } from '../src/lib/projects.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const read = (f) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

// ---------------------------------------------------------------------------------------------------------------
describe('2. date fields: no browser icon, the whole field opens the calendar', () => {
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

  it('DateInput is a type=date field whose click calls showPicker(); a refused call never breaks the field', async () => {
    await act(async () => root.render(React.createElement(DateInput, { 'data-testid': 'd', value: '2026-01-02', onChange: () => {} })));
    const el = q('d');
    expect(el.type).toBe('date');
    expect(el.className).toContain('date-input');
    el.showPicker = vi.fn();
    await click(el);
    expect(el.showPicker).toHaveBeenCalledTimes(1);
    el.showPicker = () => {
      throw new DOMException('no gesture', 'NotAllowedError');
    };
    await click(el); // must not throw
    delete el.showPicker;
    await click(el); // browsers without showPicker: plain field
    expect(el.value).toBe('2026-01-02');
  });

  it('the CSS hides ::-webkit-calendar-picker-indicator and every type="date" input of the app is a DateInput', () => {
    expect(read('src/index.css')).toMatch(/\.date-input::-webkit-calendar-picker-indicator\s*\{\s*display:\s*none;/);
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(path.join(process.cwd(), 'src')).filter((x) => /\.jsx$/.test(x) && !x.endsWith('ui.jsx'))) {
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/type="date"/);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('1. "Instalar App": the install event is captured early and survives late-mounting screens', () => {
  let host;
  let root;
  const mount = async (pwa) => {
    await act(async () => root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(InstallButton, { pwa }))));
  };
  beforeEach(() => {
    __resetInstallForTests();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('keeps beforeinstallprompt until the button is tapped, prompts once and reports the choice', async () => {
    startInstallCapture();
    const ev = new Event('beforeinstallprompt', { cancelable: true });
    ev.prompt = vi.fn(async () => {});
    ev.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(getInstallState().canPrompt).toBe(true);
    expect(await promptInstall()).toBe('accepted');
    expect(ev.prompt).toHaveBeenCalledTimes(1);
    expect(getInstallState().canPrompt).toBe(false); // a prompt event can only be used once
    expect(await promptInstall()).toBe('manual');
  });

  it('the button is visible while not installed, tells how to install when the browser has no prompt, and disappears once installed', async () => {
    const calls = [];
    const pwa = { canInstall: false, installed: false, install: async () => (calls.push(1), 'manual') };
    await mount(pwa);
    expect(q('install-app').textContent).toBe('Instalar App');
    await click(q('install-app'));
    expect(calls).toHaveLength(1);
    expect(q('install-hint').textContent).toMatch(/instalar app|pantalla de inicio/i);
    await mount({ ...pwa, installed: true });
    expect(q('install-app')).toBeNull();
  });

  it('the opening screen and Ajustes both render the button (source check) and the early listener is started in main.jsx', () => {
    expect(read('src/components/SplashScreen.jsx')).toContain('<InstallButton');
    expect(read('src/components/SettingsSheet.jsx')).toContain('<InstallButton');
    expect(read('src/main.jsx')).toContain('startInstallCapture()');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('3. a new project goes to the kind of work + measures, not to the financial module', () => {
  let drive;
  let h;
  let App;
  beforeAll(async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
    App = (await import('../src/App.jsx')).default;
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    drive = createFakeDrive();
    vi.stubGlobal('fetch', drive.fetchImpl);
    installFakeGoogle(drive);
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true }));
  });
  afterEach(() => {
    h?.unmount();
    vi.unstubAllGlobals();
    delete window.google;
  });

  const create = async (name, mode) => {
    await click(q('fab-new'));
    typeInto(document.querySelector('[role="dialog"] input'), name);
    if (mode) await click(q(`mode-${mode}`));
    await click(q('project-save'));
    await flush(60);
  };

  it('"Partida simple" opens the work-type picker (Radier, Pintura, Tabiquería...), and only leaving the editor shows the finances', async () => {
    h = createHost(App);
    await h.mount();
    await create('Casa', 'quick');
    expect(q('pv-back')).toBeNull(); // NOT the financial module
    expect(h.host.textContent).toContain('Radier');
    expect(h.host.textContent).toContain('Pintura');
    expect(q('wizard-back')).not.toBeNull();
    await click(q('wizard-back')); // step 0 -> leaves the editor -> project view (finances)
    expect(q('pv-back')).not.toBeNull();
  });

  it('"Trabajo completo" opens the partidas list', async () => {
    h = createHost(App);
    await h.mount();
    await create('Edificio', 'project');
    expect(q('pv-back')).toBeNull();
    expect(h.host.textContent).toMatch(/partida/i);
    await backToDashboard();
    expect(h.host.querySelectorAll('[data-testid="project-card"]')).toHaveLength(1);
  });

  it('the open project is flushed when the page becomes hidden (visibilitychange), not only on pagehide', async () => {
    const { projectStore } = await import('../src/lib/projectStore.js');
    const spy = vi.spyOn(projectStore, 'save');
    h = createHost(App);
    await h.mount();
    await create('Casa', 'quick');
    spy.mockClear();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(spy).toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('4. local price engine: live values, last-known fallback, simulation, and frozen quotes', () => {
  const NOW = new Date(2026, 9, 22, 12, 0, 0).getTime();
  const region = getRegion('CL');
  const ref = (id) => CATALOG[id].usd * region.fx * region.priceFactor;
  const draftOf = () => {
    const d = newDraft('CL', 'quick');
    d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
    return d;
  };
  const bookOf = (k = 1.2, at = NOW) => ({ region: 'CL', at, materials: Object.fromEntries(Object.keys(CATALOG).map((id) => [id, ref(id) * k])), rent: { mixer: ref('cement_bag') * 0 + 30 * region.fx * region.priceFactor * k } });

  beforeEach(() => {
    resetRegistry();
    setPriceFeedEnabled(false);
  });

  it('normalizeBook drops unknown ids, non-positive numbers and out-of-band prices one by one', () => {
    const r = ref('cement_bag');
    const book = normalizeBook({ region: 'CL', at: 5, materials: [{ id: 'cement_bag', price: r * 1.1 }, { id: 'nope', price: 5 }, { id: 'sand', price: -3 }, { id: 'gravel', price: ref('gravel') * (PRICE_BAND.max + 1) }, { id: 'poly', price: 'x' }], rent: [] }, 'CL');
    expect(Object.keys(book.materials)).toEqual(['cement_bag']);
    expect(normalizeBook({ region: 'CL', materials: [], rent: [] }, 'CL')).toBeNull();
    expect(normalizeBook({ region: 'AR', materials: { cement_bag: r } }, 'CL')).toBeNull();
    expect(normalizeBook(null, 'CL')).toBeNull();
  });

  it('a live book changes the quote; without a book the simulation is untouched; chains:false is the same quote, lighter', () => {
    const d = draftOf();
    const sim = computeAll(d, NOW);
    const live = computeAll(d, NOW, { book: normalizeBook(bookOf(1.3), 'CL') });
    expect(live.quote.materials).toBeGreaterThan(sim.quote.materials);
    expect(sim.book).toBeNull();
    const light = computeAll(d, NOW, { chains: false });
    expect(light.chainTotals).toBeNull();
    expect(light.quote.total).toBe(sim.quote.total);
    expect(sim.chainTotals.best).toBeGreaterThan(0);
  });

  it('machinery rentals follow the live rate too', () => {
    const book = normalizeBook(bookOf(1.5), 'CL');
    expect(machineryRate('mixer', 'CL', 0, book)).toBeGreaterThan(machineryRate('mixer', 'CL', 0, null) * 1.2);
  });

  it('a FROZEN or SIGNED quote keeps its own book (or the simulation) while the live book moves', () => {
    const d = draftOf();
    const book1 = normalizeBook(bookOf(1.2), 'CL');
    const book2 = normalizeBook(bookOf(2), 'CL');
    const first = computeAll(d, NOW, { book: book1 });
    const frozen = freezeQuote(d, { pricedAt: NOW, total: first.quote.total, book: first.book });
    expect(frozen.frozen.book).toBeTruthy();
    expect(computeAll(frozen, NOW, { book: book2 }).quote.total).toBe(first.quote.total);
    // frozen BEFORE live prices existed: stays on the simulation it was agreed on
    const legacy = freezeQuote(d, { pricedAt: NOW, total: 1 });
    expect(effectiveBook(legacy, book2)).toBeNull();
    expect(computeAll(legacy, NOW, { book: book2 }).quote.total).toBe(computeAll(legacy, NOW).quote.total);
    // survives normalization (what is stored / restored)
    expect(normalizeFrozen(JSON.parse(JSON.stringify(frozen.frozen))).book).toEqual(frozen.frozen.book);
    expect(normalizeSignature({ dataUrl: 'data:image/png;base64,AAAA', w: 10, h: 10, total: 1, book: book1 }).book).toEqual(book1);
    expect(effectiveBook({}, book2)).toBe(book2);
  });

  it('mergeBooks: the new answer wins, what it lacks keeps the LAST KNOWN value', () => {
    const prev = normalizeBook({ region: 'CL', at: 1, materials: { cement_bag: ref('cement_bag'), sand: ref('sand') }, rent: {} }, 'CL');
    const next = normalizeBook({ region: 'CL', at: 2, materials: { cement_bag: ref('cement_bag') * 1.5 } }, 'CL');
    const m = mergeBooks(prev, next);
    expect(m.materials.cement_bag).toBe(next.materials.cement_bag);
    expect(m.materials.sand).toBe(prev.materials.sand);
    expect(m.at).toBe(2);
    expect(liveMaterial(m, 'CL', 'sand')).toBe(prev.materials.sand);
    expect(liveMaterial(m, 'AR', 'sand')).toBeUndefined();
  });

  const okFetch = (book) => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, book }) }));
  const failFetch = () => vi.fn(async () => {
    throw new TypeError('offline');
  });

  it('refreshPrices: success stores the book in the price store; failure afterwards falls back to the LAST stored value', async () => {
    const store = createPriceStore(memoryPriceBackend());
    expect(await refreshPrices('CL', { fetchImpl: okFetch(bookOf(1.4)), store, now: NOW })).toBe('fresh');
    expect(currentStatus('CL').state).toBe('fresh');
    const saved = currentBook('CL');
    expect(saved.materials.cement_bag).toBeGreaterThan(ref('cement_bag'));
    expect((await store.load('CL')).materials.cement_bag).toBe(saved.materials.cement_bag);

    // a new session: nothing in memory, the service is down -> the value recorded on the device is used
    resetRegistry();
    expect(await refreshPrices('CL', { fetchImpl: failFetch(), store, now: NOW + 7 * 3600_000, force: true })).toBe('cached');
    expect(currentStatus('CL').state).toBe('cached');
    expect(currentBook('CL').materials.cement_bag).toBe(saved.materials.cement_bag);
    expect(computeAll(draftOf(), NOW).quote.materials).toBe(computeAll(draftOf(), NOW, { book: saved }).quote.materials); // engine reads the registry
  });

  it('refreshPrices: a product missing from the answer keeps its last value; with no data at all the simulation is used', async () => {
    const store = createPriceStore(memoryPriceBackend());
    await refreshPrices('CL', { fetchImpl: okFetch(bookOf(1.4)), store, now: NOW });
    const before = currentBook('CL').materials.sand;
    await refreshPrices('CL', { fetchImpl: okFetch({ region: 'CL', materials: [{ id: 'cement_bag', price: ref('cement_bag') * 1.1 }], rent: [] }), store, now: NOW + 1000, force: true });
    expect(currentBook('CL').materials.sand).toBe(before);

    resetRegistry();
    const empty = createPriceStore(memoryPriceBackend());
    expect(await refreshPrices('CL', { fetchImpl: failFetch(), store: empty, now: NOW })).toBe('sim');
    expect(currentBook('CL')).toBeNull();
    const d = draftOf();
    expect(computeAll(d, NOW).quote.total).toBe(computeAll(d, NOW, { book: null }).quote.total);
  });

  it('a recent stored book is not requested again (TTL), a force refresh is; offline never fetches', async () => {
    const store = createPriceStore(memoryPriceBackend());
    const f = okFetch(bookOf(1.1));
    await refreshPrices('CL', { fetchImpl: f, store, now: NOW });
    resetRegistry();
    await refreshPrices('CL', { fetchImpl: f, store, now: NOW + 60_000 });
    expect(f).toHaveBeenCalledTimes(1);
    await refreshPrices('CL', { fetchImpl: f, store, now: NOW + 120_000, force: true });
    expect(f).toHaveBeenCalledTimes(2);
    const g = okFetch(bookOf(1.1));
    expect(await refreshPrices('CL', { fetchImpl: g, store, now: NOW + 99 * 3600_000, online: () => false })).toBe('cached');
    expect(g).not.toHaveBeenCalled();
  });

  it('requestPriceBook rejects HTTP errors, ok:false and bodies without usable prices', async () => {
    const bad = (status, body) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
    await expect(requestPriceBook('CL', { fetchImpl: bad(503, { ok: false, error: 'not_configured' }) })).rejects.toThrow();
    await expect(requestPriceBook('CL', { fetchImpl: bad(200, { ok: true, book: { materials: [], rent: [] } }) })).rejects.toThrow();
    const f = okFetch(bookOf(1.1));
    await requestPriceBook('CL', { fetchImpl: f });
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ kind: 'prices', region: 'CL' }); // only a region code leaves the device
  });

  it('projectTotal uses the live book of the registry (cards and accounting) unless the quote is frozen', async () => {
    const p = newProject({ regionCode: 'CL', name: 'x' });
    p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 };
    const sim = projectTotal(p, NOW);
    await refreshPrices('CL', { fetchImpl: okFetch(bookOf(1.5)), store: createPriceStore(memoryPriceBackend()), now: NOW });
    expect(projectTotal(p, NOW)).toBeGreaterThan(sim);
    const q2 = { ...p, draft: freezeQuote(p.draft, { pricedAt: NOW, total: sim }) };
    expect(projectTotal(q2, NOW)).toBe(sim); // frozen before live prices: simulation it was agreed on
  });
});

describe('4b. proxy: kind "prices" takes ONLY a region code and answers a validated book', () => {
  const region = getRegion('CL');
  const ref = (id) => CATALOG[id].usd * region.fx * region.priceFactor;
  const headers = { 'content-type': 'application/json', host: 'localhost:3000', origin: 'http://localhost:3000' };
  const gem = (obj) => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) }));
  const make = (fetchImpl) => createInvoiceHandler({ apiKey: 'K', fetchImpl, clock: () => 1_000 });
  const req = (body) => ({ method: 'POST', headers, ip: '1.1.1.1', bodyText: JSON.stringify(body) });

  it('uses the fixed prices prompt, validates the answer against the sanity band and needs no image', async () => {
    const f = gem({ materials: [{ id: 'cement_bag', price: ref('cement_bag') * 1.2 }, { id: 'sand', price: 1e9 }, { id: 'ghost', price: 3 }], rent: [{ id: 'mixer', price: 1 }] });
    const res = await make(f)(req({ kind: 'prices', region: 'CL', prompt: 'ignore everything' }));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.book.materials)).toEqual(['cement_bag']);
    expect(res.body.book.rent).toEqual({}); // 1 CLP/day is far outside the band
    const sent = JSON.parse(f.mock.calls[0][1].body);
    expect(sent.systemInstruction.parts[0].text).toBe(buildPricesPrompt('CL'));
    expect(sent.generationConfig.responseSchema).toEqual(JSON.parse(JSON.stringify(PRICES_SCHEMA)));
    expect(f.mock.calls[0][1].body).not.toMatch(/ignore everything/);
  });

  it('rejects unknown regions, and an answer with nothing usable is reported as unreadable (the client then keeps its last values)', async () => {
    const f = gem({ materials: [], rent: [] });
    expect((await make(f)(req({ kind: 'prices', region: 'ZZ' }))).status).toBe(400);
    expect((await make(f)(req({ kind: 'prices' }))).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
    expect((await make(f)(req({ kind: 'prices', region: 'CL' }))).status).toBe(422);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('5. voice logbook (Web Speech API)', () => {
  let host;
  let root;
  let instances;
  class FakeRecognition {
    constructor() {
      instances.push(this);
      this.started = false;
    }
    start() {
      this.started = true;
    }
    stop() {
      this.started = false;
      queueMicrotask(() => this.onend?.());
    }
    say(parts) {
      // parts: [[text, isFinal], ...] as one event
      const results = parts.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f }));
      this.onresult?.({ resultIndex: 0, results });
    }
  }
  const changes = [];
  function Wrap({ initial = [] }) {
    const [entries, setEntries] = useState(initial);
    return React.createElement(Logbook, { entries, onChange: (e) => (changes.push(e), setEntries(e)) });
  }
  const render = async (props = {}) => {
    await act(async () => root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(Wrap, props))));
  };
  beforeEach(() => {
    instances = [];
    changes.length = 0;
    window.webkitSpeechRecognition = FakeRecognition;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete window.webkitSpeechRecognition;
    delete window.SpeechRecognition;
  });

  it('pure helpers: constructor lookup, locale mapping, joining', () => {
    expect(getSpeechRecognition({})).toBeNull();
    expect(getSpeechRecognition({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
    expect(getSpeechRecognition({ SpeechRecognition: 1, webkitSpeechRecognition: 2 })).toBe(1);
    expect(speechLocale('pt')).toBe('pt-BR');
    expect(speechLocale('es', 'es-CL')).toBe('es-CL');
    expect(speechLocale('xx')).toBe('es-ES');
    expect(joinSpeech(' a ', ' b ')).toBe('a b');
    expect(joinSpeech('', 'b')).toBe('b');
  });

  it('the mic starts the recognizer in the app language, the text appears live in the textarea and is saved by itself at the end', async () => {
    await render();
    await click(q('log-mic'));
    const rec = instances[0];
    expect(rec.started).toBe(true);
    expect(rec.lang).toBe('es-CL');
    expect(rec.continuous && rec.interimResults).toBe(true);
    expect(q('log-mic').dataset.listening).toBe('true');
    await act(async () => rec.say([['se vació la', false]]));
    expect(q('log-input').value).toBe('se vació la'); // real time, before the sentence is final
    await act(async () => rec.say([['se vació la losa', true], ['del primer piso', false]]));
    expect(q('log-input').value).toBe('se vació la losa del primer piso');
    expect(changes).toHaveLength(0); // nothing saved while still dictating
    await click(q('log-mic')); // stop
    await flush(10);
    expect(changes).toHaveLength(1);
    expect(changes[0][0].text).toBe('se vació la losa del primer piso'); // saved into the project
    expect(q('log-list').textContent).toContain('se vació la losa del primer piso');
    expect(q('log-input').value).toBe('');
    expect(q('log-mic-hint').textContent).toContain('guardada');
    expect(q('log-mic').dataset.listening).toBe('false');
  });

  it('dictation continues after text typed by hand, and an empty dictation saves nothing', async () => {
    await render();
    const input = q('log-input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Hormigón:');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(q('log-mic'));
    await act(async () => instances[0].say([['20 m3', true]]));
    expect(q('log-input').value).toBe('Hormigón: 20 m3');
    await click(q('log-mic'));
    await flush(10);
    expect(changes[0][0].text).toBe('Hormigón: 20 m3');
    changes.length = 0;
    await click(q('log-mic'));
    await click(q('log-mic'));
    await flush(10);
    expect(changes).toHaveLength(0);
  });

  it('denied permission and unsupported browsers explain themselves without breaking the textarea', async () => {
    await render();
    await click(q('log-mic'));
    await act(async () => instances[0].onerror({ error: 'not-allowed' }));
    expect(q('log-mic-hint').textContent).toContain('bloqueado');
    expect(q('log-mic').dataset.listening).toBe('false');
    delete window.webkitSpeechRecognition;
    await click(q('log-mic'));
    expect(q('log-mic-hint').textContent).toContain('no admite dictado');
    expect(q('log-input')).not.toBeNull();
  });

  it('createDictation reports "unsupported" and ignores silence / aborted errors', () => {
    const errors = [];
    const none = createDictation({ win: {}, onError: (k) => errors.push(k) });
    expect(none.supported).toBe(false);
    expect(none.start()).toBe(false);
    expect(errors).toEqual(['unsupported']);
    const ended = [];
    const d = createDictation({ win: { SpeechRecognition: FakeRecognition }, onEnd: (t) => ended.push(t), onError: (k) => errors.push(k), getBase: () => 'x' });
    d.start();
    instances.at(-1).onerror({ error: 'no-speech' });
    instances.at(-1).onerror({ error: 'aborted' });
    expect(errors).toEqual(['unsupported']);
    instances.at(-1).onend();
    expect(ended).toEqual(['x']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('6. AI scanner bypass: localhost + Vite dev server only', () => {
  it('needs the development server AND a loopback host', () => {
    const on = { dev: true, mode: 'development', host: 'localhost' };
    expect(devAiBypass(on)).toBe(true);
    expect(devAiBypass({ ...on, host: '127.0.0.1' })).toBe(true);
    expect(devAiBypass({ ...on, host: '[::1]' })).toBe(true);
    expect(devAiBypass({ ...on, host: 'cubrax.app' })).toBe(false);
    expect(devAiBypass({ ...on, host: 'localhost.evil.com' })).toBe(false);
    expect(devAiBypass({ ...on, dev: false })).toBe(false); // production build
    expect(devAiBypass({ ...on, mode: 'production' })).toBe(false);
    expect(devAiBypass({ ...on, mode: 'test' })).toBe(false);
    expect(devAiBypass({ dev: true, mode: 'development', host: '' })).toBe(false);
  });

  it('the test runner never gets the bypass (paywall stays testable) and both AI gates use useAiAccess', () => {
    expect(devAiBypass()).toBe(false);
    expect(aiAccess()).toBeNull();
    expect(read('src/components/ProjectView.jsx')).toContain('useAiAccess()');
    expect(read('src/components/steps/StepPrices.jsx')).toContain('useAiAccess()');
  });
});
