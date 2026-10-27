// Pure model of the project workspace (ProjectWorkspace.jsx): everything the screen decides, with no React, so it can be
// unit-tested in Node. The screen only draws what these functions return.

import { LEVEL_COLOR } from '../components/levelStyle.js';
import { MAX_PRICE } from './pricing.js';
import { dayDiff, isClosed, parseDay, projectLevel } from './projects.js';
import { clampCrew, parseISODay, toISODay } from './schedule.js';
import { DEFAULT_MACHINERY, MACHINE_IDS } from './machinery.js';

// ---- state of the job: the four-colour traffic light ---------------------------------------------------------------
/** Blue = not started, green = on time, orange = close to the limit, red = overdue; grey = finished (Historial). */
export const STATE_TONE = Object.freeze({ future: LEVEL_COLOR.future, green: LEVEL_COLOR.green, orange: LEVEL_COLOR.orange, red: LEVEL_COLOR.red, closed: LEVEL_COLOR.closed });

export function workspaceState(project, now = Date.now()) {
  const info = projectLevel(project, now);
  const closed = isClosed(project);
  const level = closed ? 'closed' : info.level;
  return { level, tone: STATE_TONE[level], info, closed };
}

/** Time bar: how much of the schedule has gone by. `pct` = null when the job has no usable start + end dates. */
export function timeProgress(project, now = Date.now()) {
  const start = parseDay(project.startDate);
  const end = parseDay(project.endDate);
  if (!start || !end || end < start) return { pct: null, elapsed: 0, total: 0 };
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const total = Math.max(1, dayDiff(start, end));
  const elapsed = Math.min(total, Math.max(0, dayDiff(start, today)));
  return { pct: (elapsed / total) * 100, elapsed, total };
}

// ---- the lock: a quote that has been sent or signed keeps its prices -------------------------------------------------
/** null (open) | 'frozen' ("Generar PDF" froze it) | 'signed' (the client signed it). Signed wins. */
export const quoteLock = (draft) => (draft?.signature ? 'signed' : draft?.frozen ? 'frozen' : null);

/**
 * Release the prices: drops the freeze AND the client's signature (a signature only vouches for the quote it was given
 * on). Everything else of the draft stays. The UI asks for confirmation before calling it.
 */
export const unlockQuote = (draft) => (quoteLock(draft) ? { ...draft, frozen: null, signature: null } : draft);

/**
 * This project's price for one material (per SALE unit). Refuses (returns the SAME draft) while the quote is locked, or
 * for an unusable value; `null` removes the project's own price (back to the book / base catalog).
 */
export function withPriceOverride(draft, id, price) {
  if (quoteLock(draft)) return draft;
  const overrides = { ...draft.overrides };
  if (typeof price === 'number' && price > 0 && price <= MAX_PRICE) overrides[id] = price;
  else if (price === null) delete overrides[id];
  else return draft;
  return { ...draft, overrides };
}

/**
 * Crew size typed on the pad: manual mode from then on. Same contract as withPriceOverride: while the quote is locked the
 * SAME draft comes back (read-only), because the crew sets the days of the machinery rental and so the total.
 */
export const withCrew = (draft, n) => (quoteLock(draft) || !(Number(n) >= 1) ? draft : { ...draft, crew: clampCrew(n), crewAuto: false });

/** Back to the automatic crew (the smallest one that fits the project's deadline). */
export const withCrewAuto = (draft) => (quoteLock(draft) || draft.crewAuto !== false ? draft : { ...draft, crewAuto: true });

/** Machinery master switch / switched-off machines. Locked quote: the same draft. */
export const withMachinery = (draft, patch) => (quoteLock(draft) ? draft : { ...draft, machinery: { ...(draft.machinery ?? DEFAULT_MACHINERY), ...patch } });

/** Machines left switched on / off: `excluded` stays a stable, de-duplicated list of known ids. */
export const toggleMachine = (excluded = [], id, on) => {
  const ex = new Set(excluded);
  if (on) ex.delete(id);
  else ex.add(id);
  return MACHINE_IDS.filter((x) => ex.has(x));
};

export const DEADLINE_MAX_DAYS = 3650;

/**
 * The job's deadline typed in days: the end date becomes start + (days - 1) (both ends count, as the planner does). A job
 * with no start date starts today. Returns the SAME project while the quote is locked or for an unusable number.
 */
export function withDeadlineDays(project, days, now = Date.now()) {
  const n = Math.round(Number(days));
  if (quoteLock(project.draft) || !(n >= 1 && n <= DEADLINE_MAX_DAYS)) return project;
  const t = new Date(now);
  const start = parseISODay(project.startDate) ?? new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + n - 1);
  return { ...project, startDate: toISODay(start), endDate: toISODay(end) };
}

/** What the crew block draws, or null while there is no plan (no valid partida with labour). */
export function crewModel(result) {
  const s = result?.valid ? result.schedule : null;
  if (!s || !(s.totals.hh > 0)) return null;
  return {
    crew: clampCrew(s.crew),
    auto: Boolean(s.plan.auto && s.plan.hasDeadline), // the crew follows the deadline
    canAuto: s.plan.hasDeadline && !s.plan.auto, // manual crew + a deadline: offer "back to automatic"
    plan: s.plan,
    totals: s.totals,
    hoursPerDay: s.hoursPerDay,
    rows: s.rows.filter((r) => r.hh > 0),
  };
}

/** One editable daily rate per machine type the quote uses (a scaffold in two partidas is a single rate). */
export function rentRows(result) {
  const items = result?.machinery?.items ?? [];
  return MACHINE_IDS.map((id) => {
    const lines = items.filter((i) => i.id === id);
    return lines.length ? { id, lines, rate: lines[0].rate, source: lines[0].source, total: lines.reduce((sum, i) => sum + i.total, 0), included: lines.every((i) => i.included) } : null;
  }).filter(Boolean);
}

// ---- zone B: the living list ---------------------------------------------------------------------------------------------
/** Where a unit price comes from, for the small badge: the user's own, the live AI answer or the bundled base catalog. */
export const priceOrigin = (source) => (source === 'manual' || source === 'saved' ? 'user' : source === 'ai' ? 'ai' : 'base');

/**
 * Partidas of a computed quote, each with its money and the material lines it consumes.
 * A material shared by several partidas appears in each with ITS share of the line (`shared: true` = one price, many partidas).
 * Works with an incomplete quote too (`result.valid === false`): the partida is listed and flagged `incomplete`.
 */
export function partidaGroups(result, draft) {
  const totals = result?.quote?.partidas ?? [];
  const items = result?.quote?.items ?? [];
  const list = result?.partidas ?? draft.partidas.map((p) => ({ id: p.id, name: p.name, task: p.task, validation: { valid: false } }));
  return list.map((p, index) => {
    const rows = [];
    for (const it of items) {
      const f = it.shares?.[index];
      if (!(f > 0)) continue;
      rows.push({
        id: it.id,
        packs: it.packs * f,
        saleUnit: it.saleUnit,
        unitPrice: it.unitPrice,
        total: it.total * f,
        shared: Object.keys(it.shares).length > 1,
        origin: priceOrigin(result.prices?.[it.id]?.source),
      });
    }
    return {
      index,
      id: p.id,
      task: p.task,
      name: p.name,
      incomplete: !p.validation?.valid,
      validation: p.validation,
      materials: totals[index]?.materials ?? 0,
      amount: totals[index]?.amount ?? 0,
      rows,
    };
  });
}

// ---- zone A: the header that never leaves -----------------------------------------------------------------------------------
/**
 * Everything the sticky header shows. `cash` comes from cashSummary(); `total` from the live quote.
 * Bars: Plazo (time elapsed of the schedule) and Caja (paid of the budget). A bar with `pct: null` is not drawn.
 */
export function headerModel({ project, total, valid, cash, now = Date.now() }) {
  const st = workspaceState(project, now);
  const time = timeProgress(project, now);
  return {
    level: st.level,
    tone: st.tone,
    info: st.info,
    closed: st.closed,
    locked: quoteLock(project.draft),
    total: valid ? total : null,
    bars: [
      { id: 'time', pct: time.pct, tone: st.tone, elapsed: time.elapsed, of: time.total },
      { id: 'cash', pct: valid && cash ? cash.pct : null, tone: cash?.overpaid ? '#e8c35f' : '#22c55e', paid: cash?.paid ?? 0, pending: cash?.pending ?? 0 },
    ],
  };
}

// ---- screen state (what is open) ---------------------------------------------------------------------------------------------
export const SHEETS = Object.freeze(['log', 'camera', 'scan', 'export', 'cash', 'unlock', 'sign']);

export const initialWorkspaceState = () => ({ open: {}, pad: null, sheet: null });

/** Reducer of the screen: accordions, the open numpad target and the open bottom sheet. Pure. */
export function workspaceReducer(state, action) {
  switch (action.type) {
    case 'toggle':
      return { ...state, open: { ...state.open, [action.id]: action.open ?? !state.open[action.id] } };
    case 'openPad':
      return { ...state, pad: { kind: action.kind, id: action.id }, sheet: null };
    case 'closePad':
      return state.pad ? { ...state, pad: null } : state;
    case 'sheet':
      return SHEETS.includes(action.name) ? { ...state, sheet: action.name, pad: null } : { ...state, sheet: null };
    case 'closeSheet':
      return state.sheet ? { ...state, sheet: null } : state;
    default:
      return state;
  }
}
