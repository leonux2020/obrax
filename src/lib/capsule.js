// The project's CAPSULE: the prices, rental rates and tax rate a quote was built with, frozen INSIDE the project JSON.
//
// Why: a total that is computed from the price book of THIS device, the supplier directory of THIS device and the 15-minute market clock of THIS
// moment is a different number on every device (a 9,899,487 here, a 8,554,781 there). The capsule makes the quote a pure function of the project:
// when a material, a machine or the tax joins the quote its value is copied here (hard copy), and from then on the engine reads ONLY the capsule.
//
//   draft.capsule = {
//     v: 1,
//     tax:    { rate: 0.19, at },                                       // the tax rate (a custom rate typed in the project, where editable, wins)
//     prices: { [chainKey]: { [materialId]: { p, r, s, c, at } } },     // p unit price per SALE unit, r reference, s source, c chain, at = when
//     rents:  { [machineId]: { p, s, at, u? } },                        // daily rental rate (u = typed by the user in this project)
//   }
//
// Pure data: no engine, no registry, no I/O. Sealing (filling the gaps from the live prices) lives in projectTotals.js.
// The merge of two capsules is per ENTRY and SYMMETRIC: the newest `at` wins, a tie is broken by the content, so two devices converge.

import { MATERIAL_IDS } from './catalog.js';
import { MACHINE_IDS } from './machines.js';

export const CAPSULE_VERSION = 1;
const MAX_PRICE = 1_000_000_000;
const SOURCES = ['saved', 'ai', 'ref'];
const KEY_RE = /^[a-z0-9_-]{1,24}$/;

const price = (v) => {
  const n = typeof v === 'string' ? Number(v.trim().replace(',', '.')) : Number(v);
  return Number.isFinite(n) && n > 0 && n <= MAX_PRICE ? n : null;
};
const stamp = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);
const source = (v) => (SOURCES.includes(v) ? v : 'ref');

function cleanPrice(obj, chainKey) {
  const p = price(obj?.p);
  if (p === null) return null;
  const r = price(obj.r);
  return { p, ...(r !== null ? { r } : {}), s: source(obj.s), c: typeof obj.c === 'string' && KEY_RE.test(obj.c) ? obj.c : chainKey, at: stamp(obj.at) };
}
function cleanRent(obj) {
  const p = price(obj?.p);
  if (p === null) return null;
  return { p, s: source(obj.s), at: stamp(obj.at), ...(obj.u === true ? { u: true } : {}) };
}

/** Validate an untrusted stored capsule. Returns a clean capsule, or null when it holds nothing. */
export function normalizeCapsule(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const prices = {};
  if (obj.prices && typeof obj.prices === 'object') {
    for (const [chainKey, byId] of Object.entries(obj.prices)) {
      if (!KEY_RE.test(chainKey) || !byId || typeof byId !== 'object') continue;
      const clean = {};
      for (const id of MATERIAL_IDS) {
        const e = Object.prototype.hasOwnProperty.call(byId, id) ? cleanPrice(byId[id], chainKey) : null;
        if (e) clean[id] = e;
      }
      if (Object.keys(clean).length) prices[chainKey] = clean;
    }
  }
  const rents = {};
  if (obj.rents && typeof obj.rents === 'object') {
    for (const id of MACHINE_IDS) {
      const e = Object.prototype.hasOwnProperty.call(obj.rents, id) ? cleanRent(obj.rents[id]) : null;
      if (e) rents[id] = e;
    }
  }
  const rate = Number(obj.tax?.rate);
  const tax = obj.tax && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? { rate, at: stamp(obj.tax.at) } : null;
  if (!tax && !Object.keys(prices).length && !Object.keys(rents).length) return null;
  return { v: CAPSULE_VERSION, ...(tax ? { tax } : {}), prices, rents };
}

const canonical = (v) => JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]])) : val));

/** The entry that survives when both devices have one: the newest `at`; the same `at` is decided by the content (same answer on both devices). */
function better(x, y) {
  if (!x) return y;
  if (!y) return x;
  const ax = stamp(x.at);
  const ay = stamp(y.at);
  if (ax !== ay) return ax > ay ? x : y;
  return canonical(x) >= canonical(y) ? x : y;
}

/** Entry-by-entry union of two capsules (either may be missing). Symmetric: mergeCapsule(a, b) holds the same data as mergeCapsule(b, a). */
export function mergeCapsule(a, b) {
  const A = normalizeCapsule(a);
  const B = normalizeCapsule(b);
  if (!A || !B) return A || B || null;
  const prices = {};
  for (const chainKey of [...new Set([...Object.keys(A.prices), ...Object.keys(B.prices)])].sort()) {
    prices[chainKey] = {};
    for (const id of [...new Set([...Object.keys(A.prices[chainKey] || {}), ...Object.keys(B.prices[chainKey] || {})])].sort()) prices[chainKey][id] = better(A.prices[chainKey]?.[id], B.prices[chainKey]?.[id]);
  }
  const rents = {};
  for (const id of [...new Set([...Object.keys(A.rents), ...Object.keys(B.rents)])].sort()) rents[id] = better(A.rents[id], B.rents[id]);
  const tax = better(A.tax, B.tax);
  return { v: CAPSULE_VERSION, ...(tax ? { tax } : {}), prices, rents };
}

/** The user typed a daily rental rate for a machine in THIS project (null removes it: the next sealing takes the current one). */
export function withCapsuleRent(draft, id, rate, now = Date.now()) {
  if (!MACHINE_IDS.includes(id)) return draft;
  const cap = normalizeCapsule(draft.capsule) || { v: CAPSULE_VERSION, prices: {}, rents: {} };
  const rents = { ...cap.rents };
  const p = price(rate);
  if (p === null) delete rents[id];
  else rents[id] = { p, s: 'saved', at: stamp(now) || 1, u: true };
  return { ...draft, capsule: normalizeCapsule({ ...cap, rents }) };
}

/**
 * "Update prices": forget the prices of the market the capsule took (materials, and the rentals nobody typed). What the user typed in the project
 * (its manual prices live in `overrides`; its rentals carry `u`) and the tax stay. A signed / frozen quote never reprices.
 */
export function releaseCapsule(draft) {
  if (draft.signature || draft.frozen || !draft.capsule) return draft;
  const rents = Object.fromEntries(Object.entries(draft.capsule.rents || {}).filter(([, e]) => e.u));
  return { ...draft, capsule: normalizeCapsule({ ...draft.capsule, prices: {}, rents }) };
}

/** Totals cached inside the project (derived: recalculated after every merge). */
export function normalizeTotals(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const total = num(obj.total);
  const paid = num(obj.paid) ?? 0;
  const pending = num(obj.pending);
  const expensesTotal = num(obj.expensesTotal) ?? 0;
  return { total, paid, pending, expensesTotal };
}
