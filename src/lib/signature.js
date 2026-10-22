// Client signature (Phase 2). The pad records strokes as points; this module turns them into a small
// transparent PNG with BLACK ink (it is printed on white paper) and validates whatever comes back
// from storage. Pure functions only: the canvas factory is injected so everything runs in Node tests.

import { sanitizeText, sanitizeTaxId } from './sanitize.js';

export const SIGNATURE_LIMITS = Object.freeze({
  maxWidth: 480, // exported PNG, px
  maxHeight: 220,
  maxScale: 2, // a tiny signature is enlarged at most 2x
  padding: 6, // px around the ink, in pad coordinates
  inkWidth: 2.6, // px at scale 1
  maxChars: 60_000, // data-URL length cap (≈ 45 KB of PNG)
  minScale: 0.3,
});

export class SignatureError extends Error {
  constructor(code) {
    super(`signature:${code}`);
    this.code = code; // 'empty' | 'store'
  }
}

const DATA_RE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

// ---- strokes ---------------------------------------------------------------------------------------------
/** A stroke is an array of {x, y} points in the pad's CSS pixels. */
export const hasInk = (strokes) => Array.isArray(strokes) && strokes.some((s) => Array.isArray(s) && s.length > 0);

export function strokeBounds(strokes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes || []) {
    for (const p of s) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/**
 * Draw one stroke smoothly: quadratic curves through the midpoints of consecutive points (the classic
 * "smooth finger drawing" technique). A single tap becomes a dot. Caller sets the stroke style.
 */
export function drawStroke(ctx, points, map = (p) => p, lineWidth = SIGNATURE_LIMITS.inkWidth) {
  if (!points.length) return;
  const pts = points.map(map);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i += 1) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/**
 * Export the strokes as a cropped, transparent PNG with black ink, at most 480x220 px and under the size
 * cap (the scale is reduced step by step if a very busy scribble is still too heavy).
 * @returns {{dataUrl: string, w: number, h: number}}
 */
export function exportSignature(strokes, { makeCanvas = () => document.createElement('canvas'), limits = SIGNATURE_LIMITS } = {}) {
  const b = hasInk(strokes) ? strokeBounds(strokes) : null;
  if (!b) throw new SignatureError('empty');
  const pad = limits.padding;
  const cw = b.maxX - b.minX + 2 * pad;
  const ch = b.maxY - b.minY + 2 * pad;
  let scale = Math.min(limits.maxScale, limits.maxWidth / cw, limits.maxHeight / ch);

  while (scale >= limits.minScale) {
    const w = Math.max(1, Math.round(cw * scale));
    const h = Math.max(1, Math.round(ch * scale));
    const canvas = makeCanvas();
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new SignatureError('store');
    ctx.clearRect(0, 0, w, h); // stays transparent: no background fill
    ctx.strokeStyle = '#000000';
    const map = (p) => ({ x: (p.x - b.minX + pad) * scale, y: (p.y - b.minY + pad) * scale });
    for (const s of strokes) drawStroke(ctx, s, map, limits.inkWidth * Math.max(scale, 0.8));
    const dataUrl = canvas.toDataURL('image/png');
    canvas.width = 0; // release the bitmap
    canvas.height = 0;
    if (dataUrl.length <= limits.maxChars && DATA_RE.test(dataUrl)) return { dataUrl, w, h };
    scale *= 0.8;
  }
  throw new SignatureError('store');
}

// ---- contractor signature (stored in the company profile) -------------------------------------------------
/** Validate an untrusted stored ink image {dataUrl, w, h}. Returns a clean object or null. */
export function normalizeInk(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const { dataUrl } = obj;
  if (typeof dataUrl !== 'string' || dataUrl.length > SIGNATURE_LIMITS.maxChars || !DATA_RE.test(dataUrl)) return null;
  const w = Math.round(Number(obj.w));
  const h = Math.round(Number(obj.h));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 2000 || h > 2000) return null;
  return { dataUrl, w, h };
}

// ---- the stored value ------------------------------------------------------------------------------------
const int = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/** Validate an untrusted stored signature. Returns a clean object or null. */
export function normalizeSignature(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const { dataUrl } = obj;
  if (typeof dataUrl !== 'string' || dataUrl.length > SIGNATURE_LIMITS.maxChars || !DATA_RE.test(dataUrl)) return null;
  const w = int(obj.w, 1, 2000);
  const h = int(obj.h, 1, 2000);
  if (w === null || h === null) return null;
  const at = Number(obj.at);
  const total = Number(obj.total);
  const pricedAt = Number(obj.pricedAt);
  return {
    dataUrl,
    w,
    h,
    name: sanitizeText(obj.name, 60).trim(),
    taxId: sanitizeTaxId(obj.taxId),
    at: Number.isFinite(at) ? at : 0,
    total: Number.isFinite(total) && total >= 0 ? total : 0,
    pricedAt: Number.isFinite(pricedAt) && pricedAt > 0 ? pricedAt : 0,
  };
}

/** Build the value saved inside the project: ink + client data + the quote total (and price time) it was signed for. */
export function buildSignature({ ink, name = '', taxId = '', total = 0, pricedAt = 0, now = Date.now() }) {
  return normalizeSignature({ ...ink, name, taxId, total, pricedAt, at: now });
}

/**
 * The simulated market prices move every 15 minutes, so a signed total would drift away from what the
 * client accepted. While a signature exists the quote is therefore priced at the moment it was signed;
 * removing the signature releases the prices again.
 */
export const pricingTime = (draft, now) => draft?.signature?.pricedAt || now;

/** A signature only vouches for the quote it was given on: if the total changed afterwards it is stale. */
export const isSignatureCurrent = (signature, total) => !!signature && Math.abs(signature.total - total) < 0.005;
