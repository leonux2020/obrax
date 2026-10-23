// Field photo evidence: at most 4 photos per project, one per named slot.
// Pure helpers (limits, validation, normalisation) are separated from the browser-only
// compression pipeline so the rules are unit-testable in Node.

import { INVOICE_LIMITS } from './invoice.js';

export const MAX_PHOTOS = 4;
export const PHOTO_SLOTS = Object.freeze(['panoramic', 'existing', 'details', 'logistics']);

export const PHOTO_LIMITS = Object.freeze({
  maxSide: 1200, // px, width or height
  targetBytes: 150_000, // quality loop aims here (~100-150 KB per image)
  acceptBytes: 160_000, // upper bound accepted before shrinking the image further
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

/** Default canvas factory; tests inject their own so the pipeline runs in Node. */
const domCanvas = () => document.createElement('canvas');

/**
 * Draw `source` into a NEW canvas of exactly dw x dh. The canvas size is always set explicitly
 * (an unsized canvas is 300x150 and produces the classic pixelated/cropped result) and the smoothing
 * flags are applied AFTER resizing, because changing width/height resets the 2D context state.
 */
export function drawScaled(source, dw, dh, makeCanvas = domCanvas) {
  const canvas = makeCanvas();
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff'; // JPEG has no alpha
  ctx.fillRect(0, 0, dw, dh);
  ctx.drawImage(source, 0, 0, dw, dh);
  return canvas;
}

/**
 * High quality downscale. Browsers sample only a few source pixels when a big image is shrunk in one
 * go (aliasing / "pixelated" look), so we halve repeatedly until the last step is < 2x.
 */
export function downscale(source, sw, sh, tw, th, makeCanvas = domCanvas) {
  let cur = source;
  let cw = sw;
  let ch = sh;
  let temp = null;
  while (cw / 2 >= tw && ch / 2 >= th) {
    const nw = Math.max(tw, Math.floor(cw / 2));
    const nh = Math.max(th, Math.floor(ch / 2));
    const next = drawScaled(cur, nw, nh, makeCanvas);
    if (temp) releaseCanvas(temp);
    temp = next;
    cur = next;
    cw = nw;
    ch = nh;
  }
  const out = drawScaled(cur, tw, th, makeCanvas);
  if (temp) releaseCanvas(temp);
  return out;
}

function releaseCanvas(c) {
  try {
    c.width = 0;
    c.height = 0;
  } catch {
    /* ignore */
  }
}

/** Encode a canvas as JPEG starting at quality 0.82 and lowering it until the target size is met. */
export function encodeJpeg(canvas, { targetBytes = PHOTO_LIMITS.targetBytes } = {}) {
  let q = PHOTO_LIMITS.startQuality;
  let dataUrl = canvas.toDataURL('image/jpeg', q);
  while (dataUrlBytes(dataUrl) > targetBytes && q > PHOTO_LIMITS.minQuality) {
    q = Math.max(PHOTO_LIMITS.minQuality, Math.round((q - 0.07) * 100) / 100);
    dataUrl = canvas.toDataURL('image/jpeg', q);
  }
  return { dataUrl, quality: q };
}

/**
 * Shared compressor for BOTH inputs (file picker and live camera frame). `source` must already be
 * decoded (ImageBitmap, loaded <img>, <video> with a frame) and `width/height` its intrinsic size.
 * Output: proportional size, longest side <= 1200 px, JPEG ~100-160 KB.
 */
export function compressSource(source, width, height, { now = Date.now(), makeCanvas = domCanvas } = {}) {
  let { width: tw, height: th } = fitSize(width, height);
  if (!tw) throw new PhotoError('decode');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = downscale(source, width, height, tw, th, makeCanvas);
    const { dataUrl } = encodeJpeg(canvas);
    releaseCanvas(canvas);
    const bytes = dataUrlBytes(dataUrl);
    if (bytes <= PHOTO_LIMITS.acceptBytes || attempt === 5) {
      const photo = normalizePhoto({ slot: 0, dataUrl, width: tw, height: th, at: now });
      if (!photo) throw new PhotoError('decode');
      return photo;
    }
    // Still too heavy at minimum quality: shrink a little (keeps proportions) and retry from the ORIGINAL.
    tw = Math.max(1, Math.round(tw * 0.85));
    th = Math.max(1, Math.round(th * 0.85));
  }
  throw new PhotoError('decode');
}

/** Decode an <img> fully before anyone measures it (img.decode(), with an onload fallback). */
export async function loadImageElement(url, ImageCtor = globalThis.Image) {
  const el = new ImageCtor();
  el.decoding = 'async';
  const loaded = new Promise((resolve, reject) => {
    el.onload = () => resolve();
    el.onerror = () => reject(new PhotoError('decode'));
  });
  el.src = url;
  if (typeof el.decode === 'function') {
    try {
      await el.decode();
    } catch {
      await loaded; // decode() can reject for some formats that still load fine
    }
  } else {
    await loaded;
  }
  if (!(el.naturalWidth > 0 && el.naturalHeight > 0)) throw new PhotoError('decode');
  return el;
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' applies the EXIF orientation so phone photos are never rotated wrongly.
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (bmp.width > 0 && bmp.height > 0) {
        return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close?.() };
      }
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url); // fully decoded before measuring / drawing
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** File picker / gallery / mobile camera capture -> compressed photo. */
export async function compressImage(file, now = Date.now(), env = {}) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) throw new PhotoError('type');
  if (file.size > PHOTO_LIMITS.maxInputBytes) throw new PhotoError('size');
  const img = await (env.decode || decode)(file);
  try {
    return compressSource(img.source, img.width, img.height, { now, makeCanvas: env.makeCanvas });
  } finally {
    img.close?.();
  }
}

/** Live camera frame (<video>) -> compressed photo, using exactly the same pipeline. */
export function compressVideoFrame(video, now = Date.now(), env = {}) {
  const width = video?.videoWidth;
  const height = video?.videoHeight;
  if (!(width > 0 && height > 0)) throw new PhotoError('decode');
  return compressSource(video, width, height, { now, makeCanvas: env.makeCanvas });
}

/**
 * Desktop-class device with a webcam API => in-app live camera modal.
 * Phones/tablets (coarse pointer) keep the native camera via <input capture="environment">.
 * Without getUserMedia (insecure origin, old browser) we fall back to the file input.
 */
export function shouldUseLiveCamera(nav = globalThis.navigator, matchMedia = globalThis.matchMedia) {
  if (!nav?.mediaDevices || typeof nav.mediaDevices.getUserMedia !== 'function') return false;
  try {
    if (typeof matchMedia === 'function' && matchMedia.call(globalThis, '(pointer: coarse)').matches) return false;
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * Invoice photo for AI reading. Receipts are text, so this keeps far more detail than the evidence photos
 * (longest side 1600 px, up to ~900 KB) while staying small enough for one request to the proxy.
 * @returns {{dataUrl: string, width: number, height: number}}
 */
export async function compressInvoiceImage(file, env = {}) {
  if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) throw new PhotoError('type');
  if (file.size > PHOTO_LIMITS.maxInputBytes) throw new PhotoError('size');
  const img = await (env.decode || decode)(file);
  try {
    let { width: tw, height: th } = fitSize(img.width, img.height, INVOICE_LIMITS.maxSide);
    if (!tw) throw new PhotoError('decode');
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const canvas = downscale(img.source, img.width, img.height, tw, th, env.makeCanvas);
      const { dataUrl } = encodeJpeg(canvas, { targetBytes: INVOICE_LIMITS.targetBytes });
      releaseCanvas(canvas);
      if (dataUrlBytes(dataUrl) <= INVOICE_LIMITS.targetBytes * 1.2 || attempt === 5) {
        if (!/^data:image\/jpeg;base64,/.test(dataUrl)) throw new PhotoError('decode');
        return { dataUrl, width: tw, height: th };
      }
      tw = Math.max(1, Math.round(tw * 0.85));
      th = Math.max(1, Math.round(th * 0.85));
    }
    throw new PhotoError('decode');
  } finally {
    img.close?.();
  }
}
