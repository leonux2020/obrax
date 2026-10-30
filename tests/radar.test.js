// @vitest-environment happy-dom
// "Radar de Mercado": supplier names on prices, passive geolocation (Haversine, 50 km), nearby supplier priority over the AI,
// the IndexedDB v4 -> v5 migration without data loss, and the project-level market (the proxy receives its country code).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectWorkspace from '../src/components/ProjectWorkspace.jsx';
import ToastHost from '../src/components/workspace/ToastHost.jsx';
import { SUPPLIER_RADIUS_KM, getCurrentCoords, haversineKm, normalizeCoords, withinKm } from '../src/lib/geoDistance.js';
import { applyNearby, coveredIds, nearbyLayer, normalizeSupplierEntry, suggestSuppliers, supplierEntryId, upsertEntry } from '../src/lib/suppliers.js';
import { mergeBooks, normalizeBook, savedMeta, withUserPrice } from '../src/lib/priceBook.js';
import { computeAll } from '../src/lib/engine.js';
import { CATALOG } from '../src/lib/catalog.js';
import { getRegion } from '../src/lib/regions.js';
import { DB_NAME, DB_VERSION, STORE_PRICES, STORE_PROJECTS, STORE_SUPPLIERS, createRunner } from '../src/lib/db.js';
import { createSupplierStore, idbSupplierBackend, supplierStore } from '../src/lib/supplierStore.js';
import { currentBook, currentSuppliers, publish, resetRegistry } from '../src/lib/priceRegistry.js';
import { flushUserPrices, loadSuppliers, refreshPrices, resetSupplierCache, saveUserPrice, setPriceFeedEnabled } from '../src/lib/priceFeed.js';
import { createPriceStore, memoryPriceBackend } from '../src/lib/priceStore.js';
import { newProject } from '../src/lib/projects.js';
import { withMarket, priceCaption, partidaGroups, rentRows } from '../src/lib/workspaceModel.js';
import { freezeQuote } from '../src/lib/signature.js';
import { resetToasts } from '../src/lib/notify.js';
import { DICT } from '../src/lib/dict.js';
import { buildPricesPrompt, buildPricesRequest, cleanSkip, createInvoiceHandler } from '../server/geminiProxy.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const NOW = new Date(2026, 9, 22, 9, 0, 0).getTime();
const SANTIAGO = { lat: -33.4489, lng: -70.6693 };
const MAIPU = { lat: -33.511, lng: -70.758 }; // ~12 km from Santiago
const RANCAGUA = { lat: -34.1708, lng: -70.7444 }; // ~81 km
const VALPO = { lat: -33.0472, lng: -71.6127 }; // ~100 km
const region = getRegion('CL');
const ref = (id) => CATALOG[id].usd * region.fx * region.priceFactor;
const aiBook = (k = 1.2) => ({ region: 'CL', at: NOW, materials: Object.fromEntries(Object.keys(CATALOG).map((id) => [id, ref(id) * k])), rent: { mixer: 30 * region.fx * region.priceFactor * k } });
const entry = (over = {}) => normalizeSupplierEntry({ region: 'CL', kind: 'materials', itemId: 'cement_bag', price: 7777, supplierName: 'Ferretería Don Pepe', ...MAIPU, at: 1000, ...over });

// ---- 1 + 2: geography ---------------------------------------------------------------------------------------------------
describe('geoDistance: Haversine, validation, quiet GPS', () => {
  it('great-circle distance', () => {
    expect(haversineKm(SANTIAGO, SANTIAGO)).toBe(0);
    expect(haversineKm(SANTIAGO, MAIPU)).toBeGreaterThan(10);
    expect(haversineKm(SANTIAGO, MAIPU)).toBeLessThan(14);
    expect(haversineKm(SANTIAGO, VALPO)).toBeGreaterThan(95);
    expect(haversineKm(SANTIAGO, VALPO)).toBeLessThan(110);
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.19, 1); // 1° of equator
    expect(haversineKm(SANTIAGO, VALPO)).toBeCloseTo(haversineKm(VALPO, SANTIAGO), 9); // symmetric
    expect(haversineKm(SANTIAGO, null)).toBe(Infinity);
    expect(haversineKm({ lat: 99, lng: 0 }, SANTIAGO)).toBe(Infinity);
    expect(SUPPLIER_RADIUS_KM).toBe(50);
    expect(withinKm(SANTIAGO, MAIPU)).toBe(true);
    expect(withinKm(SANTIAGO, RANCAGUA)).toBe(false);
  });
  it('normalizeCoords accepts only real coordinates', () => {
    expect(normalizeCoords({ lat: '-33.4489', lng: -70.6693 })).toEqual(SANTIAGO);
    expect(normalizeCoords({ lat: 91, lng: 0 })).toBeNull();
    expect(normalizeCoords({ lat: 'x', lng: 0 })).toBeNull();
    expect(normalizeCoords(null)).toBeNull();
    expect(normalizeCoords({})).toBeNull();
  });
  it('getCurrentCoords never throws and never asks again after a denial', async () => {
    const ok = { getCurrentPosition: (s) => s({ coords: { latitude: -33.5, longitude: -70.7 } }) };
    expect(await getCurrentCoords({ geo: ok, permissions: null })).toEqual({ lat: -33.5, lng: -70.7 });
    const asked = vi.fn();
    const denied = { query: async () => ({ state: 'denied' }) };
    expect(await getCurrentCoords({ geo: { getCurrentPosition: asked }, permissions: denied })).toBeNull();
    expect(asked).not.toHaveBeenCalled();
    expect(await getCurrentCoords({ geo: { getCurrentPosition: (_s, e) => e({ code: 1 }) }, permissions: null })).toBeNull();
    expect(await getCurrentCoords({ geo: { getCurrentPosition: () => { throw new Error('boom'); } }, permissions: null })).toBeNull();
    expect(await getCurrentCoords({ geo: null })).toBeNull();
    expect(await getCurrentCoords({ geo: { getCurrentPosition: () => {} }, permissions: null, timeoutMs: 20 })).toBeNull(); // never answers: gives up
  });
});

// ---- 2: priority of the nearby supplier ---------------------------------------------------------------------------------
describe('suppliers: 50 km radius, absolute priority over the AI', () => {
  it('entries are validated; the same supplier in the same cell updates instead of piling up', () => {
    expect(entry()).toMatchObject({ region: 'CL', kind: 'materials', itemId: 'cement_bag', price: 7777, supplierName: 'Ferretería Don Pepe' });
    expect(normalizeSupplierEntry({ ...entry(), itemId: 'nope' })).toBeNull();
    expect(normalizeSupplierEntry({ ...entry(), price: -1 })).toBeNull();
    expect(normalizeSupplierEntry({ ...entry(), region: 'ZZ' })).toBeNull();
    expect(normalizeSupplierEntry({ ...entry(), kind: 'labor' })).toBeNull();
    expect(entry({ lat: undefined, lng: undefined })).toMatchObject({ lat: null, lng: null });
    const a = entry();
    const b = entry({ price: 8000, at: 2000 });
    expect(a.id).toBe(b.id);
    expect(upsertEntry(upsertEntry([], a), b)).toEqual([b]);
    expect(supplierEntryId({ region: 'CL', kind: 'rent', itemId: 'mixer', supplierName: 'Ñandú Ltda.', ...MAIPU })).toContain('nandultda');
  });

  it('only entries within 50 km count; the most recent one wins; entries without a place never match', () => {
    const near = entry();
    const newer = entry({ supplierName: 'Sodimac', price: 9100, at: 5000, lat: SANTIAGO.lat, lng: SANTIAGO.lng });
    const far = entry({ supplierName: 'Easy Rancagua', price: 1, ...RANCAGUA, at: 9000 });
    const nowhere = entry({ supplierName: 'Sin lugar', price: 2, lat: undefined, lng: undefined, at: 9999 });
    const layer = nearbyLayer([near, newer, far, nowhere], SANTIAGO);
    expect(layer.materials.cement_bag.supplierName).toBe('Sodimac');
    expect(layer.materials.cement_bag.distanceKm).toBeLessThan(0.1);
    expect(nearbyLayer([far, nowhere], SANTIAGO).materials).toEqual({});
    expect(nearbyLayer([near], null).materials).toEqual({}); // a project without a place has no radius
  });

  it('applyNearby: nearby supplier > the user\'s generic price > AI; a price tied to another city is dropped; same object when nothing changes', () => {
    const ai = normalizeBook(aiBook(), 'CL');
    const e = entry();
    const b = applyNearby(ai, 'CL', [e], SANTIAGO);
    expect(b.user.materials.cement_bag).toBe(7777);
    expect(b.materials.cement_bag).toBe(ai.materials.cement_bag); // the AI layer is untouched, only outranked
    expect(savedMeta(b, 'CL', 'materials', 'cement_bag')).toMatchObject({ supplierName: 'Ferretería Don Pepe', nearby: true });
    expect(applyNearby(ai, 'CL', [e], RANCAGUA)).toBe(ai); // 81 km: not applied
    expect(applyNearby(ai, 'CL', [e], null)).toBe(ai);
    expect(applyNearby(ai, 'CL', [], SANTIAGO)).toBe(ai);
    // a generic user price that was saved at a supplier of ANOTHER city does not price this project...
    const farPrice = withUserPrice(ai, 'CL', 'materials', 'sand', 55555, NOW, { supplierName: 'Easy Valpo', ...VALPO });
    const here = applyNearby(farPrice, 'CL', [], SANTIAGO);
    expect(here.user.materials.sand).toBeUndefined();
    expect(here.materials.sand).toBe(ai.materials.sand); // ...the AI does
    // ...but one without a place (older books, typed without supplier) still applies everywhere
    const plain = withUserPrice(ai, 'CL', 'materials', 'sand', 55555, NOW);
    expect(applyNearby(plain, 'CL', [], SANTIAGO)).toBe(plain);
  });

  it('the quote follows: 12 km -> supplier price, 81 km -> AI price', () => {
    const p = newProject({ regionCode: 'CL', name: 'Obra', location: { ...SANTIAGO, label: '' } });
    p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 };
    const ai = normalizeBook(aiBook(), 'CL');
    const e = entry({ itemId: 'cement_bag', price: 1234 });
    const unit = (book) => computeAll(p.draft, NOW, { book, chains: false }).quote.items.find((i) => i.id === 'cement_bag').unitPrice;
    expect(unit(applyNearby(ai, 'CL', [e], SANTIAGO))).toBe(1234);
    expect(unit(applyNearby(ai, 'CL', [e], RANCAGUA))).toBe(Math.round(unit(ai)));
    const groups = partidaGroups(computeAll(p.draft, NOW, { book: applyNearby(ai, 'CL', [e], SANTIAGO), chains: false }), p.draft);
    const row = groups[0].rows.find((r) => r.id === 'cement_bag');
    expect(row).toMatchObject({ origin: 'user', supplier: { supplierName: 'Ferretería Don Pepe', nearby: true } });
    expect(priceCaption((k, v) => `${k}|${JSON.stringify(v)}`, { origin: 'user', meta: row.supplier, regionCode: 'CL' })).toContain('ws.supplier.near');
  });

  it('coveredIds: the AI is not asked for what nearby suppliers cover for EVERY project (and only with an AI value to fall back on)', () => {
    const ai = normalizeBook(aiBook(), 'CL');
    const e = entry();
    expect(coveredIds([e], [SANTIAGO], ai).materials).toEqual(['cement_bag']);
    expect(coveredIds([e], [SANTIAGO, RANCAGUA], ai).materials).toEqual([]); // another project 81 km away still needs the market price
    expect(coveredIds([e], [SANTIAGO, null], ai).materials).toEqual([]); // a project without place too
    expect(coveredIds([e], [], ai).materials).toEqual([]);
    expect(coveredIds([e], [SANTIAGO], null).materials).toEqual([]); // no AI value yet: ask anyway
  });

  it('suggestions: previous suppliers first (newest first), then the market\'s retailers, no duplicates', () => {
    const list = suggestSuppliers({ regionCode: 'CL', entries: [entry({ at: 1 }), entry({ supplierName: 'Sodimac', at: 5 }), entry({ supplierName: 'Otro', region: 'MX', at: 9 })] });
    expect(list[0]).toBe('Sodimac');
    expect(list[1]).toBe('Ferretería Don Pepe');
    expect(list.filter((x) => x === 'Sodimac')).toHaveLength(1);
    expect(list.length).toBeGreaterThan(3);
    expect(list).not.toContain('Otro');
  });
});

// ---- 1: schema ---------------------------------------------------------------------------------------------------------
describe('price book: supplierName per price (backward compatible)', () => {
  it('withUserPrice stores the supplier next to the price and never inherits the old one', () => {
    const b1 = withUserPrice(null, 'CL', 'materials', 'sand', 100, NOW, { supplierName: 'Don Pepe', ...SANTIAGO });
    expect(savedMeta(b1, 'CL', 'materials', 'sand')).toEqual({ supplierName: 'Don Pepe', ...SANTIAGO });
    const b2 = withUserPrice(b1, 'CL', 'materials', 'sand', 120, NOW + 1);
    expect(savedMeta(b2, 'CL', 'materials', 'sand')).toBeUndefined();
    expect(b2.user.meta).toBeUndefined(); // nothing to keep: the book looks exactly like before
    const b3 = withUserPrice(withUserPrice(b1, 'CL', 'rent', 'mixer', 50000, NOW, { supplierName: 'Arriendos Sur' }), 'CL', 'materials', 'sand', null);
    expect(b3.user.meta.rent.mixer.supplierName).toBe('Arriendos Sur');
    expect(b3.user.meta.materials).toEqual({});
  });
  it('survives validation, merging with a fresh AI answer and junk meta; books without meta still load', () => {
    const b = withUserPrice(normalizeBook(aiBook(), 'CL'), 'CL', 'materials', 'sand', 100, NOW, { supplierName: '  Don <b>Pepe</b> ', lat: 91, lng: 0 });
    expect(savedMeta(b, 'CL', 'materials', 'sand').supplierName).not.toContain('<');
    expect(savedMeta(b, 'CL', 'materials', 'sand').lat).toBeUndefined(); // invalid coordinates are dropped, the name stays
    const merged = mergeBooks(b, normalizeBook(aiBook(1.5), 'CL'));
    expect(merged.user.meta.materials.sand.supplierName).toBeTruthy();
    expect(merged.materials.cement_bag).toBeCloseTo(ref('cement_bag') * 1.5, 0);
    const old = normalizeBook({ ...aiBook(), user: { materials: { sand: 50 }, rent: {}, at: 5 } }, 'CL'); // written before suppliers existed
    expect(old.user.materials.sand).toBe(50);
    expect(savedMeta(old, 'CL', 'materials', 'sand')).toBeUndefined();
  });
});

// ---- migration ---------------------------------------------------------------------------------------------------------
describe('IndexedDB v4 -> v5 keeps every row', () => {
  it('a v4 database with projects and prices opens as v5, gains supplier_prices and loses nothing', async () => {
    expect(DB_VERSION).toBe(6);
    expect(STORE_SUPPLIERS).toBe('supplier_prices');
    const factory = new IDBFactory();
    await new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, 4);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('photos', { keyPath: 'slot' });
        db.createObjectStore('project_photos', { keyPath: 'key' });
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' }).put({ id: 'p1', name: 'Casa vieja' });
        db.createObjectStore('company', { keyPath: 'key' });
        db.createObjectStore(STORE_PRICES, { keyPath: 'region' }).put({ region: 'CL', at: 1, materials: { sand: 5 }, rent: {}, user: { materials: { sand: 9 }, rent: {}, at: 2 } });
        db.createObjectStore('receipt_queue', { keyPath: 'id' }).put({ id: 'r1' });
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    const run = createRunner(factory);
    expect(await run(STORE_PROJECTS, 'readonly', (s) => s.getAll())).toEqual([{ id: 'p1', name: 'Casa vieja' }]);
    const prices = await run(STORE_PRICES, 'readonly', (s) => s.getAll());
    expect(prices[0].user.materials.sand).toBe(9);
    expect(await run('receipt_queue', 'readonly', (s) => s.count())).toBe(1);
    expect(await run(STORE_SUPPLIERS, 'readonly', (s) => s.count())).toBe(0); // the new store exists
    // and the supplier store works on it
    const store = createSupplierStore(idbSupplierBackend(factory));
    await store.save(entry());
    await store.save({ ...entry(), id: 'junk', itemId: 'nope' }).catch(() => {});
    expect(await store.load('CL')).toHaveLength(1);
    expect(await store.load('MX')).toEqual([]);
    await store.remove(entry().id);
    expect(await store.load('CL')).toEqual([]);
  });
});

// ---- priceFeed ---------------------------------------------------------------------------------------------------------
describe('priceFeed: supplier saves and the request to the proxy', () => {
  beforeEach(async () => {
    resetRegistry();
    resetSupplierCache();
    await supplierStore.clear();
    setPriceFeedEnabled(false);
  });

  const stores = () => ({ store: createPriceStore(memoryPriceBackend()), suppliers: createSupplierStore(null) });

  it('saveUserPrice with a supplier publishes price + entry at once and persists both; without one it is the old behaviour', async () => {
    const { store } = stores();
    const done = saveUserPrice('CL', 'materials', 'cement_bag', 4321, { store, now: NOW, debounceMs: 0, supplier: { name: 'Ferretería Don Pepe', ...MAIPU } });
    await flush();
    expect(currentBook('CL').user.materials.cement_bag).toBe(4321); // at once (no waiting for the write)
    expect(savedMeta(currentBook('CL'), 'CL', 'materials', 'cement_bag').supplierName).toBe('Ferretería Don Pepe');
    expect(currentSuppliers('CL')).toHaveLength(1);
    await done;
    await flushUserPrices(store);
    expect((await store.load('CL')).user.meta.materials.cement_bag.lat).toBe(MAIPU.lat);
    // a plain price afterwards: the book carries no supplier and the nearby entry cannot outrank it any more
    await saveUserPrice('CL', 'materials', 'cement_bag', 5000, { store, now: NOW + 1, debounceMs: 0, near: SANTIAGO });
    expect(savedMeta(currentBook('CL'), 'CL', 'materials', 'cement_bag')).toBeUndefined();
    expect(currentSuppliers('CL')).toHaveLength(0);
    // the old signature still works
    await saveUserPrice('CL', 'rent', 'mixer', 40000, { store, now: NOW + 2, debounceMs: 0 });
    expect(currentBook('CL').user.rent.mixer).toBe(40000);
    expect(currentSuppliers('CL')).toHaveLength(0);
  });

  it('a GPS fix replaces the project-coordinates copy of the same supplier', async () => {
    const { store } = stores();
    await saveUserPrice('CL', 'materials', 'sand', 100, { store, now: NOW, debounceMs: 0, supplier: { name: 'Don Pepe', ...SANTIAGO } });
    expect(currentSuppliers('CL')).toHaveLength(1);
    const fix = { lat: SANTIAGO.lat + 0.3, lng: SANTIAGO.lng }; // another ~10 km cell: would otherwise be a second entry
    await saveUserPrice('CL', 'materials', 'sand', 100, { store, now: NOW + 1, debounceMs: 0, supplier: { name: 'Don Pepe', ...fix, replaces: SANTIAGO } });
    expect(currentSuppliers('CL')).toHaveLength(1);
    expect(currentSuppliers('CL')[0].lat).toBeCloseTo(fix.lat, 4);
  });

  it('reset forgets the supplier prices of that item around the place only', async () => {
    const { store } = stores();
    await saveUserPrice('CL', 'materials', 'sand', 100, { store, now: NOW, debounceMs: 0, supplier: { name: 'A', ...SANTIAGO } });
    await saveUserPrice('CL', 'materials', 'sand', 100, { store, now: NOW + 1, debounceMs: 0, supplier: { name: 'B', ...VALPO } });
    expect(currentSuppliers('CL')).toHaveLength(2);
    await saveUserPrice('CL', 'materials', 'sand', null, { store, now: NOW + 2, debounceMs: 0, supplier: { name: 'A', ...SANTIAGO } });
    expect(currentSuppliers('CL').map((e) => e.supplierName)).toEqual(['B']);
  });

  it('loadSuppliers reads the store once; refreshPrices asks the AI with countryCode and WITHOUT what nearby suppliers cover', async () => {
    const { store, suppliers } = stores();
    await suppliers.save(entry());
    await store.save(normalizeBook({ ...aiBook(), at: NOW - 48 * 3600_000 }, 'CL')); // stale AI values to fall back on
    const bodies = [];
    const fetchImpl = vi.fn(async (_u, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, book: aiBook(1.3) }) };
    });
    expect(await loadSuppliers('CL', { store: suppliers })).toHaveLength(1);
    await refreshPrices('CL', { fetchImpl, store, suppliers, now: NOW, force: true, locations: [SANTIAGO] });
    expect(bodies[0]).toMatchObject({ kind: 'prices', region: 'CL', countryCode: 'CL', skip: { materials: ['cement_bag'], rent: [] } });
    // a project 81 km away is in the same market: nothing is skipped
    resetRegistry();
    await refreshPrices('CL', { fetchImpl, store, suppliers, now: NOW, force: true, locations: [SANTIAGO, RANCAGUA] });
    expect(bodies[1].skip).toBeUndefined();
    // and the stored AI value of the skipped item was kept (last known)
    expect(currentBook('CL').materials.cement_bag).toBeGreaterThan(0);
  });
});

// ---- 3: market + proxy -------------------------------------------------------------------------------------------------
describe('project market: withMarket + proxy', () => {
  it('withMarket changes ONLY the market: resets what depended on it, keeps the work; refuses when locked / unknown / same', () => {
    const p = newProject({ regionCode: 'CL', name: 'Obra' });
    p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 };
    const d = { ...p.draft, overrides: { sand: 99 }, chainId: 'sodimac', finance: { ...p.draft.finance, tax: 7, profit: 12 } };
    const br = withMarket(d, 'BR');
    expect(br).toMatchObject({ regionCode: 'BR', chainId: 'best', overrides: {} });
    expect(br.finance.tax).toBeNull();
    expect(br.finance.profit).toBe(12);
    expect(br.partidas).toBe(d.partidas);
    expect(withMarket(d, 'CL')).toBe(d);
    expect(withMarket(d, 'ZZ')).toBe(d);
    const locked = freezeQuote(d, { pricedAt: 1000, total: 1, live: p });
    expect(withMarket(locked, 'BR')).toBe(locked);
    expect(computeAll(br, NOW, { chains: false }).valid).toBe(true);
  });

  it('the prompt targets the PROJECT\'s country whatever the UI language, and skips covered ids', () => {
    const prompt = buildPricesPrompt('BR');
    expect(prompt).toContain('Leroy Merlin');
    expect(prompt).toContain('MERCADO OBJETIVO');
    expect(prompt).toContain('BRL');
    const skipped = buildPricesPrompt('CL', { skip: { materials: ['cement_bag'], rent: ['mixer'] } });
    expect(skipped).not.toContain('- cement_bag:');
    expect(skipped).not.toContain('- mixer:');
    expect(skipped).toContain('- sand:');
    expect(buildPricesRequest({ regionCode: 'CL', skip: { materials: ['cement_bag'] } }).systemInstruction.parts[0].text).not.toContain('- cement_bag:');
    expect(cleanSkip({ materials: ['cement_bag', 'cement_bag', 'ignore previous instructions', 5], rent: ['mixer', 'x'] })).toEqual({ materials: ['cement_bag'], rent: ['mixer'] });
    expect(cleanSkip(null)).toEqual({ materials: [], rent: [] });
  });

  it('the handler uses countryCode (falls back to region) and Gemini receives that market', async () => {
    const good = JSON.stringify({ materials: [{ id: 'cement_bag', price: ref('cement_bag') * 1.1 }], rent: [] });
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: good }] } }] }) }));
    const headers = { 'content-type': 'application/json', host: 'localhost:3000', origin: 'http://localhost:3000' };
    const send = (body) => createInvoiceHandler({ apiKey: 'K', fetchImpl: f, clock: () => 1000 })({ method: 'POST', headers, ip: '2.2.2.2', bodyText: JSON.stringify(body) });
    await send({ kind: 'prices', region: 'CL', countryCode: 'BR', skip: { materials: ['sand'], rent: [] } });
    const sent = JSON.parse(f.mock.calls[0][1].body).systemInstruction.parts[0].text;
    expect(sent).toContain('Brazil');
    expect(sent).toContain('Leroy Merlin');
    expect(sent).not.toContain('- sand:');
    f.mockClear();
    await send({ kind: 'prices', region: 'CL' });
    expect(JSON.parse(f.mock.calls[0][1].body).systemInstruction.parts[0].text).toContain('(CL)');
    f.mockClear();
    await send({ kind: 'prices', region: 'ZZ', countryCode: 'ZZ' }).then((r) => expect(r.status).toBe(400));
    expect(f).not.toHaveBeenCalled();
    // an unknown countryCode with a valid region still works (region is the older field of the same meaning)
    expect((await send({ kind: 'prices', region: 'CL', countryCode: 'ZZ' })).status).toBe(200);
  });
});

// ---- the screen --------------------------------------------------------------------------------------------------------
let host;
let root;
let spy;
const q = (id) => host.querySelector(`[data-testid="${id}"]`);
const qa = (id) => [...host.querySelectorAll(`[data-testid="${id}"]`)];
const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};
const typeInto = (input, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const keys = async (s) => {
  for (const k of s) await click(q(`pad-${k}`));
};

function Harness({ initial }) {
  const [project, set] = useState(initial);
  const setProject = (u) => set((p) => (typeof u === 'function' ? u(p) : u));
  const setDraft = (u) => set((p) => ({ ...p, draft: typeof u === 'function' ? u(p.draft) : u }));
  spy.project = project;
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      I18nProvider,
      { lang: 'es', regionCode: project.draft.regionCode },
      React.createElement(ProjectWorkspace, { project, setProject, setDraft, photos: [null, null, null, null], setPhotos: () => {}, company: project.company, receipts: null, enqueueReceipt: async () => {}, onBack: () => {}, onEdit: () => {}, onPro: () => {} }),
      React.createElement(ToastHost)
    )
  );
}
const mount = async (initial) => {
  spy = {};
  await act(async () => {
    root.render(React.createElement(Harness, { initial }));
  });
  await flush();
};
const mk = (extra = {}) => {
  const p = newProject({ regionCode: 'CL', name: 'Casa Pérez', client: 'Ana', location: { ...SANTIAGO, label: '' } });
  p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 };
  return { ...p, ...extra };
};

describe('workspace UI', () => {
  beforeEach(async () => {
    localStorage.clear();
    resetRegistry();
    resetSupplierCache();
    await supplierStore.clear();
    resetToasts();
    setPriceFeedEnabled(false);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await flushUserPrices();
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('Lista Viva: AI prices read "Estimación IA (Sodimac)" in small grey text; the base price says so too', async () => {
    publish('CL', { book: normalizeBook(aiBook(), 'CL'), state: 'fresh' });
    await mount(mk());
    await click(q('partida-summary-0'));
    const line = q('supplier-cement_bag');
    expect(line.textContent).toBe(`Estimación IA (${region.chains[0].name})`);
    expect(line.className).toContain('text-xs');
    expect(line.className).toContain('text-gray-500');
  });

  it('numpad: supplier tags on top; picking one saves the price with its name and place; the list shows it', async () => {
    await mount(mk());
    await click(q('partida-summary-0'));
    await click(q('price-cement_bag'));
    expect(q('supplier-bar')).not.toBeNull();
    const chips = qa('supplier-chip').map((c) => c.textContent);
    expect(chips).toContain(region.chains[0].name);
    await click(qa('supplier-chip')[0]);
    await keys('7500');
    expect(q('pad-display').dataset.value).toBe('7500');
    expect(currentBook('CL').user.materials.cement_bag).toBe(7500);
    expect(savedMeta(currentBook('CL'), 'CL', 'materials', 'cement_bag').supplierName).toBe(chips[0]);
    expect(currentSuppliers('CL')[0]).toMatchObject({ itemId: 'cement_bag', price: 7500, lat: SANTIAGO.lat });
    await click(q('pad-done'));
    expect(q('supplier-cement_bag').textContent).toContain(chips[0]);
    expect(q('supplier-cement_bag').textContent).toContain('km');
  });

  it('numpad: a custom supplier ("Ferretería Don Pepe") can be added, is reused next time and is remembered', async () => {
    await mount(mk());
    await click(q('partida-summary-0'));
    await click(q('price-cement_bag'));
    await click(q('supplier-add'));
    await typeInto(q('supplier-input'), 'Ferretería Don Pepe');
    expect(q('supplier-save').disabled).toBe(false);
    await click(q('supplier-save'));
    expect(q('supplier-chip').textContent).toBe('Ferretería Don Pepe');
    expect(q('supplier-chip').dataset.selected).toBe('true');
    await keys('6200');
    await click(q('pad-done'));
    expect(q('supplier-cement_bag').textContent).toContain('Ferretería Don Pepe');
    expect(currentSuppliers('CL').find((e) => e.supplierName === 'Ferretería Don Pepe').price).toBe(6200);
    await click(q('price-sand'));
    expect(qa('supplier-chip')[0].textContent).toBe('Ferretería Don Pepe'); // previous suppliers come first
    await click(q('pad-done'));
  });

  it('numpad without choosing a supplier behaves as before (no supplier, no entry)', async () => {
    await mount(mk());
    await click(q('partida-summary-0'));
    await click(q('price-cement_bag'));
    await keys('5000');
    expect(currentBook('CL').user.materials.cement_bag).toBe(5000);
    expect(currentSuppliers('CL')).toHaveLength(0);
    expect(savedMeta(currentBook('CL'), 'CL', 'materials', 'cement_bag')).toBeUndefined();
    await click(q('pad-done'));
    expect(q('supplier-cement_bag').textContent).toBe('');
  });

  it('machinery rates get the same supplier bar and caption', async () => {
    await mount(mk());
    await click(q('rent-rate-mixer'));
    expect(q('rent-pad').querySelector('[data-testid="supplier-bar"]')).not.toBeNull();
    await click(qa('supplier-chip')[0]);
    await keys('45000');
    expect(currentSuppliers('CL').find((e) => e.kind === 'rent' && e.itemId === 'mixer').price).toBe(45000);
    await click(q('pad-done'));
    expect(q('rent-supplier-mixer').textContent).toContain('km');
  });

  it('globe in the header: the market of THIS project changes, the UI stays in Spanish, the proxy gets the new country', async () => {
    const calls = [];
    setPriceFeedEnabled(true);
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_u, init) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, book: { region: 'BR', at: NOW, materials: {}, rent: {} } }) };
    });
    try {
      await mount(mk());
      expect(q('ws-market').dataset.region).toBe('CL');
      await click(q('ws-market'));
      expect(q('market-list')).not.toBeNull();
      await click(q('market-BR'));
      expect(q('market-warning').textContent).toContain('no se convierten');
      await click(q('market-confirm'));
      expect(spy.project.draft.regionCode).toBe('BR');
      expect(q('ws-market').dataset.region).toBe('BR');
      expect(q('ws-title').textContent).toBe('Casa Pérez');
      expect(q('market-list')).toBeNull();
      expect(q('ws-total').textContent).toContain('BRL'); // Brazilian currency, labels still Spanish
      expect(q('dock-export').textContent.length).toBeGreaterThan(0);
      await flush(20);
      expect(calls.some((c) => c.countryCode === 'BR' && c.region === 'BR')).toBe(true);
    } finally {
      globalThis.fetch = original;
      setPriceFeedEnabled(false);
    }
  });

  it('a locked quote refuses the market change ("Precios bloqueados")', async () => {
    const p = mk();
    await mount({ ...p, draft: freezeQuote(p.draft, { pricedAt: Date.now(), total: 1, live: p }) });
    await click(q('ws-market'));
    expect(q('market-list')).toBeNull();
    expect(q('toast').textContent).toBe('Precios bloqueados');
    expect(spy.project.draft.regionCode).toBe('CL');
  });

  it('the i18n keys of the radar exist in all six languages with the same parameters', () => {
    const keysOf = Object.keys(DICT.es).filter((k) => k.startsWith('ws.supplier.') || k.startsWith('ws.market.'));
    expect(keysOf.length).toBeGreaterThanOrEqual(14);
    for (const l of ['en', 'pt', 'fr', 'it', 'de']) {
      for (const k of keysOf) {
        expect(DICT[l][k], `${l} ${k}`).toBeTruthy();
        expect((DICT[l][k].match(/\{\w+\}/g) || []).sort(), `${l} ${k}`).toEqual((DICT.es[k].match(/\{\w+\}/g) || []).sort());
      }
    }
    expect(rentRows).toBeTypeOf('function');
  });
});
