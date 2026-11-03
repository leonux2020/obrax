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

export const RECORD_COLLECTIONS = Object.freeze(['payments', 'advances', 'expenses', 'crew', 'logbook']);
const RECORD_TOMB_LIMIT = 200;

/** Deterministic JSON: object keys sorted; the collections of a project are sorted by id (their order is not data). */
function canonical(value, sortLists) {
  if (Array.isArray(value)) return value.map((v) => canonical(v, sortLists));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      const v = value[k];
      out[k] = sortLists && RECORD_COLLECTIONS.includes(k) && Array.isArray(v) ? [...v].map((r) => canonical(r, false)).sort((a, b) => String(a?.id).localeCompare(String(b?.id))) : canonical(v, false);
    }
    return out;
  }
  return value;
}
export const canon = (value) => JSON.stringify(canonical(value, true));
/** `canon` of a list of records whose order is not data (sorted by id). */
export const canonById = (list) => canon([...(list || [])].sort((a, b) => String(a?.id).localeCompare(String(b?.id))));
const stampOf = (r) => (Number(r?.updatedAt) > 0 ? Number(r.updatedAt) : 0);
const projectStamp = (p) => (Number(p?.updatedAt) > 0 ? Number(p.updatedAt) : 0);

/** Which project is the base for the scalar fields: the newest updatedAt; a tie is broken by the content (the same on both devices). */
const preferFirst = (a, b) => {
  const sa = projectStamp(a);
  const sb = projectStamp(b);
  return sa !== sb ? sa > sb : canon(a) >= canon(b);
};

function mergeRecords(aList, bList, aFirst, tomb) {
  const A = Array.isArray(aList) ? aList : [];
  const B = Array.isArray(bList) ? bList : [];
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
    }
    if (tomb[pick.id] >= stampOf(pick) && tomb[pick.id] > 0) continue; // deleted after its last change
    out.push(pick);
  }
  return out;
}

/** Merge two versions of ONE project (same id). */
export function mergeProject(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aFirst = preferFirst(a, b);
  const base = aFirst ? a : b;
  const tomb = mergeTomb(a.tomb, b.tomb, RECORD_TOMB_LIMIT);
  const lists = {};
  for (const key of RECORD_COLLECTIONS) {
    if (!(key in a) && !(key in b)) continue;
    lists[key] = mergeRecords(a[key], b[key], aFirst, tomb);
    if (key === 'expenses') lists[key] = lists[key].map((e) => (e.projectId === base.id ? e : { ...e, projectId: base.id }));
  }
  const merged = { ...base, ...lists, updatedAt: Math.max(projectStamp(a), projectStamp(b)) };
  if (Object.keys(tomb).length) merged.tomb = tomb;
  else delete merged.tomb;
  return merged;
}

/**
 * Merge two lists of projects by id and apply the project tombstones.
 * @returns {{ projects: object[], removed: string[] }} `removed`: ids dropped because a newer deletion exists
 */
export function mergeProjectLists(local, incoming, tombs = {}, limit = 200) {
  const byId = new Map();
  for (const p of local || []) byId.set(p.id, p);
  for (const p of incoming || []) byId.set(p.id, mergeProject(byId.get(p.id), p));
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
