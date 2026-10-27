// Binary helpers: images travel through the app as `data:` URLs (compressed JPEG, 100-160 KB) but are STORED in
// IndexedDB as Blobs (raw bytes: ~25 % smaller than base64, structured-cloned natively, never in localStorage).
// Pure and dependency-free so the same code runs in the browser, in the service-worker-free tests and in Node.

const DATA_URL = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/]+={0,2})$/i;

export const hasBlob = () => typeof Blob !== 'undefined';

/** data:image/jpeg;base64,... -> Blob (or null when the input is not a base64 data URL / Blob is unavailable). */
export function dataUrlToBlob(dataUrl) {
  if (!hasBlob() || typeof dataUrl !== 'string') return null;
  const m = DATA_URL.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1].toLowerCase() });
}

const CHUNK = 0x8000;

/** Blob -> data URL. Uses arrayBuffer() (no FileReader), converted in chunks so a large image never blows the stack. */
export async function blobToDataUrl(blob) {
  if (!blob || typeof blob.arrayBuffer !== 'function') return '';
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

export const isBlob = (v) => hasBlob() && v instanceof Blob;
