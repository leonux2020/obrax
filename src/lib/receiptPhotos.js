// The photo of a receipt (boleta / factura) behind the expenses of a project. Before this the picture was read by the AI and thrown
// away; now the compressed image stays ON THE DEVICE as a Blob (IndexedDB `project_photos`, scope "<id>#receipts", DB v5, no schema
// change) so the expediente exported to Google Drive can put it in the "Comprobantes" folder. The expense lines carry `receiptId`.
// Same rules as notePhotos.js: never base64 / localStorage on the device; memory fallback when IndexedDB is unavailable.

import { createNotePhotoStore, idbNoteBackend } from './notePhotos.js';
import { dataUrlToBlob, hasBlob, isBlob } from './blobs.js';
import { hasIndexedDb } from './db.js';

export const RECEIPT_PHOTO_MAX_BYTES = 1_200_000; // same ceiling as the deferred receipt queue

/** A clean { blob, width, height, bytes, at } or null. Accepts { dataUrl | blob, width?, height?, at? } (the dimensions are optional). */
export function normalizeReceiptPhoto(input) {
  if (!input || typeof input !== 'object') return null;
  const blob = isBlob(input.blob) ? input.blob : dataUrlToBlob(input.dataUrl);
  if (!blob || !/^image\//.test(blob.type) || blob.size <= 0 || blob.size > RECEIPT_PHOTO_MAX_BYTES) return null;
  const dim = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 8000 ? Math.round(Number(v)) : 0);
  const at = Number(input.at);
  return { blob, width: dim(input.width), height: dim(input.height), bytes: blob.size, at: Number.isFinite(at) ? at : 0 };
}

const cache = new Map();

/** Receipt photos of one project (cached): IndexedDB when available, memory otherwise. Keys are the `receiptId` of the expenses. */
export function receiptPhotosFor(projectId) {
  if (!cache.has(projectId)) cache.set(projectId, createNotePhotoStore(hasIndexedDb() && hasBlob() ? idbNoteBackend(indexedDB, projectId, 'receipts') : null, normalizeReceiptPhoto));
  return cache.get(projectId);
}
