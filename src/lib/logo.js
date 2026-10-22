// Company logo: light canvas compression + validation. Output is a small base64 data URL
// (transparent PNG, or WebP when PNG is too heavy) that lives in IndexedDB and inside each project snapshot.
// Reuses the decoding helpers of the photo pipeline (img.decode, EXIF orientation) without changing it.

import { PhotoError, dataUrlBytes, fitSize, loadImageElement } from './photos.js';

export const LOGO_LIMITS = Object.freeze({
  maxSide: 256, // px
  targetBytes: 60_000,
  maxStoredBytes: 90_000, // anything bigger coming from storage is rejected
  maxInputBytes: 10 * 1024 * 1024,
  types: Object.freeze(['image/png', 'image/jpeg', 'image/webp']),
});

const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Validate an untrusted stored logo. Returns the data URL or ''. */
export function normalizeLogo(value) {
  if (typeof value !== 'string' || value.length > LOGO_LIMITS.maxStoredBytes * 1.4) return '';
  return LOGO_RE.test(value) && dataUrlBytes(value) <= LOGO_LIMITS.maxStoredBytes ? value : '';
}

const domCanvas = () => document.createElement('canvas');

function release(c) {
  try {
    c.width = 0;
    c.height = 0;
  } catch {
    /* ignore */
  }
}

/** Draw into a NEW canvas of exactly dw x dh, keeping transparency (no white fill, unlike photos). */
export function drawLogo(source, dw, dh, makeCanvas = domCanvas) {
  const canvas = makeCanvas();
  canvas.width = dw; // explicit size first: an unsized canvas is 300x150
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true; // after resizing: width/height reset the context state
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, dw, dh);
  ctx.drawImage(source, 0, 0, dw, dh);
  return canvas;
}

/** Stepwise (halving) downscale, same anti-aliasing approach as the photo pipeline. */
export function downscaleLogo(source, sw, sh, tw, th, makeCanvas = domCanvas) {
  let cur = source;
  let cw = sw;
  let ch = sh;
  let temp = null;
  while (cw / 2 >= tw && ch / 2 >= th) {
    const nw = Math.max(tw, Math.floor(cw / 2));
    const nh = Math.max(th, Math.floor(ch / 2));
    const next = drawLogo(cur, nw, nh, makeCanvas);
    if (temp) release(temp);
    temp = next;
    cur = next;
    cw = nw;
    ch = nh;
  }
  const out = drawLogo(cur, tw, th, makeCanvas);
  if (temp) release(temp);
  return out;
}

/** Encode: transparent PNG first; WebP only when PNG is heavier than the target. */
function encode(canvas) {
  const png = canvas.toDataURL('image/png');
  if (dataUrlBytes(png) <= LOGO_LIMITS.targetBytes) return png;
  const webp = canvas.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') && dataUrlBytes(webp) < dataUrlBytes(png) ? webp : png;
}

/** Source (decoded bitmap / image) -> compressed logo data URL. */
export function compressLogoSource(source, width, height, { makeCanvas = domCanvas } = {}) {
  let { width: tw, height: th } = fitSize(width, height, LOGO_LIMITS.maxSide);
  if (!tw) throw new PhotoError('decode');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = downscaleLogo(source, width, height, tw, th, makeCanvas);
    const dataUrl = encode(canvas);
    release(canvas);
    if (dataUrlBytes(dataUrl) <= LOGO_LIMITS.targetBytes * 1.5 || attempt === 5) {
      const clean = normalizeLogo(dataUrl);
      if (!clean) throw new PhotoError('decode');
      return clean;
    }
    tw = Math.max(1, Math.round(tw * 0.8));
    th = Math.max(1, Math.round(th * 0.8));
  }
  throw new PhotoError('decode');
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (bmp.width > 0 && bmp.height > 0) return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close?.() };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** File picker -> compressed logo data URL. Raster formats only (SVG is refused: no intrinsic size, script risk). */
export async function compressLogo(file, env = {}) {
  if (!file || typeof file.type !== 'string' || !LOGO_LIMITS.types.includes(file.type)) throw new PhotoError('type');
  if (file.size > LOGO_LIMITS.maxInputBytes) throw new PhotoError('size');
  const img = await (env.decode || decode)(file);
  try {
    return compressLogoSource(img.source, img.width, img.height, { makeCanvas: env.makeCanvas });
  } finally {
    img.close?.();
  }
}
