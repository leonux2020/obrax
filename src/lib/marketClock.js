import { useCallback, useEffect, useRef, useState } from 'react';
import { marketBucket, nextBucketAt } from './pricing.js';

const MAX_WAIT_MS = 30_000; // never sleep longer than this: a throttled / suspended timer is caught within 30 s

/**
 * Time source for the simulated market (materials AND machinery rentals). `now` moves BY ITSELF the moment a
 * new 15-minute market window starts, so open screens re-price without any tap:
 *   - an exact timer armed on the next window boundary (re-armed after every tick, at most 30 s ahead),
 *   - an immediate re-check when the app comes back (tab visible, focus, back-forward cache, network back):
 *     covers a phone that slept, a throttled background tab and a changed system clock.
 * `refresh()` is the manual "update now" button.
 */
export function useMarketClock() {
  const [now, setNow] = useState(() => Date.now());
  const last = useRef(now);
  last.current = now;

  const refresh = useCallback(() => setNow(Date.now()), []);

  useEffect(() => {
    let timer = 0;
    const check = () => {
      const t = Date.now();
      if (marketBucket(t) !== marketBucket(last.current)) setNow(t);
    };
    const arm = () => {
      clearTimeout(timer);
      const wait = Math.min(Math.max(nextBucketAt(Date.now()) - Date.now() + 250, 1_000), MAX_WAIT_MS);
      timer = setTimeout(() => {
        check();
        arm();
      }, wait);
    };
    const onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        check();
        arm();
      }
    };
    arm();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, []);

  return { now, refresh };
}
