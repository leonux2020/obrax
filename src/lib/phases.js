import { parseISODay } from './schedule.js';

// The Cronograma: the job as a vertical list of phases. The project's own two dates (the ones the card on the main screen counts days with, the
// traffic light, the time bar and the machinery rental) are NOT typed any more once phases carry dates: they are DERIVED here, always from the
// same rule, so there is one truth and no way for them to disagree.

const DAY_MS = 86_400_000;
const midnight = (now) => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

/**
 * The span of the whole schedule: { startDate, endDate } = the EARLIEST start and the LATEST end among the phases that have a date ('' when none
 * does). Every phase of the Cronograma counts, finished or not: a finished phase is still part of the job's span (the start of a job does not
 * move forward because its first phase is done). A phase with only a start ends, for this purpose, where it starts.
 */
export function phaseDates(phases) {
  let start = '';
  let end = '';
  for (const p of Array.isArray(phases) ? phases : []) {
    if (parseISODay(p?.startDate) && (!start || p.startDate < start)) start = p.startDate;
    const last = parseISODay(p?.endDate) ? p.endDate : parseISODay(p?.startDate) ? p.startDate : '';
    if (last && (!end || last > end)) end = last;
  }
  return { startDate: start, endDate: end };
}

/** Does any phase carry a date (then the project's dates follow the Cronograma)? */
export const hasPhaseDates = (phases) => {
  const d = phaseDates(phases);
  return Boolean(d.startDate || d.endDate);
};

/**
 * The project with its two dates taken from the Cronograma. With no dated phase the project keeps the dates it has (typed when the job was
 * created); a date the phases cannot give stays as it was, and an end that would fall before the start is dropped. Same project back when nothing moves.
 */
export function syncDates(project) {
  if (!project) return project;
  const d = phaseDates(project.phases);
  if (!d.startDate && !d.endDate) return project;
  const startDate = d.startDate || project.startDate || '';
  let endDate = d.endDate || project.endDate || '';
  if (startDate && endDate && endDate < startDate) endDate = '';
  return startDate === project.startDate && endDate === project.endDate ? project : { ...project, startDate, endDate };
}

/** 'done' (marked completed), 'active' (not done and it has started: its start is today or earlier) or 'pending' (not started, or no start date). */
export function phaseState(phase, now = Date.now()) {
  if (phase?.done) return 'done';
  const start = parseISODay(phase?.startDate);
  return start && start <= midnight(now) ? 'active' : 'pending';
}

/** Days from today to the phase's end: > 0 left, 0 ends today, < 0 overdue; null without a valid end date. */
export function phaseDaysLeft(phase, now = Date.now()) {
  const end = parseISODay(phase?.endDate);
  return end ? Math.round((end.getTime() - midnight(now).getTime()) / DAY_MS) : null;
}

/** Chronological order for display: by start (undated last), then by end, keeping the typed order for ties. */
export const sortPhases = (phases) =>
  (Array.isArray(phases) ? phases : [])
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const sa = a.p.startDate || '9999-99-99';
      const sb = b.p.startDate || '9999-99-99';
      return sa < sb ? -1 : sa > sb ? 1 : (a.p.endDate || '9999-99-99') < (b.p.endDate || '9999-99-99') ? -1 : (a.p.endDate || '9999-99-99') > (b.p.endDate || '9999-99-99') ? 1 : a.i - b.i;
    })
    .map((x) => x.p);
