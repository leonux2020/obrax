// Offline resilience: Blob storage for photos, the bundled base catalog, and the deferred receipt queue + its sync.
import { describe, it, expect, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import fs from 'node:fs';
import { blobToDataUrl, dataUrlToBlob, isBlob } from '../src/lib/blobs.js';
import { createPhotoStore, idbBackend } from '../src/lib/photoStore.js';
import { STORE_PHOTOS, STORE_RECEIPTS, DB_VERSION, createRunner } from '../src/lib/db.js';
import { CATALOG } from '../src/lib/catalog.js';
import { BASE_CATALOG, basePrice, lookupPrice } from '../src/lib/baseCatalog.js';
import { resolvePrices } from '../src/lib/pricing.js';
import { getRegion } from '../src/lib/regions.js';
import { withUserPrice } from '../src/lib/priceBook.js';
import { createReceiptQueue, idbQueueBackend, normalizeQueued, QUEUE_LIMITS } from '../src/lib/receiptQueue.js';
import { SYNC_MESSAGE, SYNC_TAG, addExpenses, backoffMs, drainReceiptQueue } from '../src/lib/receiptSync.js';
import { InvoiceError } from '../src/lib/invoice.js';
import { newProject } from '../src/lib/projects.js';

// a tiny valid base64 JPEG header is enough: the pipeline only checks the data-URL shape here
const JPEG = `data:image/jpeg;base64,${Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 7) % 251)).toString('base64')}`;
const PHOTO = (slot = 0, dataUrl = JPEG) => ({ slot, dataUrl, width: 10, height: 10, at: 1 });

describe('Blob media', () => {
  it('data URL <-> Blob round-trips byte for byte', async () => {
    const blob = dataUrlToBlob(JPEG);
    expect(isBlob(blob)).toBe(true);
    expect(blob.type).toBe('image/jpeg');
    expect(await blobToDataUrl(blob)).toBe(JPEG);
    expect(dataUrlToBlob('not a data url')).toBeNull();
  });

  it('photos are written to IndexedDB as Blobs (no base64 string in the row) and read back as data URLs', async () => {
    const factory = new IDBFactory();
    const store = createPhotoStore(idbBackend(factory, 'proyecto01'));
    await store.save(PHOTO(0));
    const rows = await createRunner(factory)(STORE_PHOTOS, 'readonly', (s) => s.getAll());
    expect(rows).toHaveLength(1);
    expect(isBlob(rows[0].blob)).toBe(true);
    expect(rows[0].dataUrl).toBeUndefined();
    const loaded = await createPhotoStore(idbBackend(factory, 'proyecto01')).load();
    expect(loaded[0].dataUrl).toBe(JPEG);
  });

  it('rows written by the previous version (data URL in the row) still load', async () => {
    const factory = new IDBFactory();
    await createRunner(factory)(STORE_PHOTOS, 'readwrite', (s) => s.put({ ...PHOTO(1), projectId: 'proyecto01', key: 'proyecto01:1' }));
    const loaded = await createPhotoStore(idbBackend(factory, 'proyecto01')).load();
    expect(loaded[1].dataUrl).toBe(JPEG);
  });

  it('the database has the receipt queue store (v4)', async () => {
    expect(DB_VERSION).toBe(4);
    const factory = new IDBFactory();
    await createRunner(factory)(STORE_RECEIPTS, 'readonly', (s) => s.count());
  });
});

describe('Base catalog (offline price floor)', () => {
  it('is tiny, covers EVERY material and agrees with the in-code catalog', () => {
    const file = fs.statSync(new URL('../src/data/baseCatalog.json', import.meta.url)).size;
    expect(file).toBeLessThan(8_000);
    expect(Object.keys(BASE_CATALOG).sort()).toEqual(Object.keys(CATALOG).sort());
    for (const [id, m] of Object.entries(CATALOG)) expect(BASE_CATALOG[id].usd, id).toBe(m.usd);
  });

  it('lookupPrice: user > AI > base > none, with no network involved', () => {
    const id = 'cement_bag';
    const base = basePrice(id, 'CL');
    expect(base).toBeGreaterThan(0);
    expect(lookupPrice(id, 'CL')).toEqual({ price: base, source: 'base' });
    const ai = { region: 'CL', at: 1, materials: { [id]: 4321 }, rent: {} };
    expect(lookupPrice(id, 'CL', { book: ai })).toEqual({ price: 4321, source: 'ai' });
    const user = withUserPrice(ai, 'CL', 'materials', id, 5555);
    expect(lookupPrice(id, 'CL', { book: user })).toEqual({ price: 5555, source: 'user' });
    expect(lookupPrice(id, 'CL', { book: user, override: 6000 })).toEqual({ price: 6000, source: 'user' });
    expect(lookupPrice('unobtainium', 'CL')).toEqual({ price: null, source: 'none' });
  });

  it('offline with no book at all, a quote still gets a price for every material (source "ref")', () => {
    const prices = resolvePrices({ ids: Object.keys(CATALOG), regionCode: 'CL', chainId: 'best', book: null });
    for (const p of Object.values(prices)) {
      expect(p.price).toBeGreaterThan(0);
      expect(p.source).toBe('ref');
    }
  });
});

// ---- the deferred receipt queue ---------------------------------------------------------------------------------------
const ID = 'proyecto01ab';
const queueOn = () => createReceiptQueue(idbQueueBackend(new IDBFactory()));
const receiptOf = (extra = {}) => ({ isReceipt: true, currency: '', supplier: 'Ferretería Sur', date: '', items: [{ description: 'Cemento', quantity: 2, amount: 9600, category: 'material', returnDate: '' }, { description: 'Andamio', quantity: null, amount: 15000, category: 'tool_rental', returnDate: '2026-12-01' }], ...extra });
const job = (extra = {}) => ({ projectId: ID, image: JPEG, regionCode: 'CL', currency: 'CLP', lang: 'es', ...extra });

describe('receipt queue (IndexedDB)', () => {
  it('parks the photo as a Blob with status "pending" and survives a reload of the store', async () => {
    const factory = new IDBFactory();
    const q1 = createReceiptQueue(idbQueueBackend(factory));
    const row = await q1.enqueue(job());
    expect(row.status).toBe('pending');
    expect(isBlob(row.blob)).toBe(true);
    const q2 = createReceiptQueue(idbQueueBackend(factory)); // "app restarted"
    const rows = await q2.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(row.id);
    expect(await q2.imageOf(rows[0])).toBe(JPEG);
  });

  it('refuses junk, bounds the queue and notifies subscribers', async () => {
    const q = queueOn();
    await expect(q.enqueue(job({ image: 'nope' }))).rejects.toThrow('bad_image');
    await expect(q.enqueue(job({ projectId: 'x' }))).rejects.toThrow('bad_image');
    const seen = [];
    q.subscribe((rows) => seen.push(rows.length));
    await q.enqueue(job());
    expect(seen.at(-1)).toBe(1);
    expect(normalizeQueued({ id: 'abcd', projectId: ID, blob: 'string' })).toBeNull();
    expect(QUEUE_LIMITS.maxItems).toBeGreaterThan(5);
  });

  it('rows left "sending" by a dead page go back to pending on recover()', async () => {
    const q = queueOn();
    const row = await q.enqueue(job());
    await q.update(row.id, { status: 'sending' });
    await q.recover();
    expect((await q.list())[0].status).toBe('pending');
  });
});

describe('receipt sync: nothing is read offline, everything is read when the network is back', () => {
  const apply = () => {
    const calls = [];
    return { calls, fn: async (projectId, expenses) => (calls.push({ projectId, expenses }), true) };
  };

  it('OFFLINE: nothing is sent, nothing is lost', async () => {
    const q = queueOn();
    await q.enqueue(job());
    const request = vi.fn();
    const res = await drainReceiptQueue({ queue: q, apply: apply().fn, request, online: () => false });
    expect(res.skipped).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(await q.list()).toHaveLength(1);
  });

  it('ONLINE: sends the stored image to the proxy call, tabulates the expenses into the project and empties the queue', async () => {
    const q = queueOn();
    await q.enqueue(job());
    const a = apply();
    const request = vi.fn(async () => receiptOf({ currency: 'CLP' }));
    const res = await drainReceiptQueue({ queue: q, apply: a.fn, request, online: () => true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(JPEG); // the same picture that was parked
    expect(request.mock.calls[0][1]).toMatchObject({ currency: 'CLP', lang: 'es' });
    expect(res.done).toHaveLength(1);
    expect(a.calls[0].projectId).toBe(ID);
    expect(a.calls[0].expenses.map((e) => [e.description, e.amount, e.category, e.supplier])).toEqual([
      ['Cemento', 9600, 'material', 'Ferretería Sur'],
      ['Andamio', 15000, 'tool_rental', 'Ferretería Sur'],
    ]);
    expect(a.calls[0].expenses[1].returnDate).toBe('2026-12-01');
    expect(await q.list()).toHaveLength(0);
  });

  it('a connection failure keeps the row (pending, attempts+1, backoff) and stops the run', async () => {
    const q = queueOn();
    await q.enqueue(job({ now: 1 }));
    await q.enqueue(job({ now: 2 }));
    const request = vi.fn(async () => {
      throw new InvoiceError('network');
    });
    const t0 = 1_000_000;
    const res = await drainReceiptQueue({ queue: q, apply: apply().fn, request, online: () => true, now: () => t0 });
    expect(request).toHaveBeenCalledTimes(1); // the second one is not even tried
    const rows = await q.list();
    expect(rows.map((r) => r.status)).toEqual(['pending', 'pending']);
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].nextAt).toBe(t0 + backoffMs(1));
    expect(res.deferred).toBe(2);
    // not due yet -> a second run right away sends nothing
    await drainReceiptQueue({ queue: q, apply: apply().fn, request, online: () => true, now: () => t0 + 1 });
    expect(request).toHaveBeenCalledTimes(1);
    // due again later -> it is retried
    await drainReceiptQueue({ queue: q, apply: apply().fn, request: async () => receiptOf(), online: () => true, now: () => t0 + backoffMs(1) + 1 });
    expect(await q.list()).toHaveLength(0); // both parked receipts went through once the retry time passed
  });

  it('a picture that can never be read is marked failed (kept for the user), not retried forever', async () => {
    const q = queueOn();
    await q.enqueue(job());
    const request = vi.fn(async () => {
      throw new InvoiceError('not_invoice');
    });
    const res = await drainReceiptQueue({ queue: q, apply: apply().fn, request, online: () => true });
    expect(res.failed).toHaveLength(1);
    const [row] = await q.list();
    expect(row).toMatchObject({ status: 'failed', lastError: 'not_invoice' });
    await drainReceiptQueue({ queue: q, apply: apply().fn, request, online: () => true });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('a receipt printed in ANOTHER currency is not tabulated silently: it waits for review', async () => {
    const q = queueOn();
    await q.enqueue(job());
    const a = apply();
    const res = await drainReceiptQueue({ queue: q, apply: a.fn, request: async () => receiptOf({ currency: 'USD' }), online: () => true });
    expect(res.review).toHaveLength(1);
    expect(a.calls).toHaveLength(0);
    const [row] = await q.list();
    expect(row.status).toBe('review');
    expect(row.result.items).toHaveLength(2);
  });

  it('the project was deleted meanwhile: the picture is dropped, no expense is written', async () => {
    const q = queueOn();
    await q.enqueue(job());
    const res = await drainReceiptQueue({ queue: q, apply: async () => false, request: async () => receiptOf(), online: () => true });
    expect(res.done).toHaveLength(0);
    expect(await q.list()).toHaveLength(0);
  });

  it('two drains at once send the picture only once', async () => {
    const q = queueOn();
    await q.enqueue(job());
    const request = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return receiptOf();
    });
    const a = apply();
    await Promise.all([drainReceiptQueue({ queue: q, apply: a.fn, request, online: () => true }), drainReceiptQueue({ queue: q, apply: a.fn, request, online: () => true })]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(a.calls).toHaveLength(1);
  });

  it('addExpenses puts the new lines on top of the project and bumps updatedAt', () => {
    const p = newProject({ regionCode: 'CL', name: 'X' });
    const next = addExpenses(p, [{ id: 'aaaa', amount: 5 }], 99);
    expect(next.expenses[0].id).toBe('aaaa');
    expect(next.updatedAt).toBe(99);
    expect(p.expenses).toHaveLength(0);
  });
});

describe('Background Sync wiring', () => {
  it('the service worker answers the sync tag by waking the open windows with the message the hook listens to', () => {
    const sw = fs.readFileSync(new URL('../plugins/sw.template.js', import.meta.url), 'utf8');
    expect(sw).toContain("addEventListener('sync'");
    expect(sw).toContain(SYNC_TAG);
    expect(sw).toContain(SYNC_MESSAGE);
    expect(SYNC_TAG).toBe('cubrax-receipts');
  });
});
