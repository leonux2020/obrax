import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { receiptQueue } from './receiptQueue.js';
import { SYNC_MESSAGE, acceptReviewed, drainReceiptQueue, isOnline } from './receiptSync.js';

const EMPTY = [];

/** The rows of the deferred receipt queue (re-renders when it changes). */
export const useReceiptQueue = (queue = receiptQueue) => useSyncExternalStore(queue.subscribe, queue.peek, () => EMPTY);

/**
 * Global sync of the deferred receipts. Mount it ONCE, high in the tree (App): it works whichever screen is open.
 * It drains the queue when the app starts, when the connection comes back (`online`), when the app returns to the
 * foreground, when the service worker's Background Sync wakes the page, and at the next retry time of a parked row.
 *
 * @param apply   async (projectId, expenses, row) => boolean   writes the expenses into the project (false = project gone)
 * @param notify  ({ key, params, tone }) => void               in-app toast + system notification
 */
export function useReceiptSync({ apply, notify, enabled = true, queue = receiptQueue, fetchImpl } = {}) {
  const applyRef = useRef(apply);
  const notifyRef = useRef(notify);
  applyRef.current = apply;
  notifyRef.current = notify;
  const timer = useRef(0);

  const run = useCallback(
    async ({ force = false } = {}) => {
      if (!applyRef.current) return null;
      const res = await drainReceiptQueue({ queue, apply: (...a) => applyRef.current(...a), force, ...(fetchImpl ? { fetchImpl } : {}) });
      if (!res) return null;
      const say = (m) => notifyRef.current?.(m);
      if (res.done.length) {
        const count = res.done.reduce((s, d) => s + d.count, 0);
        say({ key: 'q.done', params: { n: res.done.length, lines: count }, tone: 'ok' });
      }
      if (res.review.length) say({ key: 'q.review', params: { n: res.review.length }, tone: 'warn' });
      if (res.failed.length) say({ key: 'q.failed', params: { n: res.failed.length }, tone: 'warn' });
      return res;
    },
    [queue, fetchImpl]
  );

  // wake-ups
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const go = () => alive && isOnline() && run();
    queue.recover().then(() => queue.list()).then(go);
    const onVisible = () => document.visibilityState === 'visible' && go();
    const onMessage = (e) => e?.data?.type === SYNC_MESSAGE && go();
    window.addEventListener('online', go);
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener?.('message', onMessage);
    return () => {
      alive = false;
      window.removeEventListener('online', go);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener?.('message', onMessage);
    };
  }, [enabled, queue, run]);

  // the next retry of a parked row (exponential backoff): one timer, always aimed at the earliest due time
  const rows = useReceiptQueue(queue);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!enabled) return undefined;
    const waiting = rows.filter((r) => r.status === 'pending');
    if (!waiting.length) return undefined;
    const next = Math.min(...waiting.map((r) => r.nextAt));
    timer.current = setTimeout(() => isOnline() && run(), Math.min(Math.max(next - Date.now(), 1_000), 5 * 60_000));
    return () => clearTimeout(timer.current);
  }, [rows, enabled, run]);

  const retry = useCallback(
    async (id) => {
      await queue.update(id, { status: 'pending', nextAt: 0, attempts: 0, lastError: '' });
      return run({ force: true });
    },
    [queue, run]
  );
  const discard = useCallback((id) => queue.remove(id), [queue]);
  const accept = useCallback(
    async (id) => {
      const row = queue.peek().find((r) => r.id === id);
      if (!row) return 0;
      const n = await acceptReviewed(row, { queue, apply: (...a) => applyRef.current(...a) });
      if (n) notifyRef.current?.({ key: 'q.done', params: { n: 1, lines: n }, tone: 'ok' });
      return n;
    },
    [queue]
  );

  return { rows, pending: rows.filter((r) => r.status === 'pending' || r.status === 'sending').length, run, retry, discard, accept };
}
