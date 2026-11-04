import { useEffect, useState } from 'react';
import { fetchCardWeather, readCardWeather } from './weatherService.js';
import { weatherPlace } from './weather.js';

const IDLE_MS = 250; // the card is painted first; the lookup starts a moment later (and never during the first frame)

/**
 * The weather of a project card. The first render NEVER waits: a fresh cached reading is there at once (synchronous read), otherwise it is
 * null and the background fetch fills it in later. `enabled` is false in tests / for closed projects; offline just keeps it null.
 */
export function useCardWeather(project, regionCode, { enabled = import.meta.env.MODE !== 'test', fetchImpl, storage, now } = {}) {
  const place = weatherPlace(project, regionCode);
  const key = place?.key || '';
  const cacheOpts = storage ? { storage, ...(now !== undefined ? { now } : {}) } : now !== undefined ? { now } : {};
  const [wx, setWx] = useState(() => (enabled && place ? readCardWeather(place, cacheOpts) : null));

  useEffect(() => {
    if (!enabled || !place) {
      setWx(null);
      return undefined;
    }
    let alive = true;
    let timer = 0;
    const run = () => {
      const opts = { online: typeof navigator === 'undefined' || navigator.onLine !== false, ...cacheOpts };
      if (fetchImpl) opts.fetchImpl = fetchImpl;
      fetchCardWeather(place, opts).then((w) => alive && w && setWx(w));
    };
    setWx(readCardWeather(place, cacheOpts));
    timer = setTimeout(run, IDLE_MS);
    const back = () => run(); // signal is back: try again (a fresh cache answers without a request)
    window.addEventListener('online', back);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener('online', back);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  return wx;
}
