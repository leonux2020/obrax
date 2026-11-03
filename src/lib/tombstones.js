// Tombstones: "this record was deleted at <time>". Without them a union merge between two devices would bring back everything one of them
// deleted (the other still has it). A tombstone is { [id]: deletedAt }; the merge keeps the newest time per id and a record is dead when
// its own last change is not newer than the tombstone. They are small, capped, and travel inside the Drive backup.
//
//   device level (localStorage `cp.tomb.v1`): { projects: {id: ts}, workers: {id: ts} }
//   project level (`project.tomb`): ids of its payments / advances / expenses / crew / logbook entries

export const TOMB_KEY = 'cp.tomb.v1';
export const TOMB_LIMIT = 300;
const ID_RE = /^[a-z0-9]{1,24}$/;

/** { id: ts } with valid ids and positive times only, the newest TOMB_LIMIT kept. */
export function normalizeTomb(raw, limit = TOMB_LIMIT) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const rows = [];
  for (const [id, ts] of Object.entries(raw)) {
    const n = Number(ts);
    if (ID_RE.test(id) && Number.isFinite(n) && n > 0) rows.push([id, n]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(rows.slice(0, limit));
}

/** Union of two tombstone maps: the newest deletion time of each id. */
export function mergeTomb(a, b, limit = TOMB_LIMIT) {
  const out = { ...normalizeTomb(a, Infinity) };
  for (const [id, ts] of Object.entries(normalizeTomb(b, Infinity))) if (!(out[id] >= ts)) out[id] = ts;
  return normalizeTomb(out, limit);
}

export const normalizeTombs = (raw) => ({ projects: normalizeTomb(raw?.projects), workers: normalizeTomb(raw?.workers) });
export const hasTombs = (t) => Boolean(t) && (Object.keys(t.projects || {}).length > 0 || Object.keys(t.workers || {}).length > 0);
export const mergeTombs = (a, b) => ({ projects: mergeTomb(a?.projects, b?.projects), workers: mergeTomb(a?.workers, b?.workers) });

export function loadTombs() {
  try {
    const raw = window.localStorage.getItem(TOMB_KEY);
    return normalizeTombs(raw && raw.length < 200_000 ? JSON.parse(raw) : null);
  } catch {
    return normalizeTombs(null);
  }
}

export function saveTombs(tombs) {
  const clean = normalizeTombs(tombs);
  try {
    if (hasTombs(clean)) window.localStorage.setItem(TOMB_KEY, JSON.stringify(clean));
    else window.localStorage.removeItem(TOMB_KEY);
  } catch {
    /* storage full / blocked: the in-memory merge still works for this session */
  }
  return clean;
}

/** The user deleted a project / worker: remember it so no other device brings it back. */
export function markDeleted(kind, id, now = Date.now()) {
  if (kind !== 'projects' && kind !== 'workers') return loadTombs();
  const current = loadTombs();
  return saveTombs({ ...current, [kind]: mergeTomb(current[kind], { [id]: now }) });
}
