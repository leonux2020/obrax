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

// ---- the mark: safety hard hat in 3/4 perspective (front visor, ventilation slots, centre crest) --------------
// Pure vector, drawn in a 512 box; the artwork occupies x 22-446, y 100-384. Green on transparent: it sits on the
// OLED black of the app, or on the black tile of the app icon.
export const MARK_ART = `<defs>
 <clipPath id="dome"><path d="M92 316C92 196 170 108 268 108S432 196 432 316Z"/></clipPath>
 <linearGradient id="shell" x1="0.15" y1="0" x2="0.85" y2="1"><stop offset="0" stop-color="#6ee7a0"/><stop offset=".45" stop-color="#22c55e"/><stop offset="1" stop-color="#15803d"/></linearGradient>
 <linearGradient id="crest" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4ade80"/><stop offset="1" stop-color="#166534"/></linearGradient>
 <linearGradient id="brim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16a34a"/><stop offset="1" stop-color="#14532d"/></linearGradient>
 <linearGradient id="bill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4ade80"/><stop offset="1" stop-color="#15803d"/></linearGradient>
</defs>
<path d="M92 316C92 196 170 108 268 108S432 196 432 316Z" fill="url(#shell)"/>
<g clip-path="url(#dome)"><path d="M204 320C196 214 236 126 304 96L352 100C290 140 262 224 266 320Z" fill="url(#crest)"/><path d="M352 100C290 140 262 224 266 320" fill="none" stroke="#bbf7d0" stroke-opacity=".55" stroke-width="3"/></g>
<g stroke="#052e16" stroke-width="15" stroke-linecap="round" fill="none">
 <path d="M352 190L384 236"/><path d="M336 224L372 276"/><path d="M322 258L358 306"/>
</g>
<path d="M120 290C128 214 172 156 224 132" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="9" stroke-linecap="round"/>
<path d="M76 322C76 298 158 290 250 292C350 294 436 300 446 322C446 348 368 356 256 356C148 356 76 346 76 322Z" fill="url(#brim)"/>
<path d="M76 322C76 298 158 290 250 292C350 294 436 300 446 322" fill="none" stroke="#86efac" stroke-opacity=".6" stroke-width="4"/>
<path d="M76 322C46 322 22 340 34 358C52 380 140 384 214 362L196 340Z" fill="url(#bill)"/>
<path d="M34 358C52 380 140 384 214 362" fill="none" stroke="#052e16" stroke-opacity=".5" stroke-width="4"/>
<path d="M60 334C82 328 130 330 190 342" fill="none" stroke="#dcfce7" stroke-opacity=".55" stroke-width="4" stroke-linecap="round"/>`;
export const MARK_BOX = Object.freeze({ x: 16, y: 84, w: 440, h: 316 }); // tight crop of the artwork
export const MARK_RATIO = MARK_BOX.h / MARK_BOX.w;

/** Hard hat on transparent background (the in-app logo). */
export function buildMarkSvg() {
  const { x, y, w, h } = MARK_BOX;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="CUBRAX">${MARK_ART}</svg>`;
}

// ---- the wordmark: technological monoline letters, white, with the X in brand green --------------------------
// One 60 x 80 cell per letter (advance 72); drawn as strokes so it needs no font and stays sharp at any size.
export const WORD = 'CUBRAX';
export const LETTER_PATHS = Object.freeze({
  C: 'M50 10H22L10 22V58L22 70H50',
  U: 'M10 10V58L22 70H38L50 58V10',
  B: 'M10 70V10H36L46 20V32L36 40H10M36 40L48 50V60L38 70H10',
  R: 'M10 70V10H36L46 20V32L36 42H10M30 42L48 70',
  A: 'M8 70L22 10H38L52 70M17 50H43',
  X: 'M8 10L52 70M52 10L8 70',
});
export const WORD_BOX = Object.freeze({ w: 5 * 72 + 60 + 8, h: 80 }); // generous side bearing for the stroke
export const wordmarkInner = (ink = '#ffffff') =>
  [...WORD]
    .map((c, i) => `<path d="${LETTER_PATHS[c]}" transform="translate(${i * 72 + 2} 0)" fill="none" stroke="${c === 'X' ? BRAND.green : ink}" stroke-width="12" stroke-linejoin="miter" stroke-linecap="square"/>`)
    .join('');

/** Complete lockup on black: hard hat, CUBRAX, "Un producto Japadigital" (1024 x 1024, exported as /logo.png). */
export function buildLockupSvg() {
  const { x, y, w, h } = MARK_BOX;
  const s = 0.95;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="CUBRAX">' +
    '<rect width="1024" height="1024" fill="#000000"/>' +
    `<svg x="${512 - (w * s) / 2}" y="130" width="${w * s}" height="${h * s}" viewBox="${x} ${y} ${w} ${h}">${MARK_ART}</svg>` +
    `<g transform="translate(${512 - (WORD_BOX.w * 1.5) / 2} 560) scale(1.5)">${wordmarkInner()}</g>` +
    '<text x="512" y="780" text-anchor="middle" fill="#a3a3a3" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="38" letter-spacing="2">Un producto Japadigital</text>' +
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
