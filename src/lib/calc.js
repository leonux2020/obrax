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
  const studsPerRow = Math.floor(length / DRYWALL.studSpacing) + 1;
  const rows = Math.ceil(height / DRYWALL.profileLength);
  return {
    metrics: [
      { key: 'grossArea', value: r2(gross), unit: 'm2' },
      { key: 'netArea', value: r2(net), unit: 'm2' },
      { key: 'plateArea', value: r2(plateArea), unit: 'm2' },
    ],
    lines: [
      { id: thickness <= 13 ? 'plate_125' : 'plate_15', qty: plateArea / DRYWALL.plateArea },
      { id: 'stud', qty: studsPerRow * rows },
      { id: 'track', qty: 2 * Math.ceil(length / DRYWALL.profileLength) },
      { id: 'screws', qty: (plateArea * DRYWALL.screwsPerM2) / DRYWALL.screwsPerBox },
      { id: 'tape', qty: (plateArea * DRYWALL.tapeMetersPerM2) / DRYWALL.tapeRollMeters },
      { id: 'compound', qty: (plateArea * DRYWALL.compoundKgPerM2) / DRYWALL.compoundBucketKg },
    ],
  };
}

export const CALCULATORS = Object.freeze({ slab: calcSlab, masonry: calcMasonry, drywall: calcDrywall });
