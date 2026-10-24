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
//   top     architectural dimension line (extension ticks + arrowheads)
//   centre  safety hard hat in 3/4 perspective: the centre crest and the ventilation slots sit on the right of the
//           dome, the modern flat-edged visor points to the front-left. Only arcs, straight lines and rounded
//           rectangles: no free-hand curves, nothing deformed
//   bottom  graduated ruler / tape measure (green hook on the left) as the horizontal base
// Drawn once in a 512 box (artwork: x 40-434, y 62-420), green / white on transparent: it sits on the OLED black
// of the app or on the black tile of the app icon.
const RULER_TICKS = Array.from({ length: 17 }, (_, i) => `M${112 + i * 18} 366V${i % 4 === 0 ? 392 : 380}`).join('');
export const MARK_ART = `<defs>
<linearGradient id="shell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4ade80"/><stop offset="1" stop-color="#16a34a"/></linearGradient>
<linearGradient id="visor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22c55e"/><stop offset="1" stop-color="#15803d"/></linearGradient>
<clipPath id="dome"><path d="M120 300A136 150 0 0 1 392 300Z"/></clipPath>
</defs>
<g fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
<path d="M96 82H416M96 66V98M416 66V98M122 72L96 82L122 92M390 72L416 82L390 92"/>
</g>
<path d="M120 300A136 150 0 0 1 392 300Z" fill="url(#shell)"/>
<path d="M256 150A36 150 0 0 1 292 300H340A84 150 0 0 0 256 150Z" fill="#15803d" clip-path="url(#dome)"/>
<path d="M152 276A106 136 0 0 1 203 182" fill="none" stroke="#ffffff" stroke-opacity=".45" stroke-width="8" stroke-linecap="round"/>
<g fill="#052e16"><rect x="344" y="224" width="32" height="9" rx="4.5"/><rect x="348" y="250" width="34" height="9" rx="4.5"/><rect x="352" y="274" width="34" height="9" rx="4.5"/></g>
<path d="M92 300H420A14 14 0 0 1 434 314V318A14 14 0 0 1 420 330H92A14 14 0 0 1 78 318V314A14 14 0 0 1 92 300Z" fill="#16a34a"/>
<path d="M96 300H416" stroke="#86efac" stroke-opacity=".7" stroke-width="4" stroke-linecap="round"/>
<path d="M150 306L50 324Q40 326 40 333Q40 340 50 342L208 344L228 306Z" fill="url(#visor)" stroke="#15803d" stroke-width="4" stroke-linejoin="round"/>
<path d="M54 333L222 328" stroke="#bbf7d0" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>
<rect x="96" y="360" width="320" height="52" rx="6" fill="#ffffff"/>
<path d="${RULER_TICKS}" stroke="#000000" stroke-width="5"/>
<rect x="78" y="352" width="18" height="68" rx="4" fill="#22c55e"/>
`;
export const MARK_BOX = Object.freeze({ x: 30, y: 52, w: 420, h: 380 }); // tight crop of the artwork
export const MARK_RATIO = MARK_BOX.h / MARK_BOX.w; // height / width

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
    `<svg x="${512 - (w * s) / 2}" y="104" width="${w * s}" height="${h * s}" viewBox="${x} ${y} ${w} ${h}">${MARK_ART}</svg>` +
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
