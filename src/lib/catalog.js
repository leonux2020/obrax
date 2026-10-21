// Material catalog with COMMERCIAL SALE FORMATS.
//
//  base  : unit the takeoff formulas work in (m2, m3, m, kg, unit ...)
//  sale  : unit the item is actually sold in (panel, roll, sheet, piece, bag ...)
//  size  : how many `base` units one sale unit contains (indivisible: you buy whole sale units)
//  usd   : reference price in USD of ONE SALE UNIT (before regional index and chain factor)
//
// The geometric need is converted to whole sale units with Math.ceil (see planPurchase in pricing.js),
// so the quote always reflects what is really paid at the store. The unused part is the leftover.

import { DRYWALL } from './calc.js';

export const CATALOG = Object.freeze({
  cement_bag: { base: 'bag', sale: 'bag', size: 1, usd: 4.8 },
  // Bulk aggregates are bagged by the store in half-cubic-metre big bags.
  sand: { base: 'm3', sale: 'bigbag', size: 0.5, usd: 14.5 },
  gravel: { base: 'm3', sale: 'bigbag', size: 0.5, usd: 16.5 },
  // Welded wire mesh: standard 2.4 x 6.0 m panel. Polyethylene: 2 x 50 m roll.
  mesh: { base: 'm2', sale: 'panel', size: 14.4, usd: 37.5 },
  poly: { base: 'm2', sale: 'roll', size: 100, usd: 35 },
  block_10: { base: 'unit', sale: 'unit', size: 1, usd: 0.85 },
  block_14: { base: 'unit', sale: 'unit', size: 1, usd: 1.05 },
  block_19: { base: 'unit', sale: 'unit', size: 1, usd: 1.4 },
  // Drywall boards 1.22 x 2.44 m (area-based need, sold per whole board).
  plate_125: { base: 'm2', sale: 'sheet', size: DRYWALL.plateArea, usd: 9.5 },
  plate_15: { base: 'm2', sale: 'sheet', size: DRYWALL.plateArea, usd: 11.5 },
  // Steel profiles in 2.40 m pieces (need measured in linear metres).
  stud: { base: 'm', sale: 'piece', size: DRYWALL.profileLength, usd: 3.2 },
  track: { base: 'm', sale: 'piece', size: DRYWALL.profileLength, usd: 2.8 },
  screws: { base: 'unit', sale: 'box', size: DRYWALL.screwsPerBox, usd: 9 },
  tape: { base: 'm', sale: 'roll', size: DRYWALL.tapeRollMeters, usd: 3.5 },
  compound: { base: 'kg', sale: 'bucket', size: DRYWALL.compoundBucketKg, usd: 14 },
});

export const MATERIAL_IDS = Object.freeze(Object.keys(CATALOG));
