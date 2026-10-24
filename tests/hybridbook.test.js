// @vitest-environment happy-dom
// "Libro Maestro Híbrido": user price (1) > live AI price (2) > local simulation (3); editable inputs; persistence.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import StepPrices from '../src/components/steps/StepPrices.jsx';
import { newDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { CATALOG } from '../src/lib/catalog.js';
import { getRegion } from '../src/lib/regions.js';
import { MAX_USER_PRICE, hasAiPrices, mergeBooks, normalizeBook, savedMaterial, savedRent, withUserPrice } from '../src/lib/priceBook.js';
import { resolvePrices } from '../src/lib/pricing.js';
import { machineryRate } from '../src/lib/machinery.js';
import { usePriceBook } from '../src/lib/usePrices.js';
import { refreshPrices, saveUserPrice, flushUserPrices, setPriceFeedEnabled } from '../src/lib/priceFeed.js';
import { currentBook, publish, resetRegistry } from '../src/lib/priceRegistry.js';
import { createPriceStore, memoryPriceBackend, priceStore } from '../src/lib/priceStore.js';
import { freezeQuote } from '../src/lib/signature.js';
import { buildPricesPrompt, PRICES_QUOTER_RULE } from '../server/geminiProxy.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const NOW = new Date(2026, 9, 22, 9, 0, 0).getTime();
const region = getRegion('CL');
const ref = (id) => CATALOG[id].usd * region.fx * region.priceFactor;
const aiBook = (k = 1.2) => ({ region: 'CL', at: NOW, materials: Object.fromEntries(Object.keys(CATALOG).map((id) => [id, ref(id) * k])), rent: { mixer: 30 * region.fx * region.priceFactor * k } });
const draftOf = () => {
  const d = newDraft('CL', 'quick');
  d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
  return d;
};
const okFetch = (book) => async () => ({ ok: true, status: 200, json: async () => ({ ok: true, book }) });
const failFetch = async () => {
  throw new TypeError('offline');
};

beforeEach(() => {
  resetRegistry();
  setPriceFeedEnabled(false);
});

// ---------------------------------------------------------------------------------------------------------------
describe('1. hierarchy: user price > live AI > simulation', () => {
  it('withUserPrice keeps the user layer apart from the AI layer, validates it and can remove it again', () => {
    const ai = normalizeBook(aiBook(), 'CL');
    const b1 = withUserPrice(ai, 'CL', 'materials', 'sand', 12345, 111);
    expect(b1.user.materials.sand).toBe(12345);
    expect(b1.materials.sand).toBe(ai.materials.sand); // AI layer untouched
    expect(savedMaterial(b1, 'CL', 'sand')).toBe(12345);
    expect(savedMaterial(b1, 'AR', 'sand')).toBeUndefined();
    const b2 = withUserPrice(b1, 'CL', 'rent', 'mixer', 40000);
    expect(savedRent(b2, 'CL', 'mixer')).toBe(40000);
    // no sanity band for the user's own price (only a hard ceiling), unknown ids / junk are dropped
    expect(withUserPrice(null, 'CL', 'materials', 'sand', ref('sand') * 20).user.materials.sand).toBeGreaterThan(ref('sand') * 19);
    expect(withUserPrice(null, 'CL', 'materials', 'sand', MAX_USER_PRICE * 2)).toBeNull();
    expect(withUserPrice(null, 'CL', 'materials', 'nope', 5)).toBeNull();
    // removing the last user price of a book without AI prices leaves nothing
    expect(withUserPrice(withUserPrice(null, 'CL', 'materials', 'sand', 5), 'CL', 'materials', 'sand', null)).toBeNull();
    expect(withUserPrice(b2, 'CL', 'materials', 'sand', null).user.materials.sand).toBeUndefined();
    expect(hasAiPrices(withUserPrice(null, 'CL', 'materials', 'sand', 5))).toBe(false); // user-only book = still no market data
    expect(hasAiPrices(ai)).toBe(true);
  });

  it('normalizeBook and mergeBooks keep the user layer; a new AI answer can never overwrite it', () => {
    const mine = withUserPrice(normalizeBook(aiBook(1.1), 'CL'), 'CL', 'materials', 'cement_bag', 9999);
    expect(normalizeBook(JSON.parse(JSON.stringify(mine)), 'CL')).toEqual(mine); // survives IndexedDB / JSON
    const merged = mergeBooks(mine, normalizeBook(aiBook(1.5), 'CL'));
    expect(merged.user.materials.cement_bag).toBe(9999);
    expect(merged.materials.cement_bag).toBeGreaterThan(mine.materials.cement_bag); // the AI layer moved on
  });

  it('resolvePrices: this project\'s override > saved user price > live AI > reference, each labelled with its source', () => {
    const ids = ['cement_bag', 'sand', 'gravel', 'mesh'];
    const base = normalizeBook({ ...aiBook(), materials: { cement_bag: ref('cement_bag') * 1.2, sand: ref('sand') * 1.2, gravel: ref('gravel') * 1.2 } }, 'CL');
    const book = withUserPrice(withUserPrice(base, 'CL', 'materials', 'sand', 777), 'CL', 'materials', 'cement_bag', 888);
    const p = resolvePrices({ ids, regionCode: 'CL', chainId: 'sodimac', overrides: { cement_bag: 555 }, bucket: 1, book });
    expect(p.cement_bag).toMatchObject({ price: 555, source: 'manual' }); // typed in this project
    expect(p.sand).toMatchObject({ price: 777, source: 'saved' }); // the user's standard price
    expect(p.gravel.source).toBe('ai'); // live AI where the user has nothing
    expect(p.gravel.price).toBeGreaterThan(p.mesh.ref * 0 + 0);
    expect(p.mesh.source).toBe('ref'); // nothing known: simulation
    expect(resolvePrices({ ids: ['sand'], regionCode: 'CL', chainId: 'best', bucket: 1, book }).sand).toMatchObject({ price: 777, source: 'saved' }); // any chain
  });

  it('machinery: the saved daily rate beats the AI rate, which beats the simulation', () => {
    const base = normalizeBook(aiBook(1.5), 'CL');
    const own = withUserPrice(base, 'CL', 'rent', 'mixer', 41000);
    expect(machineryRate('mixer', 'CL', 0, own)).toBe(41000);
    expect(machineryRate('mixer', 'CL', 0, base)).toBeGreaterThan(machineryRate('mixer', 'CL', 0, null) * 1.2);
  });

  it('a saved price changes the whole quote, and a signed / frozen quote keeps the book it was agreed with', () => {
    const d = draftOf();
    const before = computeAll(d, NOW, { book: null });
    const own = withUserPrice(null, 'CL', 'materials', before.quote.items[0].id, before.quote.items[0].unitPrice * 2);
    const after = computeAll(d, NOW, { book: own });
    expect(after.quote.total).toBeGreaterThan(before.quote.total);
    expect(after.quote.items[0].source).toBe('saved');
    const frozen = freezeQuote(d, { pricedAt: NOW, total: after.quote.total, book: after.book });
    const later = withUserPrice(own, 'CL', 'materials', before.quote.items[0].id, before.quote.items[0].unitPrice * 5);
    expect(computeAll(frozen, NOW, { book: later }).quote.total).toBe(after.quote.total); // later edits never touch a signed quote
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('1b. feed + IndexedDB: the user value is saved at once, persisted, and survives the AI answer and a restart', () => {
  it('saveUserPrice updates the registry immediately and writes the book to the store', async () => {
    const store = createPriceStore(memoryPriceBackend());
    await refreshPrices('CL', { fetchImpl: okFetch(aiBook()), store, now: NOW });
    const written = saveUserPrice('CL', 'materials', 'sand', 4242, { store, debounceMs: 0 });
    expect(savedMaterial(currentBook('CL'), 'CL', 'sand')).toBe(4242); // before the write finished: real time
    expect(await written).toBe(true);
    const row = await store.load('CL');
    expect(row.user.materials.sand).toBe(4242);
    expect(row.materials.sand).toBeGreaterThan(0); // AI layer kept in the same row
  });

  it('typing coalesces into one write with the LAST value; flushUserPrices writes pending values now', async () => {
    const store = createPriceStore(memoryPriceBackend());
    const p = [1, 12, 123].map((n) => saveUserPrice('CL', 'materials', 'sand', n * 100, { store, debounceMs: 30 }));
    expect(await store.load('CL')).toBeNull(); // nothing written yet
    expect(await Promise.all(p)).toEqual([true, true, true]);
    expect((await store.load('CL')).user.materials.sand).toBe(12300);
    saveUserPrice('CL', 'rent', 'mixer', 50000, { store, debounceMs: 60_000 });
    await flushUserPrices(store);
    expect((await store.load('CL')).user.rent.mixer).toBe(50000);
  });

  it('a new session offline keeps the user price (priority 1) and the last AI values; with no AI ever it stays simulation mode', async () => {
    const store = createPriceStore(memoryPriceBackend());
    await refreshPrices('CL', { fetchImpl: okFetch(aiBook(1.4)), store, now: NOW });
    await saveUserPrice('CL', 'materials', 'sand', 3333, { store, debounceMs: 0 });
    resetRegistry(); // app restart
    expect(await refreshPrices('CL', { fetchImpl: failFetch, store, now: NOW + 10 * 3600_000, force: true })).toBe('cached');
    expect(savedMaterial(currentBook('CL'), 'CL', 'sand')).toBe(3333);
    expect(currentBook('CL').materials.cement_bag).toBeGreaterThan(0);

    resetRegistry();
    const empty = createPriceStore(memoryPriceBackend());
    await saveUserPrice('CL', 'materials', 'gravel', 5555, { store: empty, debounceMs: 0 });
    resetRegistry();
    expect(await refreshPrices('CL', { fetchImpl: failFetch, store: empty, now: NOW })).toBe('sim'); // user-only book = no market data
    expect(savedMaterial(currentBook('CL'), 'CL', 'gravel')).toBe(5555);
    expect(computeAll(draftOf(), NOW).quote.items.length).toBeGreaterThan(0);
  });

  it('a fresh AI answer never overwrites the user price, even when the user typed while the request was in flight', async () => {
    const store = createPriceStore(memoryPriceBackend());
    await saveUserPrice('CL', 'materials', 'sand', 2222, { store, debounceMs: 0 });
    let release;
    const slow = () => new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => ({ ok: true, book: aiBook(2) }) }); });
    const job = refreshPrices('CL', { fetchImpl: slow, store, now: NOW, force: true });
    await new Promise((r) => setTimeout(r, 5));
    await saveUserPrice('CL', 'materials', 'gravel', 6666, { store, debounceMs: 0 }); // typed during the request
    release();
    expect(await job).toBe('fresh');
    const book = currentBook('CL');
    expect(book.user.materials).toMatchObject({ sand: 2222, gravel: 6666 });
    expect(book.materials.sand).toBeGreaterThan(ref('sand') * 1.9); // and the AI layer did update
    expect(resolvePrices({ ids: ['sand'], regionCode: 'CL', chainId: 'best', bucket: 1, book }).sand.source).toBe('saved');
  });

  it('removing a price forgets it; with nothing left the stored row is deleted', async () => {
    const store = createPriceStore(memoryPriceBackend());
    await saveUserPrice('CL', 'materials', 'sand', 100, { store, debounceMs: 0 });
    expect(await store.load('CL')).not.toBeNull();
    await saveUserPrice('CL', 'materials', 'sand', null, { store, debounceMs: 0 });
    expect(currentBook('CL')).toBeNull();
    expect(await store.load('CL')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('2. editable prices in the price screen', () => {
  let host;
  let root;
  const q = (id) => document.querySelector(`[data-testid="${id}"]`);
  const probe = {};
  const typeInto = (input, value) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 5));
    });
  function Harness() {
    const [draft, setDraft] = useState(() => {
      const d = draftOf();
      d.partidas[0] = { ...d.partidas[0], task: 'slab' };
      return d;
    });
    probe.draft = draft;
    const book = usePriceBook('CL'); // re-renders when the registry changes, exactly like the real wizard
    const result = useMemo(() => computeAll(draft, NOW), [draft, book]); // eslint-disable-line react-hooks/exhaustive-deps
    probe.result = result;
    return React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(StepPrices, { draft, setDraft, result, now: NOW, onRefresh: () => {}, onPro: () => {} }));
  }
  beforeEach(async () => {
    await priceStore.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await flushUserPrices();
    act(() => root.unmount());
    host.remove();
  });

  it('every material price is an editable numeric input showing the price in use, with an AI / saved / reference indicator', async () => {
    publish('CL', { book: normalizeBook(aiBook(1.3), 'CL'), state: 'fresh', at: NOW });
    await act(async () => root.render(React.createElement(Harness)));
    const items = probe.result.quote.items;
    expect(items.length).toBeGreaterThan(2);
    const inputs = [...host.querySelectorAll('li.card input[type="text"]')].filter((i) => /Precio manual/.test(i.getAttribute('aria-label') || ''));
    expect(inputs).toHaveLength(items.length);
    inputs.forEach((input, i) => expect(Number(input.value.replace(',', '.'))).toBe(items[i].unitPrice)); // the value itself, not a placeholder
    const rents = new Set(probe.result.machinery.items.map((i) => i.id)).size;
    expect(host.querySelectorAll('[data-testid="src-ai"]').length).toBe(items.length + rents); // green AI indicator on each material and rental
    expect(host.querySelector('[data-testid="src-ai"] svg')).not.toBeNull();
    expect(host.querySelector('[data-testid="prices-save-hint"]')).not.toBeNull();
  });

  it('editing a price updates the quote in real time and saves it as the user\'s standard price in IndexedDB', async () => {
    publish('CL', { book: normalizeBook(aiBook(1.3), 'CL'), state: 'fresh', at: NOW });
    await act(async () => root.render(React.createElement(Harness)));
    const first = probe.result.quote.items[0];
    const totalBefore = probe.result.quote.total;
    const input = [...host.querySelectorAll('li.card input[type="text"]')].find((i) => /Precio manual/.test(i.getAttribute('aria-label') || ''));
    const newPrice = first.unitPrice * 3;
    await typeInto(input, String(newPrice));
    expect(probe.result.quote.total).toBeGreaterThan(totalBefore); // total moves immediately
    expect(probe.result.quote.items[0].unitPrice).toBe(newPrice);
    expect(probe.draft.overrides[first.id]).toBe(newPrice); // this project
    expect(savedMaterial(currentBook('CL'), 'CL', first.id)).toBe(newPrice); // the device's standard price
    await act(async () => { await flushUserPrices(); });
    expect((await priceStore.load('CL')).user.materials[first.id]).toBe(newPrice); // persisted
    expect(host.querySelector('[data-testid="src-saved"]')).not.toBeNull(); // gold "Tu precio" indicator replaces the AI one
    // a NEW project of the same region starts from the saved price (priority 1) instead of the AI value
    const fresh = computeAll(draftOf(), NOW);
    expect(fresh.quote.items.find((i) => i.id === first.id)).toMatchObject({ unitPrice: newPrice, source: 'saved' });
    // "use reference" forgets it everywhere
    const reset = [...host.querySelectorAll('li.card button')].find((b) => b.textContent === 'Usar referencia');
    await act(async () => { reset.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 5)); });
    expect(probe.draft.overrides[first.id]).toBeUndefined();
    expect(savedMaterial(currentBook('CL'), 'CL', first.id)).toBeUndefined();
    expect(probe.result.quote.items[0].source).toBe('ai');
  });

  it('empty or zero while typing is ignored (the price in use does not collapse)', async () => {
    publish('CL', { book: normalizeBook(aiBook(1.3), 'CL'), state: 'fresh', at: NOW });
    await act(async () => root.render(React.createElement(Harness)));
    const first = probe.result.quote.items[0];
    const input = [...host.querySelectorAll('li.card input[type="text"]')].find((i) => /Precio manual/.test(i.getAttribute('aria-label') || ''));
    await typeInto(input, '');
    await typeInto(input, '0');
    expect(probe.result.quote.items[0].unitPrice).toBe(first.unitPrice);
    expect(probe.draft.overrides[first.id]).toBeUndefined();
  });

  it('machinery rentals are editable too: the daily rate moves the quote and is saved as the user\'s rate', async () => {
    publish('CL', { book: normalizeBook(aiBook(1.3), 'CL'), state: 'fresh', at: NOW });
    await act(async () => root.render(React.createElement(Harness)));
    const mixer = probe.result.machinery.items.find((i) => i.id === 'mixer');
    if (!mixer) throw new Error('the test project needs a concrete mixer');
    expect(q('rent-prices')).not.toBeNull();
    expect(q('rent-mixer').querySelector('[data-testid="src-ai"]')).not.toBeNull();
    const input = q('rent-mixer').querySelector('input[type="text"]');
    expect(Number(input.value.replace(',', '.'))).toBe(mixer.rate);
    const totalBefore = probe.result.quote.total;
    await typeInto(input, String(mixer.rate * 2));
    expect(probe.result.machinery.items.find((i) => i.id === 'mixer').rate).toBe(mixer.rate * 2);
    expect(probe.result.quote.total).toBeGreaterThan(totalBefore);
    expect(savedRent(currentBook('CL'), 'CL', 'mixer')).toBe(mixer.rate * 2);
    await act(async () => { await flushUserPrices(); });
    expect((await priceStore.load('CL')).user.rent.mixer).toBe(mixer.rate * 2);
    expect(q('rent-mixer').querySelector('[data-testid="src-saved"]')).not.toBeNull();
  });

  it('with no AI data at all the indicator says reference (simulation)', async () => {
    await act(async () => root.render(React.createElement(Harness)));
    expect(host.querySelectorAll('[data-testid="src-ref"]').length).toBe(probe.result.quote.items.length + new Set(probe.result.machinery.items.map((i) => i.id)).size);
    expect(host.querySelector('[data-testid="src-ai"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('3. server prompt: expert quoter of the received country', () => {
  it('uses the strict instruction with the country code and lists that country\'s local retailers', () => {
    expect(PRICES_QUOTER_RULE).toContain('Debes actuar como un cotizador experto');
    expect(PRICES_QUOTER_RULE).toContain('busca en internet los precios minoristas vigentes');
    expect(PRICES_QUOTER_RULE).toContain('evitando promedios históricos obsoletos');
    const cl = buildPricesPrompt('CL');
    expect(cl).toContain('Identifica el país (CL)');
    expect(cl).toContain('Sodimac');
    const es = buildPricesPrompt('ES');
    expect(es).toContain('Identifica el país (ES)');
    expect(es).toContain('Leroy Merlin');
    expect(buildPricesPrompt('MX')).toContain('Identifica el país (MX)');
    expect(cl).not.toContain('{country_code}');
    expect(cl).toContain('MATERIALS:');
    expect(cl).toContain('CLP');
  });
});
