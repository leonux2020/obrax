// Calendar helpers. The schedule is MANUAL: the contractor types the start date and the delivery date, and the job's duration is the
// plain subtraction of both. (The old theoretical planner - man-hours, crew size derived from the deadline, curing "dead days" - is gone:
// nothing in the app estimates how long the work takes any more.)

const pad2 = (n) => String(n).padStart(2, '0');
const DAY_MS = 86_400_000;

export const toISODay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Strict YYYY-MM-DD -> local-midnight Date, or null. */
export function parseISODay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

/**
 * Calendar days between two ISO days: delivery - start (same day = 0). null while either date is missing / invalid or the delivery
 * comes before the start. This is the ONE duration the app knows; the machinery rental follows it.
 */
export function spanDays(startDate, endDate) {
  const a = parseISODay(startDate);
  const b = parseISODay(endDate);
  return a && b && b >= a ? Math.round((b.getTime() - a.getTime()) / DAY_MS) : null;
}
