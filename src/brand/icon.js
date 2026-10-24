// Single source of truth for the brand icon.
// Used by: <Logo/>, favicon, manifest icons (SVG + PNG 192/512 + maskable) and apple-touch-icon.
// This file must stay free of browser/node-only imports (it is imported by the Vite plugin too).

export const BRAND = Object.freeze({
  name: 'CUBRAX',
  shortName: 'CUBRAX',
  appId: 'com.obrax.app',
  title: 'CUBRAX - Cubicación & Presupuestos de Obra',
  description:
    'Cubicación, materiales y presupuestos de obra para profesionales de la construcción. Funciona sin conexión.',
  green: '#22c55e',
  black: '#000000',
});

// ---- the isotype: THREE LEVELS, one precise composition -------------------------------------------------------
//   top     architectural dimension line, as wide as the helmet
//   centre  safety hard hat in a real 3/4 view (33 deg yaw): ONE solid body whose brim carries the front visor as a
//           continuous extension; crest, ribs and ventilation slots follow the curvature of the shell
//   bottom  graduated ruler with its green hook, separated from the hat by a clean transparent margin
// The art is GENERATED (scripts/gen-brand-mark.mjs: a small 3D model projected with a 3/4 camera, lettering converted
// from Montserrat ExtraBold to outlines) into markArt.js, so every asset below draws exactly the same vectors.
import { MARK_ART, MARK_BOX, MARK_LAYOUT, WORD, LETTER_PATHS, WORD_BOX } from './markArt.js';
export { MARK_ART, MARK_BOX, MARK_LAYOUT, WORD, LETTER_PATHS, WORD_BOX };
export const MARK_RATIO = MARK_BOX.h / MARK_BOX.w; // height / width

/** Hard hat on transparent background (the in-app logo). */
export function buildMarkSvg() {
  const { x, y, w, h } = MARK_BOX;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="CUBRAX">${MARK_ART}</svg>`;
}

// ---- the wordmark: geometric sans (Montserrat ExtraBold outlines), white, with the X in brand green --------------
export const wordmarkInner = (ink = '#ffffff') => [...WORD].map((c) => `<path d="${LETTER_PATHS[c]}" fill="${c === 'X' ? BRAND.green : ink}"/>`).join('');
export const WORD_VIEWBOX = `${WORD_BOX.x} ${WORD_BOX.y} ${WORD_BOX.w} ${WORD_BOX.h}`;

/** Complete lockup on black: hard hat, CUBRAX, "Un producto Japadigital" (1024 x 1024, exported as /logo.png). */
export function buildLockupSvg() {
  const { x, y, w, h } = MARK_BOX;
  const s = 0.95;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="CUBRAX">' +
    '<rect width="1024" height="1024" fill="#000000"/>' +
    `<svg x="${512 - (w * s) / 2}" y="108" width="${w * s}" height="${h * s}" viewBox="${x} ${y} ${w} ${h}">${MARK_ART}</svg>` +
    `<g transform="translate(${512 - (WORD_BOX.w * 1.5) / 2} 652) scale(1.5)">${wordmarkInner()}</g>` +
    '<text x="512" y="782" text-anchor="middle" fill="#a3a3a3" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="38" letter-spacing="2">Un producto Japadigital</text>' +
    '</svg>'
  );
}

/**
 * App icon: the hard hat centred on an OLED-black rounded tile.
 * @param {{maskable?: boolean}} opts maskable => full-bleed background, content scaled into the safe zone.
 */
export function buildIconSvg({ maskable = false } = {}) {
  const k = maskable ? 0.74 : 0.95;
  const { x, y, w, h } = MARK_BOX;
  const art = `<svg x="${256 - (w * k) / 2}" y="${256 - (h * k) / 2}" width="${w * k}" height="${h * k}" viewBox="${x} ${y} ${w} ${h}">${MARK_ART}</svg>`;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="CUBRAX">' +
    `<rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="#000000"/>` +
    '<rect x="6" y="6" width="500" height="500" rx="106" fill="none" stroke="#22c55e" stroke-width="4" stroke-opacity=".45"' +
    (maskable ? ' display="none"' : '') +
    '/>' +
    art +
    '</svg>'
  );
}

export const ICON_SVG = buildIconSvg();

export const ICON_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(ICON_SVG)}`;
/** The in-app logo: the hard hat alone, transparent, for the OLED background. */
export const MARK_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(buildMarkSvg())}`;

/** PNG outputs generated from the SVG at build/dev time. */
export const PNG_ICONS = Object.freeze([
  { file: 'icon-192.png', size: 192, maskable: false, purpose: 'any' },
  { file: 'icon-512.png', size: 512, maskable: false, purpose: 'any' },
  { file: 'icon-maskable-512.png', size: 512, maskable: true, purpose: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, maskable: true, purpose: null },
]);
/** Full lockup (hard hat + CUBRAX + credit) for sharing / link previews. */
export const LOGO_FILE = 'logo.png';

/** Manifest generated from brand data, so name/icons never drift apart. */
export function buildManifest() {
  return {
    id: BRAND.appId,
    name: BRAND.name,
    short_name: BRAND.shortName,
    description: BRAND.description,
    lang: 'es',
    dir: 'ltr',
    start_url: './',
    scope: './',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: BRAND.black,
    theme_color: BRAND.black,
    categories: ['business', 'productivity', 'utilities'],
    icons: [
      { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
