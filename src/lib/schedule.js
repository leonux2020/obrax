// Crew planning (Phase 3). The engine separates, per partida, two different kinds of time:
//
//   HH  (horas-hombre)  ACTIVE labour: it depends only on the quantity of work. Adding workers does NOT change it.
//   dead technical time  curing / drying days with ZERO human effort: it depends only on the material.
//                        Adding workers does NOT change it either.
//
// Only the active part is spread over the crew:   activeDays = HH / (crew x hoursPerDay)
// and the site duration is   totalDays = sum(activeDays) + sum(deadDays)   (partidas run one after another).
//
// All rates below are planning ESTIMATES for typical residential work, not guarantees: they are constants
// in one place so they can be tuned. Pure functions only (unit-testable in Node).

export const SCHEDULE = Object.freeze({
  hoursPerDay: 8,
  defaultCrew: 3,
  minCrew: 1,
  maxCrew: 30,
  dayStep: 0.5, // active days are planned in half-day blocks
});

const r1 = (n) => Math.round(n * 10) / 10;
const metric = (calc, key) => calc?.metrics?.find((m) => m.key === key)?.value ?? 0;

/**
 * Active labour of one partida, in HH, split into named components (shown in the planning sheet).
 * @returns {{key: string, hh: number}[]}
 */
export function labourComponents(task, values, calc) {
  switch (task) {
    case 'slab':
      return [
        { key: 'prep', hh: metric(calc, 'area') * 0.35 }, // base, polyethylene, mesh, formwork edges
        { key: 'pour', hh: metric(calc, 'volume') * 4.5 }, // mixing, placing, vibrating, screeding, finishing
      ];
    case 'masonry':
      return [{ key: 'laying', hh: metric(calc, 'netArea') * 1.3 }];
    case 'drywall':
      return [
        { key: 'framing', hh: metric(calc, 'plateArea') * 0.45 }, // studs, tracks and boards
        { key: 'finishing', hh: metric(calc, 'netArea') * 0.35 }, // tape and joint compound
      ];
    case 'roof': {
      const roofArea = metric(calc, 'roofArea');
      const ridge = metric(calc, 'ridgeLength');
      const parts = [
        { key: 'structure', hh: roofArea * 0.45 }, // purlins
        { key: 'covering', hh: roofArea * (values.roofing === 'tile' ? 0.85 : 0.3) },
      ];
      if (values.insulation) parts.push({ key: 'insulation', hh: roofArea * 0.15 });
      if (values.gutters) parts.push({ key: 'gutters', hh: ridge * 2 * 0.3 });
      return parts;
    }
    case 'floor': {
      const net = metric(calc, 'netArea');
      const fmt = { 30: 1.2, 45: 1.1, 60: 1.3 }[String(values.format)] ?? 1.1;
      const parts = [
        { key: 'laying', hh: net * fmt },
        { key: 'grout', hh: net * 0.2 },
      ];
      if (values.screed) parts.unshift({ key: 'screed', hh: metric(calc, 'screedVolume') * 10 });
      return parts;
    }
    case 'paint': {
      const net = metric(calc, 'netArea');
      const parts = [{ key: 'coats', hh: metric(calc, 'paintArea') * 0.12 }];
      if (values.primer) parts.unshift({ key: 'primer', hh: net * 0.08 });
      if (values.putty) parts.unshift({ key: 'putty', hh: net * 0.35 }); // apply + sand
      return parts;
    }
    default:
      return [];
  }
}

/**
 * Dead technical time of one partida (days with no work: curing, setting, drying).
 * @returns {{key: string, days: number}[]}
 */
export function deadComponents(task, values) {
  switch (task) {
    case 'slab':
      return [{ key: 'curing', days: values.thickness > 20 ? 10 : 7 }]; // concrete cures before it is loaded / built on
    case 'masonry':
      return [{ key: 'mortar', days: 3 }];
    case 'drywall':
      return [{ key: 'compound', days: 2 }]; // joint compound drying between coats
    case 'roof':
      return [];
    case 'floor':
      return [
        ...(values.screed ? [{ key: 'screed', days: 7 }] : []),
        { key: 'adhesive', days: 3 }, // adhesive set + grout cure before walking on it
      ];
    case 'paint':
      return [{ key: 'drying', days: (values.coats ?? 2) + (values.primer ? 1 : 0) + (values.putty ? 1 : 0) }]; // one night per layer
    default:
      return [];
  }
}

export const clampCrew = (n) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(SCHEDULE.maxCrew, Math.max(SCHEDULE.minCrew, v)) : SCHEDULE.defaultCrew;
};

/** Days of active work for `hh` man-hours with `crew` workers, in half-day blocks (never 0 for real work). */
export function activeDaysFor(hh, crew, { hoursPerDay = SCHEDULE.hoursPerDay, step = SCHEDULE.dayStep } = {}) {
  if (!(hh > 0)) return 0;
  const raw = hh / (clampCrew(crew) * hoursPerDay);
  return Math.max(step, Math.ceil(raw / step - 1e-9) * step);
}

/**
 * Full plan for the computed partidas (those with a valid `calc`).
 * @param partidas computeAll() partidas  @param crew number of workers
 * @returns {{crew, hoursPerDay, rows, totals}} rows carry start/end offsets (days) for the timeline.
 */
export function buildSchedule(partidas, crew = SCHEDULE.defaultCrew) {
  const workers = clampCrew(crew);
  let cursor = 0;
  let hhTotal = 0;
  let activeTotal = 0;
  let deadTotal = 0;
  const rows = partidas.map((p, index) => {
    if (!p.calc) return { index, task: p.task, hh: 0, parts: [], dead: [], activeDays: 0, deadDays: 0, start: cursor, activeEnd: cursor, end: cursor };
    const parts = labourComponents(p.task, p.values, p.calc).map((c) => ({ ...c, hh: r1(c.hh) }));
    const hh = r1(parts.reduce((s, c) => s + c.hh, 0)); // sum of the rounded parts: what the sheet shows adds up
    const dead = deadComponents(p.task, p.values);
    const deadDays = dead.reduce((s, d) => s + d.days, 0);
    const activeDays = activeDaysFor(hh, workers);
    const row = { index, task: p.task, hh, parts, dead, activeDays, deadDays, start: cursor, activeEnd: cursor + activeDays, end: cursor + activeDays + deadDays };
    cursor = row.end;
    hhTotal += hh;
    activeTotal += activeDays;
    deadTotal += deadDays;
    return row;
  });
  return {
    crew: workers,
    hoursPerDay: SCHEDULE.hoursPerDay,
    rows,
    totals: { hh: r1(hhTotal), activeDays: activeTotal, deadDays: deadTotal, totalDays: activeTotal + deadTotal },
  };
}

// ---- automatic planning from the project -------------------------------------------------------------------
// The project carries a start date and an estimated end date. When the crew is in AUTOMATIC mode and the
// project has an end date, the engine picks the SMALLEST crew whose plan (active days + dead technical time)
// fits that window; without an end date it keeps the stored crew (default 3). Days are calendar days.

const DAY_MS = 86_400_000;
const pad2 = (n) => String(n).padStart(2, '0');
export const toISODay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Strict YYYY-MM-DD -> local-midnight Date, or null. */
export function parseISODay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const diffDays = (a, b) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

/**
 * The project's time window. Start = its start date, or today when it has none; the end is optional.
 * @returns {{start: Date, end: Date|null, availableDays: number|null}} availableDays counts both ends (>= 1)
 */
export function planningWindow(timeline = {}, now = Date.now()) {
  const today = new Date(now);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = parseISODay(timeline?.startDate) ?? todayStart;
  const endRaw = parseISODay(timeline?.endDate);
  const end = endRaw && endRaw >= start ? endRaw : null; // an end before the start is ignored (as the traffic light does)
  return { start, end, availableDays: end ? Math.max(1, diffDays(start, end) + 1) : null };
}

/** Smallest crew whose plan fits `availableDays`; if none does, the smallest crew that reaches the best possible duration. */
export function suggestCrew(partidas, availableDays) {
  const total = (c) => buildSchedule(partidas, c).totals.totalDays;
  for (let c = SCHEDULE.minCrew; c <= SCHEDULE.maxCrew; c += 1) {
    if (total(c) <= availableDays) return { crew: c, fits: true };
  }
  const best = total(SCHEDULE.maxCrew);
  for (let c = SCHEDULE.minCrew; c <= SCHEDULE.maxCrew; c += 1) {
    if (total(c) <= best) return { crew: c, fits: false };
  }
  return { crew: SCHEDULE.maxCrew, fits: false };
}

/**
 * Full plan of a project: crew (automatic from the deadline, or manual) + calendar dates + deadline check.
 * @param partidas computeAll() partidas  @param draft {crew, crewAuto}  @param timeline {startDate, endDate}
 */
export function planProject(partidas, draft, timeline, now = Date.now()) {
  const win = planningWindow(timeline, now);
  const auto = draft?.crewAuto !== false;
  const stored = clampCrew(draft?.crew ?? SCHEDULE.defaultCrew);
  const crew = auto && win.availableDays ? suggestCrew(partidas, win.availableDays).crew : stored;
  const schedule = buildSchedule(partidas, crew);
  const days = Math.ceil(schedule.totals.totalDays - 1e-9);
  const estimatedEnd = addDays(win.start, Math.max(1, days) - 1);
  const spareDays = win.availableDays ? win.availableDays - days : null;
  return {
    ...schedule,
    plan: {
      auto,
      hasDeadline: Boolean(win.end),
      startDate: toISODay(win.start),
      estimatedEnd: toISODay(estimatedEnd),
      deadline: win.end ? toISODay(win.end) : '',
      availableDays: win.availableDays,
      spareDays,
      fits: spareDays === null ? null : spareDays >= 0,
    },
  };
}
