// Granular, SYMMETRIC merge of two versions of the same data (this device and the Drive backup).
//
// The old rule ("the project with the newest updatedAt wins as a whole") let a stale tablet crush what the phone had just
// written, and the other way round: two devices that each added an expense to the same project lost one of them. Here the merge goes
// down to the records:
//   - projects: by id; a project that exists on one side only is kept (unless a tombstone says it was deleted afterwards)
//   - inside a project: payments, advances, expenses, crew and logbook entries are merged BY ID. A record on one side only is added;
//     on both sides, the one with the newest `updatedAt` wins; a tombstone newer than the record deletes it
//   - the rest of the project (quote draft, dates, location...) comes from the side whose project was updated last
// SYMMETRIC means merge(a, b) and merge(b, a) hold the same data (every tie is broken by the content, never by "which one is local"):
// two devices that merge each other's answer converge instead of overwriting each other forever.

import { mergeTomb, normalizeTomb } from './tombstones.js';
import { MAX_PHOTOS } from './photos.js';
import { mergeCapsule } from './capsule.js';
import { syncDates } from './phases.js';

export const RECORD_COLLECTIONS = Object.freeze(['payments', 'advances', 'discounts', 'expenses', 'crew', 'logbook', 'phases']);
/** The money vectors: cobros (payments), anticipos (advances) and gastos (expenses). Their `amount` is forced to a real number on every merge. */
export const FINANCIAL_COLLECTIONS = Object.freeze(['payments', 'advances', 'discounts', 'expenses']);

/** A top-level list of records with ids (the known collections, or any future one such as invoices): merged BY ID like the rest. */
const isRecordList = (key, value) =>
  Array.isArray(value) && (RECORD_COLLECTIONS.includes(key) || (key !== 'draft' && value.length > 0 && value.every((r) => r && typeof r === 'object' && typeof r.id === 'string')));

/** A finite number from a number or a numeric string ("1250,50"); null when it is neither. */
const numeric = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'string' ? Number(v.trim().replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The fields of the FX snapshot of an expense (fx.js): frozen together, once, when a foreign receipt is converted to the project's base currency. */
export const FX_FIELDS = Object.freeze(['currencyOriginal', 'amountOriginal', 'exchangeRate', 'amountBase', 'fxSource', 'fxAt']);
const FX_NUMBERS = ['amountOriginal', 'exchangeRate', 'amountBase', 'fxAt'];

/** An expense with a snapshot: its numeric FX fields are real numbers and `amountBase` exists (original x rate when missing). Otherwise null. */
function fxOf(record) {
  if (!record || typeof record !== 'object' || typeof record.currencyOriginal !== 'string' || !record.currencyOriginal.trim()) return null;
  const original = numeric(record.amountOriginal);
  const rate = numeric(record.exchangeRate);
  if (original === null || rate === null || rate <= 0) return null;
  let base = numeric(record.amountBase);
  if (base === null) base = Math.round(original * rate * 100) / 100;
  const at = numeric(record.fxAt);
  return { currencyOriginal: record.currencyOriginal.trim().toUpperCase(), amountOriginal: original, exchangeRate: rate, amountBase: base, ...(typeof record.fxSource === 'string' ? { fxSource: record.fxSource } : {}), ...(at !== null && at > 0 ? { fxAt: at } : {}) };
}

/** A financial record with its amount as a finite NUMBER ("1250,50" / "100" from a backup would otherwise concatenate: "100" + 20 = "10020"). */
function sanitizeAmount(record) {
  if (!record || typeof record !== 'object') return record;
  if (FX_FIELDS.some((k) => record[k] !== undefined)) {
    const fx = fxOf(record);
    if (fx) {
      // a foreign expense IS its frozen base value: the FX numbers are real numbers and `amount` follows `amountBase`
      const same = record.amount === fx.amountBase && FX_NUMBERS.every((k) => record[k] === undefined || record[k] === fx[k]);
      return same ? record : { ...record, ...fx, amount: fx.amountBase };
    }
  }
  if (typeof record.amount === 'number') return record;
  const raw = record.amount;
  const n = typeof raw === 'string' ? Number(raw.trim().replace(',', '.')) : Number(raw);
  return { ...record, amount: Number.isFinite(n) ? n : 0 };
}

/**
 * Two versions of ONE expense: the snapshot is IMMUTABLE. Whatever side's record wins the merge (the newest edit: returned, note...), it keeps
 * the frozen FX values; a winner without a snapshot gets the other side's one; two different snapshots resolve the same way on every device
 * (the first frozen = the oldest `fxAt`; then the content) so the devices converge instead of ping-ponging.
 */
function reconcileFx(pick, x, y) {
  if (!x || !y) return pick;
  const fx = fxOf(x);
  const fy = fxOf(y);
  if (!fx && !fy) return pick;
  let keep = fx || fy;
  if (fx && fy && canon(fx) !== canon(fy)) {
    const ax = fx.fxAt || Infinity;
    const ay = fy.fxAt || Infinity;
    keep = ax !== ay ? (ax < ay ? fx : fy) : canon(fx) <= canon(fy) ? fx : fy;
  }
  const own = fxOf(pick);
  if (own && canon(own) === canon(keep)) return pick;
  return { ...pick, ...keep, amount: keep.amountBase };
}
const RECORD_TOMB_LIMIT = 200;

/** Deterministic JSON: object keys sorted; the collections of a project are sorted by id (their order is not data). */
function canonical(value, sortLists) {
  if (Array.isArray(value)) return value.map((v) => canonical(v, sortLists));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      const v = value[k];
      out[k] = sortLists && isRecordList(k, v) ? [...v].map((r) => canonical(r, false)).sort((a, b) => String(a?.id).localeCompare(String(b?.id))) : canonical(v, false);
    }
    return out;
  }
  return value;
}
export const canon = (value) => JSON.stringify(canonical(value, true));
/** `canon` of a list of records whose order is not data (sorted by id). */
export const canonById = (list) => canon([...(list || [])].sort((a, b) => String(a?.id).localeCompare(String(b?.id))));
/** The `updatedAt` of an edit made now: always strictly newer than the project's own stamp, even when this device's clock is behind the one that wrote it. */
export const nextStamp = (prev, now = Date.now()) => Math.max(Number(now) || 0, (Number(prev) > 0 ? Number(prev) : 0) + 1);
const stampOf = (r) => (Number(r?.updatedAt) > 0 ? Number(r.updatedAt) : 0);
const projectStamp = (p) => (Number(p?.updatedAt) > 0 ? Number(p.updatedAt) : 0);

/** Which project is the base for the scalar fields: the newest updatedAt; a tie is broken by the content (the same on both devices). */
const preferFirst = (a, b) => {
  const sa = projectStamp(a);
  const sb = projectStamp(b);
  return sa !== sb ? sa > sb : canon(a) >= canon(b);
};

function mergeRecords(aList, bList, aFirst, tomb, reconcile = null) {
  const usable = (list) => (Array.isArray(list) ? list.filter((r) => r && typeof r === 'object' && r.id !== undefined && r.id !== null) : []);
  const A = usable(aList);
  const B = usable(bList);
  const bMap = new Map(B.map((r) => [r.id, r]));
  const aMap = new Map(A.map((r) => [r.id, r]));
  const lead = aFirst ? A : B;
  const follow = aFirst ? B : A;
  const out = [];
  const seen = new Set();
  for (const r of [...lead, ...follow]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const x = aMap.get(r.id);
    const y = bMap.get(r.id);
    let pick = x || y;
    if (x && y && canon(x) !== canon(y)) {
      const sx = stampOf(x);
      const sy = stampOf(y);
      // the newest change wins; with the same stamp (or none: older data) the side whose project is the base wins
      pick = sx !== sy ? (sx > sy ? x : y) : aFirst ? x : y;
      if (reconcile) pick = reconcile(pick, x, y);
    }
    if (tomb[pick.id] >= stampOf(pick) && tomb[pick.id] > 0) continue; // deleted after its last change
    out.push(pick);
  }
  return out;
}

/**
 * The quote draft, merged line by line. The budget lines are its `partidas` (chapters, each with an id): a partida that only one device
 * has is KEPT (device A adds "Pintura", device B adds "Cerámica": both survive), on both sides the newest `updatedAt` wins and a tombstone newer
 * than the partida deletes it. The prices / rentals / tax the quote was built with (the capsule) are merged entry by entry. Everything else
 * of the draft (finance %, chain, manual prices, machinery switches...) comes from the side whose project was updated last.
 */
function mergeDraft(a, b, aFirst, tomb) {
  const da = a?.draft;
  const db = b?.draft;
  if (!da || !db) return (aFirst ? da : db) || da || db;
  const base = aFirst ? da : db;
  let partidas = mergeRecords(da.partidas, db.partidas, aFirst, tomb);
  if (base.mode === 'quick') partidas = partidas.slice(0, 1); // a quick quote is ONE partida: the base's own
  const merged = { ...base, partidas };
  const capsule = mergeCapsule(da.capsule, db.capsule);
  if (capsule) merged.capsule = capsule;
  else delete merged.capsule;
  return merged;
}

/** Merge two versions of ONE project (same id). */
export function mergeProject(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aFirst = preferFirst(a, b);
  const base = aFirst ? a : b;
  const tomb = mergeTomb(a.tomb, b.tomb, RECORD_TOMB_LIMIT);
  const lists = {};
  // every record list of either side: the known collections plus any other list of records with ids (invoices, future ledgers...)
  const keys = new Set(RECORD_COLLECTIONS.filter((k) => k in a || k in b));
  for (const side of [a, b]) for (const [k, v] of Object.entries(side)) if (!keys.has(k) && isRecordList(k, v)) keys.add(k);
  for (const key of [...keys].sort()) {
    const clean = (list) => (FINANCIAL_COLLECTIONS.includes(key) && Array.isArray(list) ? list.map(sanitizeAmount) : list);
    lists[key] = mergeRecords(clean(a[key]), clean(b[key]), aFirst, tomb, key === 'expenses' ? reconcileFx : null);
    if (key === 'expenses') lists[key] = lists[key].map((e) => (e.projectId === base.id ? e : { ...e, projectId: base.id }));
  }
  const merged = { ...base, ...lists, draft: mergeDraft(a, b, aFirst, tomb), updatedAt: Math.max(projectStamp(a), projectStamp(b)) };
  delete merged.totals; // derived: recalculated from the merged data (recalculateProjectTotals), never carried over from one side
  if (Object.keys(tomb).length) merged.tomb = tomb;
  else delete merged.tomb;
  // photo deletions ({ slot: deletedAt }) are unioned like any tombstone: the newest deletion of each slot survives the merge
  const photoTomb = mergeTomb(a.photoTomb, b.photoTomb, MAX_PHOTOS);
  if (Object.keys(photoTomb).length) merged.photoTomb = photoTomb;
  else delete merged.photoTomb;
  return syncDates(merged); // the Cronograma was merged by phase: the project's dates follow the merged phases, on every device alike
}

/**
 * Merge two lists of projects by id and apply the project tombstones.
 * `finalize(project)` runs on every project that was merged with an incoming one, right after the merge and BEFORE the caller saves it
 * (the post-merge recalculation of the totals: recalculateProjectTotals).
 * @returns {{ projects: object[], removed: string[] }} `removed`: ids dropped because a newer deletion exists
 */
export function mergeProjectLists(local, incoming, tombs = {}, limit = 200, finalize = null) {
  const byId = new Map();
  for (const p of local || []) byId.set(p.id, p);
  for (const p of incoming || []) {
    const merged = mergeProject(byId.get(p.id), p);
    byId.set(p.id, finalize ? finalize(merged) : merged);
  }
  const removed = [];
  const projects = [];
  for (const p of byId.values()) {
    if (tombs[p.id] > 0 && tombs[p.id] >= projectStamp(p)) removed.push(p.id);
    else projects.push(p);
  }
  projects.sort((x, y) => projectStamp(y) - projectStamp(x) || String(x.id).localeCompare(String(y.id)));
  return { projects: projects.slice(0, limit), removed };
}

/** Marks what changed between two versions of a project: records created / modified get `updatedAt: now`, deleted ones go to `tomb`. Returns `next` itself when nothing changed. */
export function stampProject(prev, next, now = Date.now()) {
  if (!prev || prev === next) return next;
  let out = next;
  const tomb = { ...normalizeTomb(next.tomb, Infinity) };
  let tombChanged = false;
  for (const key of RECORD_COLLECTIONS) {
    const before = Array.isArray(prev[key]) ? prev[key] : [];
    const after = Array.isArray(next[key]) ? next[key] : [];
    if (before === after) continue;
    const beforeMap = new Map(before.map((r) => [r.id, r]));
    let touched = false;
    const stamped = after.map((r) => {
      const old = beforeMap.get(r.id);
      if (old === r) return r;
      if (old) {
        const { updatedAt: _a, ...oldBody } = old;
        const { updatedAt: _b, ...newBody } = r;
        if (canon(oldBody) === canon(newBody)) return r; // same content: not a change
      }
      touched = true;
      return { ...r, updatedAt: now };
    });
    const afterIds = new Set(after.map((r) => r.id));
    for (const r of before) {
      if (!afterIds.has(r.id)) {
        tomb[r.id] = now;
        tombChanged = true;
      }
    }
    if (touched) out = { ...out, [key]: stamped };
  }
  // the budget lines (draft.partidas) are records too: changed ones are stamped, deleted ones go to the tombstones
  const bp = Array.isArray(prev.draft?.partidas) ? prev.draft.partidas : null;
  const ap = Array.isArray(next.draft?.partidas) ? next.draft.partidas : null;
  if (bp && ap && bp !== ap) {
    const beforeMap = new Map(bp.map((r) => [r.id, r]));
    let touched = false;
    const stamped = ap.map((r) => {
      const old = beforeMap.get(r.id);
      if (old === r) return r;
      if (old) {
        const { updatedAt: _a, ...oldBody } = old;
        const { updatedAt: _b, ...newBody } = r;
        if (canon(oldBody) === canon(newBody)) return r;
      }
      touched = true;
      return { ...r, updatedAt: now };
    });
    const ids = new Set(ap.map((r) => r.id));
    for (const r of bp) {
      if (!ids.has(r.id)) {
        tomb[r.id] = now;
        tombChanged = true;
      }
    }
    if (touched) out = { ...out, draft: { ...out.draft, partidas: stamped } };
  }
  if (tombChanged) out = { ...out, tomb: normalizeTomb(tomb, RECORD_TOMB_LIMIT) };
  return out;
}

/** `stampProject` over a whole list (the projects the state already had). Unchanged projects keep their identity. */
export function stampProjects(prevList, nextList, now = Date.now()) {
  if (!Array.isArray(prevList) || !Array.isArray(nextList)) return nextList;
  const prev = new Map(prevList.map((p) => [p.id, p]));
  let changed = false;
  const out = nextList.map((p) => {
    const s = stampProject(prev.get(p.id), p, now);
    if (s !== p) changed = true;
    return s;
  });
  return changed ? out : nextList;
}

/**
 * DEEP, per-slot merge of the camera photos of ONE project (this device vs. the backup). The photos do not live inside the project record,
 * so the project's `updatedAt` says nothing about them: each slot is reconciled on its own.
 *   - a photo on ONE side only is kept (never lost because the other device is older / stale): the union of both devices;
 *   - on both sides with different content, the NEWEST capture (`at`) wins; a tie is broken by the content, so both devices pick the same;
 *   - `photoTomb` ({ slot: deletedAt }) remembers deletions: a photo captured before its slot was deleted is gone, one taken after stays.
 * @param local   fixed slots of this device (null = empty)
 * @param remote  fixed slots of the backup
 * @param photoTomb the merged tombstones of the project
 * @returns {{ slots: (object|null)[], fromRemote: object[], dropLocal: number[], localAhead: boolean }}
 *   `fromRemote`: photos to write on this device; `dropLocal`: slots to clear here (deleted elsewhere); `localAhead`: this device holds
 *   something the backup lacks (or has newer), so the merged result should go back up.
 */
export function mergePhotoSlots(local, remote, photoTomb = {}) {
  const tomb = normalizeTomb(photoTomb, Infinity);
  const slots = Array(MAX_PHOTOS).fill(null);
  const fromRemote = [];
  const dropLocal = [];
  let localAhead = false;
  const dead = (photo, slot) => Boolean(photo) && tomb[slot] > 0 && Number(photo.at || 0) <= tomb[slot];
  for (let slot = 0; slot < MAX_PHOTOS; slot += 1) {
    const l0 = Array.isArray(local) ? local[slot] || null : null;
    const r0 = Array.isArray(remote) ? remote[slot] || null : null;
    const l = dead(l0, slot) ? null : l0;
    const r = dead(r0, slot) ? null : r0;
    if (l0 && !l) dropLocal.push(slot); // deleted on another device after this one was taken
    if (l && r) {
      if (l.dataUrl === r.dataUrl) {
        // the same picture: only its caption can differ. The newest edit wins (equal times: the longer text, so both devices settle on the same one)
        const ld = l.description || '';
        const rd = r.description || '';
        if (ld === rd) slots[slot] = l;
        else {
          const lt = Number(l.descAt || 0);
          const rt = Number(r.descAt || 0);
          const remoteWins = rt !== lt ? rt > lt : rd > ld;
          slots[slot] = remoteWins ? r : l;
          if (remoteWins) fromRemote.push({ ...r, slot });
          else localAhead = true;
        }
      } else {
        const lt = Number(l.at || 0);
        const rt = Number(r.at || 0);
        const remoteWins = rt !== lt ? rt > lt : r.dataUrl > l.dataUrl;
        slots[slot] = remoteWins ? r : l;
        if (remoteWins) fromRemote.push({ ...r, slot });
        else localAhead = true;
      }
    } else if (r) {
      slots[slot] = r;
      fromRemote.push({ ...r, slot });
    } else if (l) {
      slots[slot] = l;
      localAhead = true; // the backup does not have it yet
    }
  }
  return { slots, fromRemote, dropLocal, localAhead };
}
