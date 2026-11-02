// The proof behind a CLIENT payment (photo of the cheque or of the transfer slip). Same engine as the logbook photos: the picture is
// compressed by photos.js (JPEG ~150 KB, longest side 1200 px) and kept ON THE DEVICE as a Blob in IndexedDB (`project_photos`,
// scope "<id>#payments", no schema change); never base64 / localStorage. The payment itself only carries `photo: true`.
// Memory fallback when IndexedDB is unavailable (see notePhotos.js).

import { createNotePhotoStore, idbNoteBackend, normalizeNotePhoto, prepareNotePhoto } from './notePhotos.js';
import { hasBlob } from './blobs.js';
import { hasIndexedDb } from './db.js';

const cache = new Map();

/** Payment photos of one project (cached). Keys are the ids of the payments. */
export function paymentPhotosFor(projectId) {
  if (!cache.has(projectId)) cache.set(projectId, createNotePhotoStore(hasIndexedDb() && hasBlob() ? idbNoteBackend(indexedDB, projectId, 'payments') : null, normalizeNotePhoto));
  return cache.get(projectId);
}

/** A file from the camera -> compressed -> a Blob ready for the store (same pipeline as the logbook photos). */
export const preparePaymentPhoto = prepareNotePhoto;
