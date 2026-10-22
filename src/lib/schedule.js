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
