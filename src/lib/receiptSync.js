// Receipt sync engine: drains the deferred queue (receiptQueue.js) when the network is back. No UI, no React.
//
//   queue row -> data URL -> POST to OUR proxy (requestReceipt, same call the online scanner makes) -> expenses
//   -> `apply(projectId, expenses)` (the app writes them into the project) -> row removed -> user notified.
//
// Rules: retry only what can succeed later (network, timeout, rate limit, upstream) with exponential backoff and stop the
// run at the first connectivity problem (do not hammer a dead line); mark what can never succeed ('failed'); never
// tabulate behind the user's back a receipt printed in ANOTHER currency whose only rate is an approximation ('review'; a real rate is frozen
// into the project's base currency automatically, see fx.js); never run twice at once (in this tab, nor across tabs
// when the Web Locks API exists); never send anything while offline.

import { LEDGER_LIMITS, withProjectContext } from './ledger.js';
import { asReceipts, batchExpenses, requestReceipt } from './receipt.js';
import { QUEUE_LIMITS, receiptQueue } from './receiptQueue.js';
import { convertToBase, resolveRate } from './fx.js';
import { nextStamp } from './merge.js';

export const SYNC_TAG = 'cubrax-receipts';
export const SYNC_MESSAGE = 'SYNC_RECEIPTS';

/** Errors that a later attempt can fix. */
export const RETRYABLE = Object.freeze(['network', 'timeout', 'upstream', 'rate_limited', 'not_configured', 'cancelled', 'no_key', 'bad_key']);
/** Waiting for the USER (no key yet / a key Google rejected): the photo stays queued, the attempts are not spent and saving a key wakes the queue. */
export const WAITING_FOR_USER = Object.freeze(['no_key', 'bad_key']);
/** Errors that mean this picture will never be read. */
export const PERMANENT = Object.freeze(['bad_image', 'too_large', 'not_invoice', 'unreadable', 'forbidden']);

export const BACKOFF = Object.freeze({ baseMs: 30_000, maxMs: 15 * 60_000 });
export const backoffMs = (attempts) => Math.min(BACKOFF.maxMs, BACKOFF.baseMs * 2 ** Math.max(0, attempts));

export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** Pure: the project with the new expenses on top (bounded like every other write). */
export const addExpenses = (project, expenses, now = Date.now()) => ({
  ...project,
  expenses: [...withProjectContext(project, expenses), ...project.expenses].slice(0, LEDGER_LIMITS.expenses), // every line inherits the project's id / currency / place
  updatedAt: nextStamp(project.updatedAt, now), // strictly newer than what the project had: the Auto-Sync daemon and the merge always see this as a change
});

let running = null;

/** Exclusive section: one drain at a time in this tab, and (when available) one per origin across tabs. */
async function exclusive(fn) {
  if (running) return running;
  const job = (async () => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
    if (locks?.request) return locks.request(SYNC_TAG, { ifAvailable: true }, (lock) => (lock ? fn() : null));
    return fn();
  })().finally(() => {
    running = null;
  });
  running = job;
  return job;
}

/**
 * Process every due row once.
 * @param apply async (projectId, expenses, row) => boolean   false = the project no longer exists (the row is dropped)
 * @returns {Promise<{done: {row, count}[], review: object[], failed: object[], deferred: number, skipped: boolean}|null>}
 */
export function drainReceiptQueue({ queue = receiptQueue, apply, request = requestReceipt, online = isOnline, now = Date.now, fetchImpl, force = false, resolve = resolveRate } = {}) {
  return exclusive(async () => {
    const result = { done: [], review: [], failed: [], deferred: 0, skipped: false };
    if (!online()) return { ...result, skipped: true };
    const rows = force ? (await queue.list()).filter((r) => r.status === 'pending') : queue.due(await queue.list(), now());

    for (const row of rows) {
      if (!online()) {
        result.deferred += 1;
        continue;
      }
      await queue.update(row.id, { status: 'sending' });
      try {
        const image = await queue.imageOf(row);
        const answer = await request(image, { currency: row.currency, lang: row.lang, ...(fetchImpl ? { fetchImpl } : {}) });
        const receipts = asReceipts(answer); // one photo can hold several receipts: each one becomes its own group of expenses
        // printed in another currency: frozen into the project's base currency with the rate of this moment (fx.js). A real rate (service /
        // last known) is applied silently; with only the approximate reference rate (or none) the user is asked, nothing is tabulated behind their back
        const fx = await convertToBase(batchExpenses(receipts, { now: now() }), { base: row.currency, resolve, now: now(), ...(fetchImpl ? { fetchImpl } : {}) });
        if (fx.missing.length || fx.approximate.length) {
          await queue.update(row.id, { status: 'review', result: { receipts }, lastError: 'currency' });
          result.review.push(row);
          continue;
        }
        const expenses = fx.expenses;
        const applied = await apply(row.projectId, expenses, row);
        await queue.remove(row.id); // applied, or the project is gone: either way the picture is no longer needed
        if (applied) result.done.push({ row, count: expenses.length });
      } catch (err) {
        const code = typeof err?.code === 'string' ? err.code : 'unexpected';
        if (PERMANENT.includes(code)) {
          await queue.update(row.id, { status: 'failed', lastError: code, attempts: row.attempts + 1 });
          result.failed.push(row);
          continue;
        }
        const waiting = WAITING_FOR_USER.includes(code);
        const attempts = waiting ? row.attempts : row.attempts + 1; // a missing / rejected key is not the photo's fault: never burn its attempts
        const exhausted = attempts >= QUEUE_LIMITS.maxAttempts;
        await queue.update(row.id, exhausted ? { status: 'failed', lastError: code, attempts } : { status: 'pending', lastError: code, attempts, nextAt: now() + (waiting ? BACKOFF.maxMs : backoffMs(attempts)) });
        if (exhausted) result.failed.push(row);
        else result.deferred += 1;
        if (RETRYABLE.includes(code)) {
          // connectivity / service trouble: the rest would fail the same way, so they wait for the same retry time
          const rest = rows.slice(rows.indexOf(row) + 1);
          for (const r of rest) await queue.update(r.id, { nextAt: now() + (waiting ? BACKOFF.maxMs : backoffMs(attempts)) });
          result.deferred += rest.length;
          break;
        }
      }
    }
    return result;
  });
}

/** Accept a 'review' row as it is (the user confirmed the other currency): its expenses go into the project. */
export async function acceptReviewed(row, { queue = receiptQueue, apply, now = Date.now, resolve = resolveRate, fetchImpl } = {}) {
  const receipts = asReceipts(row.result).filter((r) => r?.items?.length);
  if (!receipts.length) {
    await queue.remove(row.id);
    return 0;
  }
  // the user confirmed: the best rate there is (even the approximate one) is frozen with the expense; no rate at all keeps the line in review
  const fx = await convertToBase(batchExpenses(receipts, { now: now() }), { base: row.currency, resolve, now: now(), ...(fetchImpl ? { fetchImpl } : {}) });
  if (fx.missing.length) return 0;
  const expenses = fx.expenses;
  const applied = await apply(row.projectId, expenses, row);
  await queue.remove(row.id);
  return applied ? expenses.length : 0;
}

/** Ask the browser for a Background Sync wake-up (Chromium). Safe to call anywhere: returns false when unsupported. */
export async function registerBackgroundSync() {
  try {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return false;
    const reg = await navigator.serviceWorker.ready;
    if (!reg?.sync?.register) return false;
    await reg.sync.register(SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}
