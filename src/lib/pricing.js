// Local material price SIMULATION engine.
// Reference price = USD base * regional fx * regional index * chain positioning
//                   * stable per-(chain,material) spread * slow "market drift" (15-min window).
// Deterministic (no network): identical inputs in the same 15-minute window always give identical prices.
// User manual corrections always win over the reference price.

import { CATALOG } from './catalog.js';
import { getRegion } from './regions.js';

export const MAX_PRICE = 1_000_000_000;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** deterministic pseudo-random in [-1, 1] */
const noise = (seed) => (fnv1a(seed) / 4294967295) * 2 - 1;

// 15-minute market window: prices drift slowly and identically for everyone within it
export const marketBucket = (now = Date.now()) => Math.floor(now / 900_000);

export function roundMoney(value, region) {
  const f = 10 ** region.digits;
  return Math.round(value * f) / f;
}

export function referencePrice(materialId, region, chain, bucket = marketBucket()) {
  const mat = CATALOG[materialId];
  const base = mat.usd * region.fx * region.priceFactor * chain.factor;
  const spread = 1 + noise(`${region.code}|${chain.id}|${materialId}`) * 0.06;
  const drift = 1 + noise(`${bucket}|${region.code}|${materialId}`) * 0.015;
  const price = roundMoney(base * spread * drift, region);
  return price > 0 ? price : 10 ** -region.digits;
}

/**
 * Resolve the effective unit price of each material.
 * chainId === 'best' => cheapest chain for every item.
 * @returns {Record<string,{price:number, ref:number, source:'ref'|'manual', chainId:string}>}
 */
export function resolvePrices({ ids, regionCode, chainId, overrides = {}, bucket = marketBucket() }) {
  const region = getRegion(regionCode);
  const out = {};
  for (const id of ids) {
    let chain;
    let ref;
    if (chainId === 'best' || !region.chains.some((c) => c.id === chainId)) {
      for (const c of region.chains) {
        const p = referencePrice(id, region, c, bucket);
        if (ref === undefined || p < ref) {
          ref = p;
          chain = c;
        }
      }
    } else {
      chain = region.chains.find((c) => c.id === chainId);
      ref = referencePrice(id, region, chain, bucket);
    }
    const manual = overrides[id];
    const hasManual = typeof manual === 'number' && manual > 0 && manual <= MAX_PRICE;
    out[id] = { price: hasManual ? manual : ref, ref, source: hasManual ? 'manual' : 'ref', chainId: chain.id };
  }
  return out;
}

const EPS = 1e-9;
const round4 = (n) => Math.round(n * 10000) / 10000;

/** Geometric need plus the waste allowance (still in base units, not yet rounded to sale units). */
export const withWaste = (qty, wastePct) => qty * (1 + wastePct / 100);

/**
 * Convert one takeoff line (geometric need in BASE units) into a real store purchase.
 *  - sale formats are indivisible => packs are rounded UP to a whole number
 *  - `cut` lines (steel profiles) pack cut pieces into stock lengths: several short pieces fit in one
 *    profile, and pieces longer than the profile need several profiles each
 *  - leftover = purchased - needed (with waste): reusable remnant, never negative
 */
export function planPurchase(line, wastePct) {
  const mat = CATALOG[line.id];
  const need = line.qty;
  let needWaste = withWaste(need, wastePct);
  let packs;

  if (line.cut && line.cut.length > 0) {
    const pieces = Math.ceil(withWaste(line.cut.count, wastePct) - EPS);
    const len = line.cut.length;
    needWaste = pieces * len;
    packs =
      len <= mat.size
        ? Math.ceil(pieces / Math.max(1, Math.floor(mat.size / len + EPS)) - EPS)
        : pieces * Math.ceil(len / mat.size - EPS);
  } else {
    packs = Math.ceil(needWaste / mat.size - EPS);
  }

  if (need > 0) packs = Math.max(1, packs);
  const purchased = round4(packs * mat.size);
  const leftover = Math.max(0, round4(purchased - needWaste));
  return {
    need: round4(need),
    needWaste: round4(needWaste),
    packs,
    purchased,
    leftover,
    leftoverPct: purchased > 0 ? leftover / purchased : 0,
  };
}

/** Build the full quote: purchase lines (whole sale units) + labor/transport/tax totals. */
export function buildQuote({ lines, prices, finance, regionCode }) {
  const region = getRegion(regionCode);
  const items = lines.map((l) => {
    const mat = CATALOG[l.id];
    const plan = planPurchase(l, finance.waste);
    const { price, ref, source, chainId } = prices[l.id];
    return {
      id: l.id,
      baseUnit: mat.base,
      saleUnit: mat.sale,
      saleSize: mat.size,
      ...plan,
      unitPrice: price, // per SALE unit
      refPrice: ref,
      source,
      chainId,
      total: roundMoney(plan.packs * price, region),
      leftoverValue: roundMoney((plan.leftover / mat.size) * price, region),
    };
  });
  const materials = roundMoney(items.reduce((s, i) => s + i.total, 0), region);
  const leftoverValue = roundMoney(items.reduce((s, i) => s + i.leftoverValue, 0), region);
  const labor = roundMoney((materials * finance.labor) / 100, region);
  const transport = roundMoney((materials * finance.transport) / 100, region);
  const subtotal = roundMoney(materials + labor + transport, region);
  const tax = roundMoney(subtotal * region.taxRate, region);
  const total = roundMoney(subtotal + tax, region);
  return { items, materials, leftoverValue, labor, transport, subtotal, tax, total, taxRate: region.taxRate };
}

/** Estimated materials total for each chain (for the comparison chips). */
export function chainTotals({ lines, regionCode, wastePct, overrides, bucket = marketBucket() }) {
  const region = getRegion(regionCode);
  const ids = lines.map((l) => l.id);
  const totalFor = (chainId) => {
    const prices = resolvePrices({ ids, regionCode, chainId, overrides, bucket });
    return buildQuote({
      lines,
      prices,
      finance: { waste: wastePct, labor: 0, transport: 0 },
      regionCode,
    }).materials;
  };
  const result = { best: totalFor('best') };
  for (const c of region.chains) result[c.id] = totalFor(c.id);
  return result;
}
