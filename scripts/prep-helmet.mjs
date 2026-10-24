// Prepares the photoreal hard hat shipped in public/helmet.png from the artwork supplied by the brand owner
// (design/logo-source.jpg: hat + lettering on a dark vignette). Not part of the build: run it only if the art changes.
//
//   node scripts/prep-helmet.mjs
//
// It crops the hat, turns the dark vignette into transparency (soft key on the brightest channel, so the hat keeps its
// pixels untouched and sits on the app's pure OLED black) and trims the transparent margins.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '../design/logo-source.jpg');
const OUT = path.join(here, '../public/helmet.png');
const CROP = { left: 860, top: 110, width: 1100, height: 780 }; // generous box around the hat (above the lettering)
const LOW = 40; // at or below this the pixel is background
const HIGH = 84; // at or above this the pixel is fully opaque

const { data, info } = await sharp(SRC).extract(CROP).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i += 4) {
  const m = Math.max(data[i], data[i + 1], data[i + 2]);
  const t = Math.min(1, Math.max(0, (m - LOW) / (HIGH - LOW)));
  data[i + 3] = Math.round(t * t * (3 - 2 * t) * 255);
}
const keyed = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
const trimmed = await sharp(keyed).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 }).toBuffer();
const out = await sharp(trimmed)
  .resize({ width: 640, kernel: 'lanczos3' })
  .png({ compressionLevel: 9, palette: true, quality: 92, effort: 10, colours: 256, dither: 0.8 })
  .toBuffer({ resolveWithObject: true });
await sharp(out.data).toFile(OUT);
console.log('helmet.png', out.info.width, 'x', out.info.height, Math.round(out.data.length / 1024), 'KB', 'ratio', (out.info.width / out.info.height).toFixed(4));
