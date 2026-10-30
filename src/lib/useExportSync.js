import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { exportQueue } from './exportQueue.js';
import { drainExportQueue, isOnline } from './exportSync.js';

const EMPTY = [];

/** The rows of the offline queue of Excel rendiciones (re-renders when it changes). */
export const useExportQueue = (queue = exportQueue) => useSyncExternalStore(queue.subscribe, queue.peek, () => EMPTY);

/**
 * Global background sync of the parked rendiciones. Mount it ONCE, high in the tree (App): it works whichever screen is open.
 * It uploads the queue to Drive when the app starts, when the connection comes back (`online`), when the app returns to the
 * foreground and at the next retry time of a parked row. It reuses the app's Drive client and token (injected as `upload` / `ensureToken`).
 *
 * @param upload       async ({ title, fileName, bytes, row }) => void
 * @param ensureToken  async () => token|null     silent (never opens a Google screen from the background)
 * @param notify       ({ key, params, tone }) => void
 */
export function useExportSync({ upload, ensureToken, notify, enabled = true, queue = exportQueue } = {}) {
  const uploadRef = useRef(upload);
  const tokenRef = useRef(ensureToken);
  const notifyRef = useRef(notify);
  uploadRef.current = upload;
  tokenRef.current = ensureToken;
  notifyRef.current = notify;
  const timer = useRef(0);

  const run = useCallback(
    async ({ force = false } = {}) => {
      if (!uploadRef.current) return null;
      const res = await drainExportQueue({ queue, upload: (a) => uploadRef.current(a), ensureToken: () => tokenRef.current?.() ?? null, force });
      if (!res) return null;
      if (res.done.length) notifyRef.current?.({ key: 'rend.queue.done', params: { n: res.done.length }, tone: 'ok' });
      if (res.failed.length) notifyRef.current?.({ key: 'rend.queue.failed', tone: 'warn' });
      return res;
    },
    [queue]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const go = () => alive && isOnline() && run();
    queue.recover().then(() => queue.list()).then(go);
    const onVisible = () => document.visibilityState === 'visible' && go();
    window.addEventListener('online', go);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.removeEventListener('online', go);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, queue, run]);

  // the next retry of a parked row (exponential backoff): one timer, always aimed at the earliest due time
  const rows = useExportQueue(queue);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!enabled) return undefined;
    const waiting = rows.filter((r) => r.status === 'pending');
    if (!waiting.length) return undefined;
    const next = Math.min(...waiting.map((r) => r.nextAt));
    timer.current = setTimeout(() => isOnline() && run(), Math.min(Math.max(next - Date.now(), 1_000), 5 * 60_000));
    return () => clearTimeout(timer.current);
  }, [rows, enabled, run]);

  const retry = useCallback(() => run({ force: true }), [run]);
  return { rows, pending: rows.filter((r) => r.status === 'pending' || r.status === 'sending').length, run, retry };
}
