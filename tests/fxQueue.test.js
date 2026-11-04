// "Moneda Base inmutable" in the offline receipt queue (node environment, like offlinestack.test.js): the rate is frozen in the background.
import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { acceptReviewed, drainReceiptQueue } from '../src/lib/receiptSync.js';
import { createReceiptQueue, idbQueueBackend } from '../src/lib/receiptQueue.js';

const NOW = Date.now();

describe('the offline queue freezes the rate in the background', () => {
  const JPEG = `data:image/jpeg;base64,${Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 7) % 251)).toString('base64')}`;
  const ID = 'proyecto01ab';
  const queueOn = () => createReceiptQueue(idbQueueBackend(new IDBFactory()));
  const job = () => ({ projectId: ID, image: JPEG, regionCode: 'CL', currency: 'CLP', lang: 'es' });
  const receiptEur = () => ({ isReceipt: true, currency: 'EUR', supplier: 'Conad', date: '', items: [{ description: 'Pane', quantity: 1, amount: 10, category: 'food', returnDate: '' }] });
  const apply = () => {
    const calls = [];
    return { calls, fn: async (projectId, expenses) => (calls.push({ projectId, expenses }), true) };
  };

  it('a real rate (service / cache) is frozen and applied without asking anyone', async () => {
    const q = queueOn();
    await q.enqueue(job());
    const a = apply();
    const res = await drainReceiptQueue({ queue: q, apply: a.fn, request: async () => receiptEur(), online: () => true, resolve: async () => ({ rate: 1000, source: 'api', at: NOW }), now: () => NOW });
    expect(res.review).toHaveLength(0);
    expect(a.calls).toHaveLength(1);
    expect(a.calls[0].expenses[0]).toMatchObject({ currency: 'CLP', currencyOriginal: 'EUR', amountOriginal: 10, exchangeRate: 1000, amountBase: 10000, amount: 10000, fxSource: 'api' });
    expect(await q.list()).toHaveLength(0);
  });
  it('an approximate rate waits for the user; accepting it freezes the approximation (marked "static")', async () => {
    const q = queueOn();
    await q.enqueue(job());
    const a = apply();
    const resolve = async () => ({ rate: 900, source: 'static', at: NOW });
    const res = await drainReceiptQueue({ queue: q, apply: a.fn, request: async () => receiptEur(), online: () => true, resolve, now: () => NOW });
    expect(res.review).toHaveLength(1);
    expect(a.calls).toHaveLength(0);
    const [row] = await q.list();
    const ok = await acceptReviewed(row, { queue: q, apply: a.fn, resolve, now: () => NOW });
    expect(ok).toBeTruthy();
    expect(a.calls[0].expenses[0]).toMatchObject({ amountBase: 9000, exchangeRate: 900, fxSource: 'static' });
  });
  it('no rate at all: accepting does nothing and the receipt stays in review', async () => {
    const q = queueOn();
    await q.enqueue(job());
    const a = apply();
    await drainReceiptQueue({ queue: q, apply: a.fn, request: async () => receiptEur(), online: () => true, resolve: async () => null, now: () => NOW });
    const [row] = await q.list();
    expect(row.status).toBe('review');
    expect(await acceptReviewed(row, { queue: q, apply: a.fn, resolve: async () => null, now: () => NOW })).toBe(0);
    expect(a.calls).toHaveLength(0);
    expect(await q.list()).toHaveLength(1);
  });
});

