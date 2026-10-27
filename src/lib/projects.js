// Projects (one per client job): model, normalisation, company snapshot and the time traffic light.
// Everything here is pure so the rules are unit-testable in Node.

import { getRegion } from './regions.js';
import { normalizeDraft, normalizeCompany, newDraft, isCompanyEmpty } from './draft.js';
import { sanitizeText } from './sanitize.js';
import { normalizeLogo } from './logo.js';
import { normalizeAdvances, normalizeExpenses, normalizeLocation, normalizeLogbook, normalizePayments } from './ledger.js';

export const MAX_PROJECTS = 200;
const ID_RE = /^[a-z0-9]{6,24}$/;
const DAY_MS = 86_400_000;

/** Traffic-light rules (agreed): orange when <= 3 days or <= 20 % of the schedule remain. */
export const LIGHT_RULES = Object.freeze({ orangeDays: 3, orangeFraction: 0.2 });

export const newProjectId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6);

// ---- dates (YYYY-MM-DD, local calendar days) --------------------------------------------------------
/** Parse a strict ISO date to a local-midnight Date, or null (rejects 2026-02-30, junk, etc.). */
export function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

export function toDayString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole calendar days from a to b (DST-safe). */
export const dayDiff = (a, b) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

const startOfDay = (ms) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

/**
 * Traffic light from "Fecha de Inicio" and "Fecha de Término Estimada".
 *  green  = on time           orange = <= 3 days or <= 20 % of the schedule left (incl. due today)
 *  red    = past the end date none   = no (valid) end date, or end before start
 * Returns { level, daysLeft, fractionLeft } where daysLeft < 0 means days overdue.
 */
export function trafficLight(startDate, endDate, now = Date.now(), rules = LIGHT_RULES) {
  const end = parseDay(endDate);
  const start = parseDay(startDate);
  if (!end || (start && start > end)) return { level: 'none', daysLeft: null, fractionLeft: null };

  const today = startOfDay(now);
  const daysLeft = dayDiff(today, end);
  const total = start ? Math.max(1, dayDiff(start, end)) : null;
  const fractionLeft = total ? Math.min(1, Math.max(0, daysLeft / total)) : null;

  let level = 'green';
  if (daysLeft < 0) level = 'red';
  else if (daysLeft <= rules.orangeDays || (fractionLeft !== null && fractionLeft <= rules.orangeFraction)) level = 'orange';
  return { level, daysLeft, fractionLeft };
}

/**
 * The four states shown on the dashboard (an undated, already started job counts as on time). `future` (blue) = the job has not started yet; the other levels are the
 * time traffic light. `daysLate` is the critical figure printed on a red card.
 */
export function projectLevel(project, now = Date.now()) {
  const light = trafficLight(project.startDate, project.endDate, now);
  const start = parseDay(project.startDate);
  const today = startOfDay(now);
  if (start && start > today) return { level: 'future', daysLate: 0, daysUntilStart: dayDiff(today, start), light };
  // A job that has begun but has no end date can never be late: it is "on time" (green), not an inert grey.
  const level = light.level === 'none' ? 'green' : light.level;
  return { level, daysLate: level === 'red' ? Math.abs(light.daysLeft) : 0, daysUntilStart: 0, light };
}

/** A finished job (marked in the edit sheet) lives in the dashboard's "Historial" tab. */
export const isClosed = (project) => Number(project?.closedAt) > 0;

const SEVERITY = { red: 0, orange: 1, green: 2, none: 3 };

/** Dashboard order: most urgent first (red, orange, green, undated), then earliest deadline, then newest. */
export function sortProjects(list, now = Date.now()) {
  return [...list]
    .map((p) => ({ p, light: trafficLight(p.startDate, p.endDate, now) }))
    .sort((a, b) => {
      const s = SEVERITY[a.light.level] - SEVERITY[b.light.level];
      if (s) return s;
      const da = a.light.daysLeft ?? Infinity;
      const db = b.light.daysLeft ?? Infinity;
      if (da !== db) return da - db;
      return b.p.updatedAt - a.p.updatedAt;
    })
    .map((x) => x.p);
}

// ---- company snapshot ----------------------------------------------------------------------------------
/**
 * Immutable copy of the company profile embedded in a project (name, tax id, contact data and logo).
 * Changing the global profile later never alters a project that already carries its own copy.
 */
export function snapshotCompany(company, logo = '') {
  const c = normalizeCompany(company);
  return { ...c, logo: normalizeLogo(logo ?? company?.logo) || '' };
}

export const isSnapshotEmpty = (c) => !c || (isCompanyEmpty({ ...c, logo: '' }) && !c.logo);

/**
 * The company printed on a project's documents (preview + PDF): the project's own snapshot of the profile, except
 * the contractor's SIGNATURE, which always follows the profile (drawn once at onboarding / settings). Otherwise a
 * project created before the signature was drawn, or before it was redrawn, would keep printing an empty / old one.
 */
export function documentCompany(snapshot, profile) {
  const own = snapshot || {};
  const sig = profile?.signature || own.signature || null;
  return sig === own.signature ? own : { ...own, signature: sig };
}

/**
 * A project created BEFORE the profile existed has an empty snapshot; it adopts the profile the first
 * time one is saved. A populated snapshot is never overwritten (that is what keeps issued quotes intact).
 */
export function adoptCompany(project, company, logo = '') {
  if (!isSnapshotEmpty(project.company)) return project;
  const snap = snapshotCompany(company, logo);
  return isSnapshotEmpty(snap) ? project : { ...project, company: snap };
}

// ---- project model --------------------------------------------------------------------------------------
export function newProject({ regionCode, mode = 'quick', company = null, logo = '', name = '', client = '', startDate = '', endDate = '', location = null, parentId = '', now = Date.now() }) {
  const draft = newDraft(regionCode, mode);
  draft.project = { name: sanitizeText(name, 60).trim(), client: sanitizeText(client, 60).trim() };
  const start = parseDay(startDate) ? startDate : '';
  const end = parseDay(endDate) && !(start && parseDay(start) > parseDay(endDate)) ? endDate : '';
  return {
    id: newProjectId(),
    createdAt: now,
    updatedAt: now,
    startDate: start,
    endDate: end,
    company: snapshotCompany(company, logo),
    location: normalizeLocation(location),
    closedAt: 0,
    ...(parentId && ID_RE.test(parentId) ? { parentId } : {}),
    payments: [],
    advances: [],
    expenses: [],
    logbook: [],
    draft,
  };
}

/** The id of the ORIGINAL job of a chain of extensions (a project that extends nothing is its own root). */
export const rootId = (project) => project.parentId || project.id;

/**
 * "Crear extensión": a NEW phase of a finished job. It copies ONLY the client, the place and the market (country) of
 * `parent`; it has no partidas and no money, and `parentId` links it to the ORIGINAL job (never to another extension), so the
 * past quote is untouched and a client's jobs can be added up later. Named "{original} - {label} {n}" (n = the next free
 * number among the extensions of that original). `company` / `logo` are the CURRENT profile, as for any new project.
 */
export function newExtension(parent, projects = [], { label = 'Extensión', company = null, logo = '', now = Date.now() } = {}) {
  const root = rootId(parent);
  const n = projects.filter((p) => p.parentId === root).length + 1;
  const own = projectTitle(parent) || '';
  const base = (parent.parentId ? own.replace(/\s-\s\S+\s\d+$/, '') : own).trim(); // an extension of an extension keeps the ORIGINAL name
  const suffix = ` - ${label} ${n}`;
  const name = `${base.slice(0, Math.max(0, 60 - suffix.length)).trimEnd()}${suffix}`.trimStart();
  return newProject({
    regionCode: parent.draft.regionCode,
    mode: 'project',
    company,
    logo,
    name,
    client: projectClient(parent),
    startDate: toDayString(new Date(now)),
    location: parent.location,
    parentId: root,
    now,
  });
}

/** Validate an untrusted stored project. Returns a clean project or null. */
export function normalizeProject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.id !== 'string' || !ID_RE.test(obj.id)) return null;
  const regionCode = obj.draft?.regionCode;
  if (!getRegion(regionCode)) return null;
  const start = parseDay(obj.startDate) ? obj.startDate : '';
  const endOk = parseDay(obj.endDate) && !(start && parseDay(start) > parseDay(obj.endDate));
  const created = Number(obj.createdAt);
  const updated = Number(obj.updatedAt);
  return {
    id: obj.id,
    createdAt: Number.isFinite(created) ? created : 0,
    updatedAt: Number.isFinite(updated) ? updated : Number.isFinite(created) ? created : 0,
    startDate: start,
    endDate: endOk ? obj.endDate : '',
    company: snapshotCompany(obj.company, obj.company?.logo),
    location: normalizeLocation(obj.location),
    closedAt: Number.isFinite(Number(obj.closedAt)) && Number(obj.closedAt) > 0 ? Number(obj.closedAt) : 0,
    ...(typeof obj.parentId === 'string' && ID_RE.test(obj.parentId) ? { parentId: obj.parentId } : {}), // the job this one extends (older records have none)
    payments: normalizePayments(obj.payments),
    advances: normalizeAdvances(obj.advances),
    expenses: normalizeExpenses(obj.expenses),
    logbook: normalizeLogbook(obj.logbook),
    draft: normalizeDraft(obj.draft, regionCode),
  };
}

export function normalizeProjects(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list.slice(0, MAX_PROJECTS)) {
    const p = normalizeProject(item);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/** Display helpers for cards. */
export const projectTitle = (p) => p.draft.project.name;
export const projectClient = (p) => p.draft.project.client;
