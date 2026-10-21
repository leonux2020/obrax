// Cubication formulas. Pure functions: easy to test, no DOM, no side effects.
// Units: lengths in m, thickness in cm (slab/masonry) or mm (drywall), areas in m2, volumes in m3.

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

// Concrete (approx. 1:2:3, ~300 kg cement per m3)
export const CONCRETE = Object.freeze({ cementBagsPerM3: 12, sandM3PerM3: 0.5, gravelM3PerM3: 0.85, waterLitersPerM3: 180 });
// Mortar 1:4 (~400 kg cement per m3)
export const MORTAR = Object.freeze({ cementBagsPerM3: 16, sandM3PerM3: 1.1, jointFraction: 0.1 });
export const MASONRY = Object.freeze({ blocksPerM2: 12.5 }); // 39 x 19 cm block incl. joint
export const DRYWALL = Object.freeze({
  plateArea: 1.22 * 2.44,
  studSpacing: 0.6,
  profileLength: 2.4,
  screwsPerM2: 25,
  screwsPerBox: 1000,
  tapeMetersPerM2: 1.2,
  tapeRollMeters: 90,
  compoundKgPerM2: 0.45,
  compoundBucketKg: 25,
});

export function calcSlab({ length, width, thickness }) {
  const area = length * width;
  const volume = (area * thickness) / 100;
  return {
    metrics: [
      { key: 'area', value: r2(area), unit: 'm2' },
      { key: 'volume', value: r3(volume), unit: 'm3' },
      { key: 'water', value: Math.round(volume * CONCRETE.waterLitersPerM3), unit: 'l' },
    ],
    lines: [
      { id: 'cement_bag', qty: volume * CONCRETE.cementBagsPerM3 },
      { id: 'sand', qty: volume * CONCRETE.sandM3PerM3 },
      { id: 'gravel', qty: volume * CONCRETE.gravelM3PerM3 },
      { id: 'mesh', qty: area * 1.1 }, // 10% overlap
      { id: 'poly', qty: area * 1.15 }, // 15% overlap / edges
    ],
  };
}

export function blockForThickness(thicknessCm) {
  if (thicknessCm <= 12) return 'block_10';
  if (thicknessCm <= 16) return 'block_14';
  return 'block_19';
}

export function calcMasonry({ length, height, thickness, openings = 0 }) {
  const gross = length * height;
  const net = Math.max(0, gross - openings);
  const mortar = net * (thickness / 100) * MORTAR.jointFraction;
  return {
    metrics: [
      { key: 'grossArea', value: r2(gross), unit: 'm2' },
      { key: 'netArea', value: r2(net), unit: 'm2' },
      { key: 'mortar', value: r3(mortar), unit: 'm3' },
    ],
    lines: [
      { id: blockForThickness(thickness), qty: net * MASONRY.blocksPerM2 },
      { id: 'cement_bag', qty: mortar * MORTAR.cementBagsPerM3 },
      { id: 'sand', qty: mortar * MORTAR.sandM3PerM3 },
    ],
  };
}

export function calcDrywall({ length, height, thickness, openings = 0, faces = 2 }) {
  const gross = length * height;
  const net = Math.max(0, gross - openings);
  const plateArea = net * faces;
  const studs = Math.floor(length / DRYWALL.studSpacing) + 1;
  // Needs are expressed in the catalog BASE unit (m2, m, units, kg). Conversion to whole sale
  // formats (boards, 2.4 m profiles, boxes, rolls, buckets) happens in planPurchase().
  return {
    metrics: [
      { key: 'grossArea', value: r2(gross), unit: 'm2' },
      { key: 'netArea', value: r2(net), unit: 'm2' },
      { key: 'plateArea', value: r2(plateArea), unit: 'm2' },
    ],
    lines: [
      { id: thickness <= 13 ? 'plate_125' : 'plate_15', qty: plateArea },
      // Studs are cut pieces: the purchase plan packs them into 2.4 m profiles (offcuts become leftover).
      { id: 'stud', qty: studs * height, cut: { count: studs, length: height } },
      { id: 'track', qty: 2 * length },
      { id: 'screws', qty: plateArea * DRYWALL.screwsPerM2 },
      { id: 'tape', qty: plateArea * DRYWALL.tapeMetersPerM2 },
      { id: 'compound', qty: plateArea * DRYWALL.compoundKgPerM2 },
    ],
  };
}

// ---- roofs -------------------------------------------------------------------
export const ROOF = Object.freeze({
  sheetsPerM2: 1, // area-based: converted to whole sheets through the catalog format
  tilesPerM2: 10,
  purlinSpacingZinc: 1.0, // m between purlin rows (zinc)
  purlinSpacingTile: 0.5, // m between battens/purlins (tile)
  screwsPerM2: 6,
  downspoutEveryM: 8, // one downspout per 8 m of eave
});

/** Pitch factor: inclined roof area = plan area / cos(slope). */
export const pitchFactor = (slopeDeg) => 1 / Math.cos((slopeDeg * Math.PI) / 180);

export function calcRoof({ length, width, slope, overhang = 0, roofing = 'zinc', insulation = 1, gutters = 1 }) {
  const runL = length + 2 * overhang;
  const runW = width + 2 * overhang;
  const planArea = runL * runW;
  const factor = pitchFactor(slope);
  const roofArea = planArea * factor;
  // Gable roof: ridge runs along the longest side, two slopes of (shortest side / 2) / cos(slope).
  const ridge = Math.max(runL, runW);
  const slopeLength = (Math.min(runL, runW) / 2) * factor;
  const tile = roofing === 'tile';
  const spacing = tile ? ROOF.purlinSpacingTile : ROOF.purlinSpacingZinc;
  const rows = Math.ceil(slopeLength / spacing) + 1;
  const eaves = 2 * ridge;

  const lines = [
    tile ? { id: 'roof_tile', qty: roofArea * ROOF.tilesPerM2 } : { id: 'roof_zinc', qty: roofArea },
    { id: tile ? 'ridge_tile' : 'ridge_zinc', qty: ridge },
    { id: 'purlin', qty: 2 * rows * ridge },
  ];
  if (!tile) lines.push({ id: 'roof_screws', qty: roofArea * ROOF.screwsPerM2 });
  if (insulation) lines.push({ id: 'insulation', qty: roofArea });
  if (gutters) {
    lines.push({ id: 'gutter', qty: eaves });
    lines.push({ id: 'downspout', qty: Math.max(2, Math.ceil(eaves / ROOF.downspoutEveryM)) });
  }
  return {
    metrics: [
      { key: 'planArea', value: r2(planArea), unit: 'm2' },
      { key: 'roofArea', value: r2(roofArea), unit: 'm2' },
      { key: 'slopeFactor', value: r3(factor), unit: 'x' },
      { key: 'ridgeLength', value: r2(ridge), unit: 'm' },
    ],
    lines,
  };
}

// ---- floors / coverings ----------------------------------------------------------
export const FLOOR = Object.freeze({ adhesiveKgPerM2: 4.5, groutKgPerM2: 0.5 });
export const FLOOR_FORMATS = Object.freeze(['30', '45', '60']);

export function calcFloor({ length, width, openings = 0, format = '45' }) {
  const gross = length * width;
  const net = Math.max(0, gross - openings);
  const id = `floor_${FLOOR_FORMATS.includes(String(format)) ? format : '45'}`;
  return {
    metrics: [
      { key: 'grossArea', value: r2(gross), unit: 'm2' },
      { key: 'netArea', value: r2(net), unit: 'm2' },
    ],
    // The cut-waste % of the partida is applied by the purchase planner; boxes are always whole.
    lines: [
      { id, qty: net },
      { id: 'adhesive', qty: net * FLOOR.adhesiveKgPerM2 },
      { id: 'grout', qty: net * FLOOR.groutKgPerM2 },
    ],
  };
}

// ---- paints / finishes --------------------------------------------------------------
export const PAINT = Object.freeze({ paintM2PerLiter: 10, primerM2PerLiter: 12, puttyKgPerM2: 0.5 });

export function calcPaint({ length, height, openings = 0, coats = 2, primer = 1, putty = 0 }) {
  const gross = length * height;
  const net = Math.max(0, gross - openings);
  const lines = [{ id: 'paint', qty: (net * coats) / PAINT.paintM2PerLiter }];
  if (primer) lines.push({ id: 'primer', qty: net / PAINT.primerM2PerLiter });
  if (putty) lines.push({ id: 'putty', qty: net * PAINT.puttyKgPerM2 });
  return {
    metrics: [
      { key: 'grossArea', value: r2(gross), unit: 'm2' },
      { key: 'netArea', value: r2(net), unit: 'm2' },
      { key: 'paintArea', value: r2(net * coats), unit: 'm2' },
    ],
    lines,
  };
}

export const CALCULATORS = Object.freeze({
  slab: calcSlab,
  masonry: calcMasonry,
  drywall: calcDrywall,
  roof: calcRoof,
  floor: calcFloor,
  paint: calcPaint,
});
