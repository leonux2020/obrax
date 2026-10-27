import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { currentBook, currentStatus, currentSuppliers, registryVersion, subscribeRegistry } from './priceRegistry.js';
import { loadSuppliers, refreshPrices } from './priceFeed.js';
import { applyNearby } from './suppliers.js';

/** The live price book of a region (null = built-in reference prices). Re-renders when a refresh lands. */
export const usePriceBook = (regionCode) => useSyncExternalStore(subscribeRegistry, () => currentBook(regionCode), () => null);

/** The supplier prices ("Radar de Mercado") the user saved in a region; loads them from storage the first time. */
export function useSuppliers(regionCode) {
  useEffect(() => {
    if (regionCode) loadSuppliers(regionCode);
  }, [regionCode]);
  return useSyncExternalStore(subscribeRegistry, () => currentSuppliers(regionCode), () => currentSuppliers(null));
}

/**
 * The book a PROJECT is priced with: the region's book where the supplier prices saved within 50 km of the project's
 * location take priority (see suppliers.js). Without a location it is the region's book as is.
 */
export function useProjectBook(regionCode, location) {
  const book = usePriceBook(regionCode);
  const entries = useSuppliers(regionCode);
  const lat = location?.lat;
  const lng = location?.lng;
  return useMemo(() => applyNearby(book, regionCode, entries, lat === undefined ? null : { lat, lng }), [book, regionCode, entries, lat, lng]);
}

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
export function usePriceFeed(regionCodes, locations = {}) {
  const key = [...new Set([].concat(regionCodes).filter(Boolean))].sort().join(',');
  const locKey = JSON.stringify(locations || {});
  useEffect(() => {
    if (!key) return undefined;
    // `locations`: { regionCode: [{lat, lng} | null, ...] } the projects of each market: what their nearby suppliers cover is not asked of the AI
    const byRegion = JSON.parse(locKey);
    const run = () => key.split(',').forEach((code) => refreshPrices(code, { locations: byRegion[code] || [] }));
    run();
    window.addEventListener('online', run);
    return () => window.removeEventListener('online', run);
  }, [key, locKey]);
}
