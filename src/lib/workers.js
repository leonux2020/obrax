// "Squadra / Maestranze": the GLOBAL directory of workers (not tied to a project; the per-project crew of a job stays in project.crew).
// One list kept on the device in localStorage (`cp.workers.v1`) and carried by the Drive backup. Everything read back (storage, backup file) is
// UNTRUSTED and goes through normalizeWorker, which also validates the sensitive part of the file (health and emergency data).

import { markDeleted } from './tombstones.js';
import { WORKER_SPECIALTIES, newEntryId } from './ledger.js';
import { sanitizePhone, sanitizeText } from './sanitize.js';

export const WORKERS_KEY = 'cp.workers.v1';
export const WORKER_LIMIT = 200;
export const MAX_SPECIALTIES = 6;
export const SEXES = Object.freeze(['m', 'f', 'x']);
export const BLOOD_TYPES = Object.freeze(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']); // a closed list: no free text, so no typo can reach a paramedic
export const RATINGS = Object.freeze([1, 2, 3, 4, 5]);
const MAX_STORED_CHARS = 2_000_000;
const ID_RE = /^[a-z0-9]{4,24}$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A birth date must be a real calendar day between 1900 and today; anything else is dropped. */
export function cleanBirthDate(v, now = Date.now()) {
  const m = DAY_RE.exec(typeof v === 'string' ? v.trim() : '');
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return '';
  if (y < 1900 || date.getTime() > now) return '';
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const text = (v, max) => sanitizeText(v, max).trim();
const when = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);

/** A clean worker, or null when it has no name. Specialties: a unique list of known ids (max 6); rating 0 = not rated, else 1..5. */
export function normalizeWorker(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const name = text(raw.name, 80);
  if (!name) return null;
  const specialties = [...new Set(Array.isArray(raw.specialties) ? raw.specialties : [])].filter((s) => WORKER_SPECIALTIES.includes(s)).slice(0, MAX_SPECIALTIES);
  const rating = Math.round(Number(raw.rating));
  const created = when(raw.createdAt, now);
  return {
    id: typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : newEntryId(),
    name,
    specialties,
    rating: rating >= 1 && rating <= 5 ? rating : 0,
    phone: sanitizePhone(raw.phone, 32).trim(),
    city: text(raw.city ?? raw.ciudad, 60), // "Ciudad / Localidad": the exact town the Radar compares with the job's city ('' in older files)
    address: text(raw.address, 120),
    document: text(raw.document, 40),
    nationality: text(raw.nationality, 40),
    sex: SEXES.includes(raw.sex) ? raw.sex : '',
    birthDate: cleanBirthDate(raw.birthDate, now),
    bloodType: BLOOD_TYPES.includes(raw.bloodType) ? raw.bloodType : '', // '' = not specified
    limiting: text(raw.limiting, 300), // "Condiciones limitantes"
    allergies: text(raw.allergies, 300),
    emergencyName: text(raw.emergencyName, 80),
    emergencyPhone: sanitizePhone(raw.emergencyPhone, 32).trim(),
    createdAt: created,
    updatedAt: when(raw.updatedAt, created),
  };
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** A clean list: invalid rows dropped, repeated ids keep the first, alphabetical, bounded. */
export function normalizeWorkers(raw, now = Date.now()) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const w = normalizeWorker(r, now);
    if (!w || seen.has(w.id)) continue;
    seen.add(w.id);
    out.push(w);
    if (out.length >= WORKER_LIMIT) break;
  }
  return out.sort(byName);
}

/** True when the file carries something a first-aider needs to know (a limiting condition or an allergy). */
export const hasHealthNotes = (w) => Boolean(w?.limiting || w?.allergies);

/** Union by id; the newest `updatedAt` wins (a tie is broken by the content: the same result on every device). `tombs` = { id: deletedAt }: a file deleted after its last change stays deleted. */
export function mergeWorkers(local, incoming, tombs = {}) {
  const byId = new Map(normalizeWorkers(local).map((w) => [w.id, w]));
  for (const w of normalizeWorkers(incoming)) {
    const mine = byId.get(w.id);
    if (!mine || w.updatedAt > mine.updatedAt || (w.updatedAt === mine.updatedAt && JSON.stringify(w) > JSON.stringify(mine))) byId.set(w.id, w);
  }
  return [...byId.values()].filter((w) => !(tombs[w.id] > 0 && tombs[w.id] >= w.updatedAt)).sort(byName).slice(0, WORKER_LIMIT);
}

// ---- change notifications: the invisible backup engine listens, so a worker edited in Ajustes goes up to Drive like any other change ----
const listeners = new Set();
/** `fn()` runs after every successful write of the directory. Returns the unsubscribe function. */
export function onWorkersChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emitChanged = () => listeners.forEach((fn) => { try { fn(); } catch { /* a listener never breaks a save */ } });

// ---- storage (localStorage; never throws) -----------------------------------------------------------------------------------
export function loadWorkers() {
  try {
    const raw = window.localStorage.getItem(WORKERS_KEY);
    if (!raw || raw.length > MAX_STORED_CHARS) return [];
    return normalizeWorkers(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Writes the (normalized) list; returns it. A full / blocked storage returns the list anyway (the caller keeps it in memory). */
export function saveWorkers(list) {
  const clean = normalizeWorkers(list);
  try {
    if (clean.length) window.localStorage.setItem(WORKERS_KEY, JSON.stringify(clean));
    else window.localStorage.removeItem(WORKERS_KEY);
  } catch {
    /* storage full / blocked */
  }
  emitChanged();
  return clean;
}

/** Add or replace one worker (by id), stamping `updatedAt`. Returns { list, worker } (worker null when it has no name). */
export function upsertWorker(raw, now = Date.now()) {
  const current = loadWorkers();
  const existing = current.find((w) => w.id === raw?.id);
  const worker = normalizeWorker({ ...raw, createdAt: existing?.createdAt ?? raw?.createdAt, updatedAt: now }, now);
  if (!worker) return { list: current, worker: null };
  return { list: saveWorkers([...current.filter((w) => w.id !== worker.id), worker]), worker };
}

export const removeWorker = (id) => {
  markDeleted('workers', id); // so the other devices do not bring the file back from the Drive backup
  return saveWorkers(loadWorkers().filter((w) => w.id !== id));
};
