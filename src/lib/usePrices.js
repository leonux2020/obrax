import { useEffect, useSyncExternalStore } from 'react';
import { currentBook, currentStatus, registryVersion, subscribeRegistry } from './priceRegistry.js';
import { refreshPrices } from './priceFeed.js';

/** The live price book of a region (null = built-in reference prices). Re-renders when a refresh lands. */
export const usePriceBook = (regionCode) => useSyncExternalStore(subscribeRegistry, () => currentBook(regionCode), () => null);

/** Changes whenever ANY price book changes (for views that total many projects, possibly in several regions). */
export const usePriceVersion = () => useSyncExternalStore(subscribeRegistry, registryVersion, () => 0);

/** { state: 'idle'|'loading'|'fresh'|'cached'|'sim', at, reason } of the region's price service (reason = why it fell back). */
export function usePriceStatus(regionCode) {
  const key = useSyncExternalStore(subscribeRegistry, () => {
    const s = currentStatus(regionCode);
    return `${s.state}|${s.at}|${s.reason || ''}`;
  }, () => 'idle|0|');
  const [state, at, reason] = key.split('|');
  return { state, at: Number(at), reason };
}

/** Keep the prices of one or more regions up to date: on start / change, and whenever the device comes back online. */
export function usePriceFeed(regionCodes) {
  const key = [...new Set([].concat(regionCodes).filter(Boolean))].sort().join(',');
  useEffect(() => {
    if (!key) return undefined;
    const run = () => key.split(',').forEach((code) => refreshPrices(code));
    run();
    window.addEventListener('online', run);
    return () => window.removeEventListener('online', run);
  }, [key]);
}
