// Material catalog. `usd` = reference base price in USD (before regional index and chain factor).
// `discrete` items are sold by whole unit => quantities are rounded UP to integers.

export const CATALOG = Object.freeze({
  cement_bag: { unit: 'bag', usd: 4.8, discrete: true },
  sand: { unit: 'm3', usd: 28, discrete: false },
  gravel: { unit: 'm3', usd: 32, discrete: false },
  mesh: { unit: 'm2', usd: 2.6, discrete: false },
  poly: { unit: 'm2', usd: 0.35, discrete: false },
  block_10: { unit: 'unit', usd: 0.85, discrete: true },
  block_14: { unit: 'unit', usd: 1.05, discrete: true },
  block_19: { unit: 'unit', usd: 1.4, discrete: true },
  plate_125: { unit: 'unit', usd: 9.5, discrete: true },
  plate_15: { unit: 'unit', usd: 11.5, discrete: true },
  stud: { unit: 'unit', usd: 3.2, discrete: true },
  track: { unit: 'unit', usd: 2.8, discrete: true },
  screws: { unit: 'box', usd: 9, discrete: true },
  tape: { unit: 'roll', usd: 3.5, discrete: true },
  compound: { unit: 'bucket', usd: 14, discrete: true },
});

export const MATERIAL_IDS = Object.freeze(Object.keys(CATALOG));
