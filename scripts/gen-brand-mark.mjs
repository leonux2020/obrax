// Generates src/brand/markArt.js: the CUBRAX isotype and lettering as pure vector data.
//
//   npm i --no-save opentype.js @fontsource/montserrat   (dev tools, NOT app dependencies)
//   node scripts/gen-brand-mark.mjs
//
// The hard hat is not hand-drawn: it is a small 3D model (an ellipsoid shell, a crest and two ribs on its surface,
// ventilation slots on its side, and ONE brim outline that carries the front visor as a continuous extension of the
// body) projected with a real 3/4 camera (yaw 33 deg, pitch 16 deg). That is what keeps the perspective, the slots
// and the ribs coherent with the curvature of the shell. The lettering is Montserrat ExtraBold (SIL OFL 1.1) converted
// to outlines, so it needs no font at run time and renders identically everywhere.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const opentype = require('opentype.js');
const fontFile = require.resolve('@fontsource/montserrat/files/montserrat-latin-800-normal.woff');

// ---------------------------------------------------------------------------------------------------------------
// camera
const ALPHA = (33 * Math.PI) / 180; // angle between the helmet's facing direction and the view axis (3/4: 30-35 deg)
const TAU = (16 * Math.PI) / 180; // camera looks slightly down on the helmet
const sA = Math.sin(ALPHA), cA = Math.cos(ALPHA), sT = Math.sin(TAU), cT = Math.cos(TAU);
// local axes: X front, Y up, Z lateral (the +Z side is the one turned towards the viewer)
const proj = ([X, Y, Z]) => {
  const sx = -X * sA + Z * cA;
  const d = X * cA + Z * sA; // depth towards the viewer
  return [sx, -(Y * cT - d * sT)]; // y down
};
const V = [cA * cT, sT, sA * cT]; // towards the viewer, local axes

// shell: ellipsoid, upper half
const AX = 1.1, AY = 0.86, AZ = 0.94;
const surf = (lam, el, lift = 1) => [lift * AX * Math.cos(lam) * Math.cos(el), lift * AY * Math.sin(el), lift * AZ * Math.sin(lam) * Math.cos(el)];
const normal = ([X, Y, Z]) => [X / AX ** 2, Y / AY ** 2, Z / AZ ** 2];
const visible = (p) => { const n = normal(p); return n[0] * V[0] + n[1] * V[1] + n[2] * V[2] > 0.02; };
// point at fixed lateral offset z0 along the front-to-rear arc (crest / ribs)
const arc = (z0, beta, lift = 1) => {
  const s = Math.sqrt(Math.max(0, 1 - (z0 / AZ) ** 2));
  return [lift * AX * s * Math.cos(beta), lift * AY * s * Math.sin(beta), z0 * (lift > 1 ? 1 : 1)];
};

// ---------------------------------------------------------------------------------------------------------------
// path helpers
const f = (n) => (Math.round(n * 10) / 10).toString();
function smooth(pts, closed = false) {
  // Catmull-Rom -> cubic Bezier
  const n = pts.length;
  const at = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i += 1) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + (closed ? 'Z' : '');
}
function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  const up = [];
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}
const resample = (poly, count) => {
  // equal arc-length resampling of a closed polygon
  const L = [0];
  for (let i = 1; i <= poly.length; i += 1) { const a = poly[i - 1], b = poly[i % poly.length]; L.push(L[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = L.at(-1);
  const out = [];
  let j = 0;
  for (let k = 0; k < count; k += 1) {
    const t = (k / count) * total;
    while (L[j + 1] < t) j += 1;
    const a = poly[j], b = poly[(j + 1) % poly.length];
    const u = (t - L[j]) / (L[j + 1] - L[j] || 1);
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------------------
// the model, projected (unit coordinates, y down)
// 1. dome silhouette = convex hull of the projected shell surface
const domePts = [];
for (let i = 0; i <= 120; i += 1) for (let j = 0; j <= 40; j += 1) domePts.push(proj(surf((i / 120) * Math.PI * 2, (j / 40) * (Math.PI / 2))));
const domeOutline = resample(hull(domePts), 44);

// 2. the brim: ONE outline (plan view) = base ellipse offset outward, with the visor as a smooth bulge at the front
const BRIM_T = 0.075; // thickness of the brim edge
const plan = [];
for (let i = 0; i < 160; i += 1) {
  const th = (i / 160) * Math.PI * 2 - Math.PI; // -PI..PI, 0 = straight ahead
  const wrap = Math.atan2(Math.sin(th), Math.cos(th));
  const g = Math.exp(-((wrap / 0.7) ** 2)); // visor weight: 1 in front, fades round the sides
  const off = 0.05 + 0.3 * g ** 1.3; // rim width + visor length
  const nx = Math.cos(wrap) / AX, nz = Math.sin(wrap) / AZ, nl = Math.hypot(nx, nz);
  const X = AX * Math.cos(wrap) + (off * nx) / nl;
  const Z = AZ * Math.sin(wrap) + (off * nz) / nl;
  const Y = -0.1 * g ** 1.6; // the visor dips slightly: part of the same surface, not a separate flap
  plan.push([X, Y, Z]);
}
const brimTop = plan.map(proj);
const brimBottom = plan.map(([X, Y, Z]) => proj([X, Y - BRIM_T, Z]));
const brimBottomPath = smooth(resample(hull([...brimTop, ...brimBottom]), 60), true);
const brimTopPath = smooth(resample(brimTop, 60), true);
const brimLip = [...brimTop, ...[...brimBottom].reverse()];

// 3. crest and ribs (on the surface, only the visible part)
const band = (zA, zB, lift) => {
  const a = [], b = [];
  for (let i = 0; i <= 28; i += 1) {
    const beta = (i / 28) * Math.PI;
    a.push(proj(arc(zA, beta, lift)));
    b.push(proj(arc(zB, beta, lift)));
  }
  return [...a, ...b.reverse()];
};
// the crest stops where the shell turns away from the camera (nothing of the far side is drawn)
const BETA_END = (() => {
  let b = Math.PI;
  while (b > 0.2 && !(visible(arc(-0.17, b, 1.0)) && visible(arc(0.17, b, 1.0)))) b -= 0.01;
  return b;
})();
const crestSide = (z0) => Array.from({ length: 29 }, (_, i) => proj(arc(z0, (i / 28) * BETA_END, 1.045)));
const crestLo = crestSide(-0.17);
const crestHi = crestSide(0.17);
const crestPoly = [...crestLo, ...crestHi.slice().reverse()];
const ribLine = (z0) => {
  const pts = [];
  for (let i = 0; i <= 24; i += 1) {
    const beta = 0.1 + (i / 24) * (Math.PI - 0.3);
    const p = arc(z0, beta, 1.0);
    if (visible(p)) pts.push(proj(p));
  }
  return pts;
};

// 4. ventilation slots on the visible side, following the shell's curvature
const slot = (lam, el, dl, de) => {
  const pts = [];
  const edge = (a, b, n) => { for (let i = 0; i < n; i += 1) { const t = i / n; pts.push(proj(surf(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))); } };
  const c = [[lam - dl, el - de], [lam + dl, el - de], [lam + dl, el + de], [lam - dl, el + de]];
  for (let k = 0; k < 4; k += 1) edge(c[k], c[(k + 1) % 4], 5);
  return pts;
};
const rad = (d) => (d * Math.PI) / 180;
const slots = [
  slot(rad(56), rad(30), rad(3.2), rad(8)),
  slot(rad(72), rad(30), rad(3.2), rad(8)),
  slot(rad(88), rad(30), rad(3.2), rad(8)),
];

// 5. highlight: a curve on the lit front-top of the shell
const highlight = [];
for (let i = 0; i <= 12; i += 1) { const p = arc(-0.45, 0.35 + (i / 12) * 0.75); if (visible(p)) highlight.push(proj(p)); }

// ---------------------------------------------------------------------------------------------------------------
// fit to the 512 canvas and compose the three levels
const all = [...domeOutline, ...brimTop, ...brimBottom];
const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]));
const minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]));
const HAT_W = 330;
const k = HAT_W / (maxX - minX);
const CX = 256;
const GAP_TOP = 30; // dimension line <-> helmet
const GAP_BOTTOM = 34; // helmet <-> ruler: clean transparent margin
const TICK = 30; // extension ticks of the dimension line
const RULER_H = 54;
const TOP = 54;
const hatTop = TOP + TICK + GAP_TOP; // y of the highest point of the helmet
const T = ([x, y]) => [CX + (x - (minX + maxX) / 2) * k, hatTop + (y - minY) * k];
const tp = (poly) => poly.map(T);
const x0 = CX - HAT_W / 2, x1 = CX + HAT_W / 2;
const hatBottom = hatTop + (maxY - minY) * k;
const dimY = TOP + TICK / 2;
const rulerY = Math.round(hatBottom + GAP_BOTTOM);
const bottom = rulerY + RULER_H + 8;

const parts = [];
parts.push(`<defs>
<linearGradient id="shell" x1="0.1" y1="0" x2="0.9" y2="1"><stop offset="0" stop-color="#6ee7a0"/><stop offset=".5" stop-color="#22c55e"/><stop offset="1" stop-color="#14803f"/></linearGradient>
<radialGradient id="lit" cx=".3" cy=".22" r=".6"><stop offset="0" stop-color="#ffffff" stop-opacity=".34"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<linearGradient id="shade" x1="0.35" y1="0.2" x2="1" y2="1"><stop offset="0" stop-color="#022c12" stop-opacity="0"/><stop offset="1" stop-color="#022c12" stop-opacity=".5"/></linearGradient>
<linearGradient id="visor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4ade80"/><stop offset="1" stop-color="#16a34a"/></linearGradient>
<clipPath id="dome"><path d="${smooth(tp(domeOutline), true)}"/></clipPath>
</defs>`);
// level 1: dimension line, as wide as the helmet
parts.push(`<g fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M${f(x0)} ${f(dimY)}H${f(x1)}M${f(x0)} ${f(dimY - TICK / 2)}V${f(dimY + TICK / 2)}M${f(x1)} ${f(dimY - TICK / 2)}V${f(dimY + TICK / 2)}M${f(x0 + 26)} ${f(dimY - 10)}L${f(x0)} ${f(dimY)}L${f(x0 + 26)} ${f(dimY + 10)}M${f(x1 - 26)} ${f(dimY - 10)}L${f(x1)} ${f(dimY)}L${f(x1 - 26)} ${f(dimY + 10)}"/></g>`);
// level 2: the hard hat. Brim (one solid, visor included) first, then the shell on top of it
parts.push(`<path d="${smooth(tp(resample(hull([...brimTop, ...brimBottom]), 60)), true)}" fill="#14803f"/>`); // brim edge (thickness)
parts.push(`<path d="${smooth(tp(resample(brimTop, 60)), true)}" fill="url(#visor)"/>`); // brim top face + visor
parts.push(`<path d="${smooth(tp(domeOutline), true)}" fill="url(#shell)"/>`);
parts.push(`<g clip-path="url(#dome)">`);
parts.push(`<path d="${smooth(tp(domeOutline), true)}" fill="url(#lit)"/><path d="${smooth(tp(domeOutline), true)}" fill="url(#shade)"/>`);
parts.push(`<path d="${smooth(tp(resample(crestPoly, 44)), true)}" fill="#16a34a" stroke="#15803d" stroke-width="2"/>`);
parts.push(`<path d="${smooth(tp(crestLo))}" fill="none" stroke="#bbf7d0" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>`);
for (const z of [-0.58, 0.58]) { const r = ribLine(z); if (r.length > 3) parts.push(`<path d="${smooth(tp(r))}" fill="none" stroke="#052e16" stroke-opacity=".38" stroke-width="3.2" stroke-linecap="round"/>`); }
if (highlight.length > 3) parts.push(`<path d="${smooth(tp(highlight))}" fill="none" stroke="#ffffff" stroke-opacity=".45" stroke-width="6" stroke-linecap="round"/>`);
for (const s of slots) parts.push(`<path d="${smooth(tp(s), true)}" fill="#052e16" fill-opacity=".9"/>`);
parts.push(`</g>`);
// the brim meets the shell: a thin contact shadow along the base, no separate pieces
parts.push(`<path d="${smooth(tp(domeOutline.filter(() => true)), true)}" fill="none" stroke="#052e16" stroke-opacity=".0" stroke-width="0"/>`);
// level 3: graduated ruler with its hook
const tickPath = (() => { let d = ''; const step = (x1 - (x0 + 38)) / 18; for (let i = 0; i <= 18; i += 1) { const x = x0 + 38 + i * step; d += `M${f(x)} ${rulerY}V${rulerY + (i % 3 === 0 ? 26 : 15)}`; } return d; })();
parts.push(`<rect x="${f(x0 + 18)}" y="${rulerY}" width="${f(x1 - x0 - 18)}" height="${RULER_H}" rx="6" fill="#ffffff"/>`);
parts.push(`<path d="${tickPath}" stroke="#000000" stroke-width="4"/>`);
parts.push(`<rect x="${f(x0)}" y="${rulerY - 8}" width="18" height="${RULER_H + 16}" rx="4" fill="#22c55e"/>`);

const MARK_ART = parts.join('\n').replace(/\n+/g, '\n');
const box = { x: Math.floor(x0 - 14), y: Math.floor(TOP - 14), w: Math.ceil(x1 - x0 + 28), h: Math.ceil(bottom - TOP + 28) };
const layout = { helmet: { top: +hatTop.toFixed(1), bottom: +hatBottom.toFixed(1) }, ruler: { y: rulerY, h: RULER_H }, gap: +(rulerY - hatBottom).toFixed(1), dimension: { y: +dimY.toFixed(1), x0: +x0.toFixed(1), x1: +x1.toFixed(1) } };

// ---------------------------------------------------------------------------------------------------------------
// lettering: Montserrat ExtraBold outlines
const raw = fs.readFileSync(fontFile);
const font = opentype.parse(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const SIZE = 100, TRACK = 7;
let penX = 0;
const letters = [];
for (const ch of 'CUBRAX') {
  const g = font.charToGlyph(ch);
  const p = g.getPath(penX, 0, SIZE);
  letters.push({ ch, d: p.toPathData(1) });
  penX += (g.advanceWidth * SIZE) / font.unitsPerEm + TRACK;
}
const capH = (font.tables.os2.sCapHeight * SIZE) / font.unitsPerEm;
const wordBox = { x: 0, y: -Math.ceil(capH) - 1, w: Math.ceil(penX - TRACK) + 1, h: Math.ceil(capH) + 2 };

const out = `// GENERATED by scripts/gen-brand-mark.mjs. Do not edit by hand: change the generator and run it again.
// CUBRAX isotype (dimension line + 3/4 hard hat + ruler) and lettering (Montserrat ExtraBold outlines, SIL OFL 1.1).

export const MARK_ART = ${JSON.stringify(MARK_ART)};
export const MARK_BOX = Object.freeze(${JSON.stringify(box)});
export const MARK_LAYOUT = Object.freeze(${JSON.stringify(layout)});
export const WORD = 'CUBRAX';
export const LETTER_PATHS = Object.freeze(${JSON.stringify(Object.fromEntries(letters.map((l) => [l.ch, l.d])), null, 2)});
export const WORD_BOX = Object.freeze(${JSON.stringify(wordBox)});
`;
fs.writeFileSync(path.join(here, '../src/brand/markArt.js'), out);
console.log('markArt.js written', box, layout, wordBox);
