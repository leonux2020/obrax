// Pure model of the project workspace (ProjectWorkspace.jsx): everything the screen decides, with no React, so it can be
// unit-tested in Node. The screen only draws what these functions return.

import { LEVEL_COLOR } from '../components/levelStyle.js';
import { MAX_PRICE } from './pricing.js';
import { dayDiff, isClosed, parseDay, projectLevel } from './projects.js';
import { parseISODay, spanDays } from './schedule.js';
import { CREW_LIMIT, LEDGER_LIMITS, newEntryId, normalizeAdvances, normalizeCrew } from './ledger.js';
import { DEFAULT_MACHINERY, MACHINE_IDS } from './machinery.js';
import { savedMeta } from './priceBook.js';
import { aiRetailer } from './suppliers.js';
import { getRegion } from './regions.js';

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
 * The PROJECT's market (country / currency / retailers) ONLY, independent of the UI language: the quote is priced and
 * the AI searches in `code`'s country. What belonged to the old market is dropped (prices typed for this project, the
 * chosen chain, a tax typed by hand); measures, crew, schedule and the rest stay. Refuses (SAME draft) while the quote is
 * locked, for an unknown country or when nothing changes. Amounts already in payments / expenses / advances are NOT converted.
 */
export function withMarket(draft, code) {
  if (quoteLock(draft) || !getRegion(code) || code === draft.regionCode) return draft;
  return { ...draft, regionCode: code, chainId: 'best', overrides: {}, finance: { ...draft.finance, tax: null } };
}

/**
 * What a change of market would actually touch in this project: the prices typed by hand and a tax typed by hand (both are dropped), and the money
 * already booked in payments / expenses / advances (kept, but NOT converted to the new currency). `affected` is false for an empty project: then
 * there is nothing to warn about.
 */
export function marketChangeImpact(project) {
  const d = project?.draft ?? {};
  const prices = Object.keys(d.overrides ?? {}).length > 0;
  const tax = d.finance?.tax !== null && d.finance?.tax !== undefined;
  const booked = [project?.payments, project?.expenses, project?.advances].some((l) => Array.isArray(l) && l.length > 0);
  return { prices, tax, booked, affected: prices || tax || booked };
}

/**
 * The small line under a price: WHO says so. The supplier the user named ("Ferretería Don Pepe · 3 km"), the AI estimate
 * attributed to the market's reference retailer ("Estimación IA (Sodimac)") or the bundled reference price. '' when the
 * user's own price has no supplier.
 */
export function priceCaption(t, { origin, meta = null, regionCode }) {
  if (origin === 'user') {
    if (!meta?.supplierName) return '';
    return meta.nearby && meta.distanceKm !== undefined ? t('ws.supplier.near', { name: meta.supplierName, km: String(meta.distanceKm) }) : meta.supplierName;
  }
  if (origin === 'ai') return t('ws.supplier.ai', { retailer: aiRetailer(regionCode) });
  return t('ws.supplier.base');
}

/** Machinery master switch / switched-off machines. Locked quote: the same draft. */
export const withMachinery = (draft, patch) => (quoteLock(draft) ? draft : { ...draft, machinery: { ...(draft.machinery ?? DEFAULT_MACHINERY), ...patch } });

/** Machines left switched on / off: `excluded` stays a stable, de-duplicated list of known ids. */
export const toggleMachine = (excluded = [], id, on) => {
  const ex = new Set(excluded);
  if (on) ex.delete(id);
  else ex.add(id);
  return MACHINE_IDS.filter((x) => ex.has(x));
};

/**
 * One machine switched on / off from the task that uses it. The switch-off list is per machine TYPE (like its daily rate), so it
 * applies to every task that needs that machine. Switching a machine ON while the master switch is off turns machinery back on
 * with ONLY that machine active (everything else stays off, exactly as it was). Locked quote: the same draft.
 */
export function setMachineOn(draft, id, on) {
  const config = draft.machinery ?? DEFAULT_MACHINERY;
  if (on && config.include === false) return withMachinery(draft, { include: true, excluded: MACHINE_IDS.filter((x) => x !== id) });
  return withMachinery(draft, { excluded: toggleMachine(config.excluded, id, on) });
}

/** The machines the engine assigned to ONE partida (by index), each with its rate row (rate, source, supplier). */
export function partidaMachines(result, index, regionCode = null) {
  const rows = rentRows(result, regionCode);
  return (result?.machinery?.items ?? [])
    .filter((i) => i.partida === index)
    .map((i) => ({ ...i, row: rows.find((r) => r.id === i.id) ?? null }));
}

// ---- the schedule is manual: two dates and the days between them ---------------------------------------------------------------
const validDay = (v) => v === '' || Boolean(parseISODay(v));

/**
 * The job's two dates, typed by the user ("Data di inizio" / "Data di consegna"). `patch` = { startDate?, endDate? } with ISO days or ''.
 * Moving the start past the end drags the end to the same day; an end before the start is refused; junk changes nothing (the SAME
 * project comes back). The dates set the days of the machinery rental (a direct cost), so they are part of the quote: while it is
 * frozen / signed the SAME project comes back (read-only), like every other editor of the budget.
 */
export function withProjectDates(project, patch) {
  if (quoteLock(project.draft)) return project;
  const startGiven = typeof patch?.startDate === 'string';
  let start = startGiven ? patch.startDate : project.startDate;
  let end = typeof patch?.endDate === 'string' ? patch.endDate : project.endDate;
  if (!validDay(start) || !validDay(end)) return project;
  if (start && end && parseISODay(end) < parseISODay(start)) {
    if (!startGiven) return project;
    end = start;
  }
  return start === project.startDate && end === project.endDate ? project : { ...project, startDate: start, endDate: end };
}

/** Calendar days between the two dates (delivery - start, so same day = 0), or null while one of them is missing. Pure subtraction, no estimate. */
export const calendarDays = (project) => spanDays(project?.startDate, project?.endDate);

// ---- the crew: named people, and the cash advanced to each one ---------------------------------------------------------------------
const cleanWorker = (w) => normalizeCrew([w])[0] ?? null;

/** Adds a person to `project.crew` (name required). Returns the SAME project when it is refused (no name, or the crew is full). */
export function withWorker(project, data) {
  const crew = project.crew ?? [];
  const w = cleanWorker({ ...data, id: newEntryId() });
  return w && crew.length < CREW_LIMIT ? { ...project, crew: [...crew, w] } : project;
}

/** Edits a person (name / specialty / notes). Their advances stay linked: the link is the id, not the name. */
export function withWorkerEdited(project, id, data) {
  const crew = project.crew ?? [];
  const w = cleanWorker({ ...data, id });
  return w && crew.some((x) => x.id === id) ? { ...project, crew: crew.map((x) => (x.id === id ? w : x)) } : project;
}

/** Removes a person. The money already handed over is NOT erased: their advances stay in the cash book, unassigned. */
export const withoutWorker = (project, id) => ((project.crew ?? []).some((x) => x.id === id) ? { ...project, crew: project.crew.filter((x) => x.id !== id) } : project);

/** Gives `amount` to a person of the crew: a new advance linked by `workerId` (the name is stored too, as a snapshot). */
export function withAdvance(project, workerId, amount, now = Date.now()) {
  const w = (project.crew ?? []).find((x) => x.id === workerId);
  const [adv] = w ? normalizeAdvances([{ id: newEntryId(), worker: w.name, workerId, amount, at: now }]) : [];
  return adv && (project.advances ?? []).length < LEDGER_LIMITS.advances ? { ...project, advances: [adv, ...project.advances] } : project;
}

export const withoutAdvance = (project, id) => ({ ...project, advances: (project.advances ?? []).filter((a) => a.id !== id) });

/** One editable daily rate per machine type the quote uses (a scaffold in two partidas is a single rate). */
export function rentRows(result, regionCode = null) {
  const items = result?.machinery?.items ?? [];
  return MACHINE_IDS.map((id) => {
    const lines = items.filter((i) => i.id === id);
    return lines.length ? { id, lines, rate: lines[0].rate, source: lines[0].source, supplier: lines[0].source === 'saved' ? savedMeta(result.book, regionCode, 'rent', id) ?? null : null, total: lines.reduce((sum, i) => sum + i.total, 0), included: lines.every((i) => i.included) } : null;
  }).filter(Boolean);
}

// ---- zone B: the living list ---------------------------------------------------------------------------------------------
/** Where a unit price comes from, for the small badge: the user's own, the live AI answer or the bundled base catalog. */
export const priceOrigin = (source) => (source === 'manual' || source === 'saved' ? 'user' : source === 'ai' ? 'ai' : 'base');

/**
 * Where the price a quote used for a material comes from, when it is the user's own price AT a supplier. This project's own
 * price (typed here) counts too, as long as it is the number the supplier entry holds (they are saved together).
 */
function supplierOf(result, regionCode, id) {
  const used = result.prices?.[id];
  if (!used || (used.source !== 'saved' && used.source !== 'manual')) return null;
  const meta = savedMeta(result.book, regionCode, 'materials', id);
  if (!meta) return null;
  return used.source === 'saved' || Math.abs(Number(result.book?.user?.materials?.[id]) - used.price) < 0.005 ? meta : null;
}

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
        supplier: supplierOf(result, draft.regionCode, it.id),
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
 * Everything the sticky header shows. `cash` comes from cashSummary(); `total` from the live quote; `liquid` is the real cash
 * on hand (ledger.liquidity: payments - expenses - worker advances) and rides on the Caja bar.
 * Bars: Plazo (time elapsed of the schedule) and Caja (paid of the budget). A bar with `pct: null` is not drawn.
 */
export function headerModel({ project, total, valid, cash, liquid = 0, now = Date.now() }) {
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
      { id: 'cash', pct: valid && cash ? cash.pct : null, tone: cash?.overpaid ? '#e8c35f' : '#22c55e', paid: cash?.paid ?? 0, pending: cash?.pending ?? 0, liquid: Number.isFinite(liquid) ? liquid : 0 },
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
