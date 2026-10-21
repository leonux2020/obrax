// Field photo evidence: at most 4 photos per project, one per named slot.
// Pure helpers (limits, validation, normalisation) are separated from the browser-only
// compression pipeline so the rules are unit-testable in Node.

export const MAX_PHOTOS = 4;
export const PHOTO_SLOTS = Object.freeze(['panoramic', 'existing', 'details', 'logistics']);

export const PHOTO_LIMITS = Object.freeze({
  maxSide: 1200, // px, width or height
  targetBytes: 150_000, // ~120-150 KB per image
  startQuality: 0.82,
  minQuality: 0.45,
  maxInputBytes: 40 * 1024 * 1024, // refuse absurd inputs before decoding
  maxStoredBytes: 400_000, // anything bigger than this coming from storage is rejected
});

const DATA_URL_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

/** Scale (w, h) down so that the longest side is at most `max`. Never upscales. */
export function fitSize(width, height, max = PHOTO_LIMITS.maxSide) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Decoded size of a base64 data URL. */
export function dataUrlBytes(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const i = dataUrl.indexOf(',');
  if (i < 0) return 0;
  const b64 = dataUrl.slice(i + 1);
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export const isValidPhotoDataUrl = (s) =>
  typeof s === 'string' && s.length < PHOTO_LIMITS.maxStoredBytes * 1.4 && DATA_URL_RE.test(s) && dataUrlBytes(s) <= PHOTO_LIMITS.maxStoredBytes;

/** Validate an untrusted stored photo. Returns a clean photo or null. */
export function normalizePhoto(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const slot = Number(obj.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_PHOTOS) return null;
  if (!isValidPhotoDataUrl(obj.dataUrl)) return null;
  const width = Math.round(Number(obj.width));
  const height = Math.round(Number(obj.height));
  if (!(width > 0 && width <= PHOTO_LIMITS.maxSide && height > 0 && height <= PHOTO_LIMITS.maxSide)) return null;
  const at = Number(obj.at);
  return { slot, dataUrl: obj.dataUrl, width, height, bytes: dataUrlBytes(obj.dataUrl), at: Number.isFinite(at) ? at : 0 };
}

export const emptySlots = () => Array(MAX_PHOTOS).fill(null);

/** Any list of stored photos -> fixed array of MAX_PHOTOS slots (first valid photo wins per slot). */
export function normalizePhotos(list) {
  const slots = emptySlots();
  if (!Array.isArray(list)) return slots;
  for (const item of list.slice(0, 64)) {
    const p = normalizePhoto(item);
    if (p && !slots[p.slot]) slots[p.slot] = p;
  }
  return slots;
}

export const countPhotos = (slots) => (Array.isArray(slots) ? slots.filter(Boolean).length : 0);

/** Next empty slot index, or -1 when the project already holds the maximum. */
export const firstFreeSlot = (slots) => (Array.isArray(slots) ? slots.findIndex((s) => !s) : 0);

/**
 * Put a photo in a slot (adding to an empty slot or replacing an occupied one).
 * The result can never hold more than MAX_PHOTOS; invalid input leaves the slots untouched.
 */
export function putPhoto(slots, slot, photo) {
  const base = normalizeSlots(slots);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_PHOTOS) return base;
  const clean = normalizePhoto({ ...photo, slot });
  if (!clean) return base;
  const next = [...base];
  next[slot] = clean;
  return next;
}

export function removePhoto(slots, slot) {
  const base = normalizeSlots(slots);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_PHOTOS) return base;
  const next = [...base];
  next[slot] = null;
  return next;
}

function normalizeSlots(slots) {
  const out = emptySlots();
  if (Array.isArray(slots)) for (let i = 0; i < MAX_PHOTOS; i += 1) out[i] = slots[i] ?? null;
  return out;
}

/** Photos ready for the PDF generators: labelled, in slot order, empty slots skipped. */
export function photosForReport(slots, t) {
  return normalizeSlots(slots)
    .map((p, i) => (p ? { ...p, label: t(`photo.slot.${PHOTO_SLOTS[i]}`) } : null))
    .filter(Boolean);
}

// ---- browser-only: compression pipeline ------------------------------------------------------------
export class PhotoError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // 'type' | 'size' | 'decode'
  }
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' applies the EXIF orientation so phone photos are never rotated wrongly.
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close?.() };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new PhotoError('decode'));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Resize to at most 1200 px and re-encode as JPEG, lowering quality (and, as a last resort, size)
 * until the file is ~150 KB. Keeps mobile RAM, storage and battery under control.
 */
export async function compressImage(file, now = Date.now()) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) throw new PhotoError('type');
  if (file.size > PHOTO_LIMITS.maxInputBytes) throw new PhotoError('size');

  const img = await decode(file);
  try {
    let { width, height } = fitSize(img.width, img.height);
    if (!width) throw new PhotoError('decode');
    const canvas = document.createElement('canvas');
    for (let attempt = 0; attempt < 6; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; // JPEG has no alpha
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img.source, 0, 0, width, height);
      let q = PHOTO_LIMITS.startQuality;
      let dataUrl = canvas.toDataURL('image/jpeg', q);
      while (dataUrlBytes(dataUrl) > PHOTO_LIMITS.targetBytes && q > PHOTO_LIMITS.minQuality) {
        q = Math.max(PHOTO_LIMITS.minQuality, q - 0.07);
        dataUrl = canvas.toDataURL('image/jpeg', q);
      }
      if (dataUrlBytes(dataUrl) <= PHOTO_LIMITS.targetBytes * 1.2 || attempt === 5) {
        const photo = normalizePhoto({ slot: 0, dataUrl, width, height, at: now });
        if (!photo) throw new PhotoError('decode');
        return photo;
      }
      width = Math.max(1, Math.round(width * 0.85));
      height = Math.max(1, Math.round(height * 0.85));
    }
    throw new PhotoError('decode');
  } finally {
    img.close();
  }
}
