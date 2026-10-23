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

function tapeTicks() {
  let d = '';
  for (let i = 0; i <= 12; i += 1) {
    const x = 112 + i * 24;
    d += `M${x} 372V${i % 4 === 0 ? 410 : 394}`;
  }
  return d;
}

/**
 * Safety hard hat + blueprint grid + dimension line + measuring tape.
 * @param {{maskable?: boolean}} opts maskable => full-bleed background, content scaled into the safe zone.
 */
export function buildIconSvg({ maskable = false } = {}) {
  const art = [
    // Blueprint grid
    '<g stroke="#22c55e" stroke-opacity=".28" stroke-width="2">',
    '<path d="M96 64V448M160 64V448M224 64V448M288 64V448M352 64V448M416 64V448"/>',
    '<path d="M64 96H448M64 160H448M64 224H448M64 288H448M64 352H448M64 416H448"/>',
    '</g>',
    // Dimension line (blueprint)
    '<g fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">',
    '<path d="M96 104H416M96 90V118M416 90V118M120 94L96 104L120 114M392 94L416 104L392 114"/>',
    '</g>',
    // Hard hat dome
    '<path d="M140 304C140 214 190 150 256 150S372 214 372 304Z" fill="url(#hat)"/>',
    // Ridge
    '<path d="M238 157V304H274V157C268 152 244 152 238 157Z" fill="#15803d"/>',
    // Highlight
    '<path d="M168 288C171 238 196 196 232 174" fill="none" stroke="#ffffff" stroke-opacity=".4" stroke-width="8" stroke-linecap="round"/>',
    // Brim
    '<rect x="104" y="298" width="304" height="36" rx="18" fill="#16a34a"/>',
    '<rect x="104" y="298" width="304" height="10" rx="5" fill="#4ade80" fill-opacity=".55"/>',
    // Measuring tape
    '<rect x="88" y="372" width="336" height="58" rx="8" fill="#ffffff"/>',
    `<path d="${tapeTicks()}" stroke="#000000" stroke-width="5" stroke-linecap="butt"/>`,
    '<rect x="68" y="362" width="20" height="78" rx="5" fill="#22c55e"/>',
  ].join('');

  const body = maskable
    ? `<g transform="translate(256 256) scale(.8) translate(-256 -256)">${art}</g>`
    : art;

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="CUBRAX">' +
    '<defs><linearGradient id="hat" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#4ade80"/><stop offset="1" stop-color="#16a34a"/></linearGradient></defs>' +
    `<rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="#000000"/>` +
    '<rect x="6" y="6" width="500" height="500" rx="106" fill="none" stroke="#22c55e" stroke-width="4" stroke-opacity=".55"' +
    (maskable ? ' display="none"' : '') +
    '/>' +
    body +
    '</svg>'
  );
}

export const ICON_SVG = buildIconSvg();

export const ICON_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(ICON_SVG)}`;

/** PNG outputs generated from the SVG at build/dev time. */
export const PNG_ICONS = Object.freeze([
  { file: 'icon-192.png', size: 192, maskable: false, purpose: 'any' },
  { file: 'icon-512.png', size: 512, maskable: false, purpose: 'any' },
  { file: 'icon-maskable-512.png', size: 512, maskable: true, purpose: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, maskable: true, purpose: null },
]);

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
