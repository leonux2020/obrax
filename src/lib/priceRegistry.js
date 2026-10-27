// In-memory registry of the latest price book per region (written by priceFeed.js, read by the quote engine and by
// the React hooks). No I/O here: the engine can import it without pulling in storage or the network.

const EMPTY = Object.freeze([]);
const books = new Map(); // regionCode -> book
const status = new Map(); // regionCode -> { state: 'idle'|'loading'|'fresh'|'cached'|'sim', at, reason }
const suppliers = new Map(); // regionCode -> supplier entries (the "Radar de Mercado", see suppliers.js)
const listeners = new Set();
let version = 0;
const emit = () => {
  version += 1;
  listeners.forEach((fn) => fn());
};

export const currentBook = (regionCode) => books.get(regionCode) ?? null;
export const currentStatus = (regionCode) => status.get(regionCode) ?? { state: 'idle', at: 0, reason: '' };
export const currentSuppliers = (regionCode) => suppliers.get(regionCode) ?? EMPTY;
export const registryVersion = () => version;
export function subscribeRegistry(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function publish(regionCode, { book, state, at, reason = '' }) {
  if (book !== undefined) {
    if (book) books.set(regionCode, book);
    else books.delete(regionCode);
  }
  if (state) status.set(regionCode, { state, at: at ?? book?.at ?? 0, reason });
  emit();
}
/** Replace the supplier entries of a region (the store is the source of truth; this is its in-memory copy). */
export function publishSuppliers(regionCode, entries) {
  if (entries && entries.length) suppliers.set(regionCode, entries);
  else suppliers.delete(regionCode);
  emit();
}
export function resetRegistry() {
  books.clear();
  suppliers.clear();
  status.clear();
  emit();
}
