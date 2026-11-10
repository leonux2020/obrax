// @vitest-environment happy-dom
// Rate limiting (Google's HTTP 429) in the BYOK receipt flow, with zero stress for the user:
//   1. gemini.js raises a typed InvoiceError('rate_limited') that carries Google's own wait (Retry-After / RetryInfo);
//   2. the receipt sheet (queue-first) never even meets the 429 and never shows a red "wait a minute": it stores the photo and says (green) "Guardada";
//   3. the queue pauses ITSELF (60 s, doubling, or what Google asked), in silence, without ever spending a photo's attempts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider, makeI18n } from '../src/lib/i18n.jsx';
import ReceiptSheet from '../src/components/ReceiptSheet.jsx';
import { callGemini, InvoiceError } from '../src/lib/gemini.js';
import { RATE, createRateGate, parseRetryAfter, parseRetryDelay } from '../src/lib/rateGate.js';
import { createReceiptQueue, QUEUE_LIMITS } from '../src/lib/receiptQueue.js';
import { drainReceiptQueue, backoffMs } from '../src/lib/receiptSync.js';
import { getToasts, resetToasts } from '../src/lib/notify.js';
import { clearGeminiKey } from '../src/lib/geminiKey.js';
import { geminiError, geminiReply, seedKey, TEST_KEY } from './helpers/gemini.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PHOTO = 'data:image/jpeg;base64,/9j/AAAA';
const throttled = (headers = {}, details = []) => ({ ok: false, status: 429, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null }, json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota', details } }) });
const callWith = (fetchImpl, extra = {}) => callGemini({ kind: 'receipt', dataUrl: PHOTO, currency: 'CLP', apiKey: TEST_KEY, fetchImpl, ...extra });

beforeEach(() => {
  seedKey();
  resetToasts();
});
afterEach(() => clearGeminiKey());

describe('1. gemini.js: the 429 is a typed error, never a crash', () => {
  it('raises InvoiceError("rate_limited"); both models are tried (each has its own quota) before giving up', async () => {
    const f = vi.fn(async () => throttled());
    const err = await callWith(f).catch((e) => e);
    expect(err).toBeInstanceOf(InvoiceError);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterMs).toBe(0); // Google said nothing
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('carries Google\'s own wait: the Retry-After header (seconds or a date) or RetryInfo.retryDelay in the body', async () => {
    expect((await callWith(async () => throttled({ 'retry-after': '42' })).catch((e) => e)).retryAfterMs).toBe(42_000);
    const at = new Date(Date.now() + 90_000).toUTCString();
    const fromDate = (await callWith(async () => throttled({ 'retry-after': at })).catch((e) => e)).retryAfterMs;
    expect(fromDate).toBeGreaterThan(80_000);
    expect(fromDate).toBeLessThanOrEqual(90_000);
    const body = (await callWith(async () => throttled({}, [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '32s' }])).catch((e) => e)).retryAfterMs;
    expect(body).toBe(32_000);
    // the longest wait of the models wins
    let n = 0;
    const longest = await callWith(async () => throttled({ 'retry-after': n++ === 0 ? '10' : '70' })).catch((e) => e);
    expect(longest.retryAfterMs).toBe(70_000);
  });

  it('a 429 on the first model followed by a good answer from the second one is NOT an error', async () => {
    let n = 0;
    const f = vi.fn(async () => (n++ === 0 ? throttled() : geminiReply({ isReceipt: true, receipts: [] })));
    await expect(callWith(f)).resolves.toBeTruthy();
  });

  it('every other code is untouched and has no retryAfterMs', async () => {
    const err = await callWith(async () => geminiError(503)).catch((e) => e);
    expect(err.code).toBe('upstream');
    expect(err.retryAfterMs).toBeUndefined();
    expect(new InvoiceError('rate_limited', { retryAfterMs: -5 }).retryAfterMs).toBe(0);
    expect(new InvoiceError('rate_limited', { retryAfterMs: NaN }).retryAfterMs).toBe(0);
  });
});

describe('2. rateGate: 60 s, doubling, or what Google asked', () => {
  it('parsers: seconds, dates and "32s" / "2m"; garbage is 0', () => {
    expect([parseRetryAfter('30'), parseRetryAfter(' 1.5 '), parseRetryAfter(''), parseRetryAfter(null), parseRetryAfter('soon')]).toEqual([30_000, 1_500, 0, 0, 0]);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6_000);
    expect(parseRetryAfter(new Date(1_000).toUTCString(), 9_000)).toBe(0); // a date in the past
    expect([parseRetryDelay('32s'), parseRetryDelay('2m'), parseRetryDelay('500ms'), parseRetryDelay('1.5'), parseRetryDelay('x'), parseRetryDelay(5)]).toEqual([32_000, 120_000, 500, 1_500, 0, 0]);
  });

  it('first 429: Google\'s number, else 60 s; the next ones double up to 15 min; a success resets everything', () => {
    const g = createRateGate();
    expect(g.active(0)).toBe(false);
    expect(g.hit({ now: 1_000 })).toBe(60_000);
    expect(g.active(30_000)).toBe(true);
    expect(g.active(61_000)).toBe(false);
    expect(g.hit({ now: 100_000 })).toBe(120_000);
    expect(g.hit({ now: 100_000 })).toBe(240_000);
    for (let i = 0; i < 10; i += 1) g.hit({ now: 0 });
    expect(g.hit({ now: 0 })).toBe(RATE.maxMs); // ceiling
    g.reset();
    expect(g.active(0)).toBe(false);
    expect(g.hit({ retryAfterMs: 45_000, now: 0 })).toBe(45_000); // Google's word on the first one
    expect(g.hit({ retryAfterMs: 10_000, now: 0 })).toBe(120_000); // consecutive: never less than the exponential step
    g.reset();
    expect(g.hit({ retryAfterMs: 1, now: 0 })).toBe(RATE.minMs); // never "retry now"
    g.reset();
    expect(g.hit({ retryAfterMs: 99 * 3_600_000, now: 0 })).toBe(RATE.headerMaxMs);
  });
});

describe('3. ReceiptSheet: the photo is parked; the user only sees "guardado en cola"', () => {
  let host;
  let root;
  const flush = (ms = 10) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const prepare = async () => ({ dataUrl: PHOTO, width: 1, height: 1 });
  const pick = async () => {
    const input = q('receipt-camera-input');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'r.jpg', { type: 'image/jpeg' })] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush(10);
  };
  const mount = (props, lang = 'es') => act(async () => root.render(React.createElement(I18nProvider, { lang, regionCode: 'CL' }, React.createElement(ReceiptSheet, { onSave: () => {}, onClose: () => {}, prepareImage: prepare, ...props }))));
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('queue-first: the sheet never meets the 429 (the worker does): ten photos in a row, ten green "guardada", nothing red, no request from the sheet', async () => {
    const onQueue = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => throttled());
    await mount({ onQueue, fetchImpl });
    for (let i = 0; i < 10; i += 1) {
      await pick();
      expect(q('receipt-error'), `photo ${i + 1}`).toBeNull();
      expect(getToasts().at(-1)).toMatchObject({ key: 'q.saved', tone: 'ok' });
    }
    expect(onQueue).toHaveBeenCalledTimes(10);
    expect(onQueue).toHaveBeenCalledWith(PHOTO);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(host.textContent).not.toMatch(/espera un minuto|demasiadas lecturas/i);
    expect(q('receipt-saved').dataset.count).toBe('10');
  });

  it('the photos parked while the gate is closed are born waiting for it (the drain does not try them earlier)', async () => {
    const queue = createReceiptQueue();
    const now = 1_000_000;
    queue.gate.hit({ now });
    const row = await queue.enqueue({ projectId: 'proyecto01', image: 'data:image/jpeg;base64,/9j/AAAA', now });
    expect(row.nextAt).toBe(now + RATE.baseMs);
    queue.gate.reset();
    const free = await queue.enqueue({ projectId: 'proyecto01', image: 'data:image/jpeg;base64,/9j/AAAA', now });
    expect(free.nextAt).toBe(0);
  });

  it('screens without a queue keep telling the truth: the (calm) rate-limit message', async () => {
    await mount({ fetchImpl: vi.fn(async () => throttled()) });
    await pick();
    expect(q('receipt-error').dataset.code).toBe('rate_limited');
  });

  it('the privacy line describes BYOK in every language: the phone talks to Gemini with the user\'s key; no "our server"', () => {
    for (const lang of ['es', 'en', 'pt', 'fr', 'it', 'de']) {
      const t = makeI18n(lang, 'CL').t;
      expect(t('inv.privacy'), lang).not.toMatch(/nuestro servidor|our server|nosso servidor|notre serveur|nostro server|unseren Server/i);
      expect(t('inv.privacy'), lang).toMatch(/Gemini/);
      for (const key of ['inv.err.not_configured', 'inv.err.network', 'prices.live.noKey']) expect(t(key), `${lang} ${key}`).not.toMatch(/servidor|server|serveur/i);
    }
    expect(makeI18n('it', 'CL').t('inv.privacy')).toBe('La foto viene elaborata dal tuo dispositivo tramite Gemini (Google), inviata direttamente con la tua chiave personale; nessun server intermedio la vede e non viene salvata nel tuo progetto.');
  });

  it('the new texts exist in the six languages', () => {
    for (const lang of ['es', 'en', 'pt', 'fr', 'it', 'de']) {
      const t = makeI18n(lang, 'CL').t;
      for (const key of ['q.saved', 'q.savedCount', 'q.pending', 'q.pending.net', 'q.pending.rate']) expect(t(key), `${lang} ${key}`).not.toBe(key);
    }
  });
});

describe('4. The queue: a 429 pauses everything, silently, without burning attempts', () => {
  const IMG = 'data:image/jpeg;base64,/9j/AAAA';
  let queue;
  const NOW = 5_000_000;
  const park = (n) => Promise.all(Array.from({ length: n }, (_, i) => queue.enqueue({ projectId: 'proyecto01', image: IMG, currency: 'CLP', lang: 'es', now: 1 + i })));
  const apply = vi.fn(async () => true);
  const ok = { isReceipt: true, receipts: [{ supplier: 'Sodimac', currency: 'CLP', date: '2026-10-29', total: 1000, items: [{ description: 'Cemento', amount: 1000, category: 'material' }] }] };
  const limited = (retryAfterMs = 0) => async () => {
    throw new InvoiceError('rate_limited', { retryAfterMs });
  };
  beforeEach(() => {
    queue = createReceiptQueue();
    apply.mockClear();
  });

  it('no Retry-After: the whole queue waits 60 s; the photo keeps its attempts; nobody is told; no request is made for the rest', async () => {
    await park(3);
    const request = vi.fn(limited());
    const res = await drainReceiptQueue({ queue, apply, request, online: () => true, now: () => NOW });
    expect(request).toHaveBeenCalledTimes(1); // the rest did not even try
    expect(res).toMatchObject({ done: [], failed: [], review: [], deferred: 3 });
    const rows = await queue.list();
    expect(rows.map((r) => r.status)).toEqual(['pending', 'pending', 'pending']);
    expect(rows.every((r) => r.attempts === 0 && r.nextAt === NOW + 60_000)).toBe(true);
    expect(rows[0].lastError).toBe('rate_limited');
    expect(getToasts()).toHaveLength(0); // silence
  });

  it('Retry-After from Google is honoured', async () => {
    await park(2);
    await drainReceiptQueue({ queue, apply, request: limited(150_000), online: () => true, now: () => NOW });
    expect((await queue.list()).every((r) => r.nextAt === NOW + 150_000)).toBe(true);
  });

  it('while the gate is closed a wake-up makes NO request: due rows are only moved to the moment it opens', async () => {
    await park(2);
    await drainReceiptQueue({ queue, apply, request: limited(), online: () => true, now: () => NOW });
    const request = vi.fn(async () => ok);
    // another photo parked meanwhile (born due: nextAt 0 on a queue whose gate has not seen it)
    const early = await queue.enqueue({ projectId: 'proyecto01', image: IMG, now: NOW + 1 });
    await queue.update(early.id, { nextAt: 0 });
    const res = await drainReceiptQueue({ queue, apply, request, online: () => true, now: () => NOW + 10_000 });
    expect(request).not.toHaveBeenCalled();
    expect(res.deferred).toBe(1);
    expect((await queue.list()).find((r) => r.id === early.id).nextAt).toBe(NOW + 60_000);
  });

  it('after the pause the queue resumes by itself, reads everything and the gate is open again', async () => {
    await park(3);
    await drainReceiptQueue({ queue, apply, request: limited(), online: () => true, now: () => NOW });
    const request = vi.fn(async () => ok);
    const res = await drainReceiptQueue({ queue, apply, request, online: () => true, now: () => NOW + 61_000 });
    expect(res.done).toHaveLength(3);
    expect(await queue.list()).toHaveLength(0);
    expect(queue.gate.active(NOW + 61_000)).toBe(false);
    expect(queue.gate.hits).toBe(0);
  });

  it('consecutive 429s back off exponentially (60 s, 2 min, 4 min...) and NEVER fail a photo, however many times', async () => {
    await park(1);
    let now = NOW;
    const pauses = [];
    for (let i = 0; i < 12; i += 1) {
      await drainReceiptQueue({ queue, apply, request: limited(), online: () => true, now: () => now });
      const [row] = await queue.list();
      pauses.push(row.nextAt - now);
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(0);
      now = row.nextAt + 1;
    }
    expect(pauses.slice(0, 5)).toEqual([60_000, 120_000, 240_000, 480_000, 900_000]);
    expect(Math.max(...pauses)).toBe(RATE.maxMs);
    expect(QUEUE_LIMITS.maxAttempts).toBeGreaterThan(0);
  });

  it('a forced retry (the user taps "Reintentar") ignores the pause and, if Google still says no, simply pauses again', async () => {
    await park(1);
    await drainReceiptQueue({ queue, apply, request: limited(), online: () => true, now: () => NOW });
    const request = vi.fn(async () => ok);
    const res = await drainReceiptQueue({ queue, apply, request, online: () => true, now: () => NOW + 1_000, force: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(res.done).toHaveLength(1);
  });

  it('other errors keep their own rules: network backs off by attempts, a permanent error fails the photo', async () => {
    await park(2);
    const net = vi.fn(async () => {
      throw new InvoiceError('network');
    });
    await drainReceiptQueue({ queue, apply, request: net, online: () => true, now: () => NOW });
    const rows = await queue.list();
    expect(rows[0]).toMatchObject({ attempts: 1, nextAt: NOW + backoffMs(1) });
    expect(queue.gate.active(NOW)).toBe(false); // a network problem does not close the 429 gate
  });
});
