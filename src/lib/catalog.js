// Material catalog with COMMERCIAL SALE FORMATS.
//
//  base  : unit the takeoff formulas work in (m2, m3, m, kg, L, unit ...)
//  sale  : unit the item is actually sold in (panel, roll, sheet, piece, box, bag, gallon ...)
//  size  : how many `base` units one sale unit contains (indivisible: you buy whole sale units)
//  usd   : reference price in USD of ONE SALE UNIT (before regional index and chain factor)
//  bulk  : optional id of a larger format of the same product (paint: gallon + 5-gallon bucket);
//          the purchase planner fills as many bulk units as fit and finishes with small ones.
//
// The geometric need is converted to whole sale units with Math.ceil (see planMaterial in pricing.js),
// so the quote always reflects what is really paid at the store. The unused part is the leftover.

import { DRYWALL } from './calc.js';

export const CATALOG = Object.freeze({
  // ---- concrete / slabs --------------------------------------------------
  cement_bag: { base: 'bag', sale: 'bag', size: 1, usd: 4.8 },
  // Bulk aggregates are bagged by the store in half-cubic-metre big bags.
  sand: { base: 'm3', sale: 'bigbag', size: 0.5, usd: 14.5 },
  gravel: { base: 'm3', sale: 'bigbag', size: 0.5, usd: 16.5 },
  // Welded wire mesh: standard 2.4 x 6.0 m panel. Polyethylene: 2 x 50 m roll.
  mesh: { base: 'm2', sale: 'panel', size: 14.4, usd: 37.5 },
  poly: { base: 'm2', sale: 'roll', size: 100, usd: 35 },

  // ---- masonry ------------------------------------------------------------
  block_10: { base: 'unit', sale: 'unit', size: 1, usd: 0.85 },
  block_14: { base: 'unit', sale: 'unit', size: 1, usd: 1.05 },
  block_19: { base: 'unit', sale: 'unit', size: 1, usd: 1.4 },

  // ---- drywall ------------------------------------------------------------
  // Boards 1.22 x 2.44 m (area-based need, sold per whole board).
  plate_125: { base: 'm2', sale: 'sheet', size: DRYWALL.plateArea, usd: 9.5 },
  plate_15: { base: 'm2', sale: 'sheet', size: DRYWALL.plateArea, usd: 11.5 },
  // Steel profiles in 2.40 m pieces (need measured in linear metres).
  stud: { base: 'm', sale: 'piece', size: DRYWALL.profileLength, usd: 3.2 },
  track: { base: 'm', sale: 'piece', size: DRYWALL.profileLength, usd: 2.8 },
  screws: { base: 'unit', sale: 'box', size: DRYWALL.screwsPerBox, usd: 9 },
  tape: { base: 'm', sale: 'roll', size: DRYWALL.tapeRollMeters, usd: 3.5 },
  compound: { base: 'kg', sale: 'bucket', size: DRYWALL.compoundBucketKg, usd: 14 },

  // ---- roofs ---------------------------------------------------------------
  // Corrugated zinc sheet 0.85 x 3.66 m: effective cover (side + end laps) = 0.80 x 3.51 = 2.8 m2.
  roof_zinc: { base: 'm2', sale: 'sheet', size: 2.8, usd: 11 },
  roof_tile: { base: 'unit', sale: 'unit', size: 1, usd: 0.95 },
  ridge_zinc: { base: 'm', sale: 'piece', size: 1.8, usd: 6.5 },
  ridge_tile: { base: 'm', sale: 'piece', size: 0.4, usd: 1.6 },
  // Steel purlin (costanera) in 6 m bars.
  purlin: { base: 'm', sale: 'piece', size: 6, usd: 14 },
  // Glass/mineral wool roll 1.2 x 12 m.
  insulation: { base: 'm2', sale: 'roll', size: 14.4, usd: 22 },
  roof_screws: { base: 'unit', sale: 'box', size: 100, usd: 6 },
  // PVC rain gutter in 3 m pieces; downspouts are bought per piece.
  gutter: { base: 'm', sale: 'piece', size: 3, usd: 7 },
  downspout: { base: 'unit', sale: 'piece', size: 1, usd: 6 },

  // ---- floors / coverings ---------------------------------------------------
  // Tiles are sold ONLY in full boxes with a fixed coverage in m2.
  floor_30: { base: 'm2', sale: 'box', size: 1.53, usd: 8 },
  floor_45: { base: 'm2', sale: 'box', size: 1.62, usd: 10.5 },
  floor_60: { base: 'm2', sale: 'box', size: 1.44, usd: 13 },
  adhesive: { base: 'kg', sale: 'bag', size: 25, usd: 7.5 },
  grout: { base: 'kg', sale: 'bag', size: 5, usd: 6.5 },

  // ---- paints / finishes ------------------------------------------------------
  // Paint: gallon (3.785 L) and 5-gallon bucket / tineta (18.925 L). Need is measured in litres.
  paint: { base: 'l', sale: 'gallon', size: 3.785, usd: 17, bulk: 'paint_bucket' },
  paint_bucket: { base: 'l', sale: 'bucket', size: 18.925, usd: 62 },
  primer: { base: 'l', sale: 'gallon', size: 3.785, usd: 14 },
  putty: { base: 'kg', sale: 'bucket', size: 20, usd: 11 },
});

export const MATERIAL_IDS = Object.freeze(Object.keys(CATALOG));
