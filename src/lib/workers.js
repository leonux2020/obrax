// "Squadra / Maestranze": the GLOBAL directory of workers (not tied to a project; the per-project crew of a job stays in project.crew).
// One list kept on the device in localStorage (`cp.workers.v1`) and carried by the Drive backup. Everything read back (storage, backup file) is
// UNTRUSTED and goes through normalizeWorker, which also validates the sensitive part of the file (health and emergency data).

import { markDeleted } from './tombstones.js';
import { WORKER_SPECIALTIES, newEntryId } from './ledger.js';
import { sanitizePhone, sanitizeText } from './sanitize.js';
import { toCoord } from './geoDistance.js';

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

/**
 * True when the stored birth date (YYYY-MM-DD) has today's day and month in the device's LOCAL calendar (the year does not matter).
 * Someone born on 29 February celebrates on 28 February in the years that have none.
 */
export function isBirthdayToday(birthDate, now = new Date()) {
  const m = DAY_RE.exec(typeof birthDate === 'string' ? birthDate.trim() : '');
  if (!m) return false;
  const [month, day] = [Number(m[2]), Number(m[3])];
  const year = now.getFullYear();
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const [tm, td] = [now.getMonth() + 1, now.getDate()];
  if (month === 2 && day === 29 && !leap) return tm === 2 && td === 28;
  return month === tm && day === td;
}

const text = (v, max) => sanitizeText(v, max).trim();
const when = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);

/** A believable coordinate pair -> {lat, lon} (4 decimals, ~10 m: enough for "which town", too coarse to be a home), else null. */
export function cleanWorkerCoords(lat, lon) {
  const a = toCoord(lat); // strings are cast with parseFloat; null / undefined / '' are "no coordinate", never 0
  const b = toCoord(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null; // 0,0 = an empty record, not a place
  return { lat: Math.round(a * 1e4) / 1e4, lon: Math.round(b * 1e4) / 1e4 };
}

/**
 * LEGACY ADAPTER: what older versions (or hand-made backups) stored -> the current shape. A plain string is a name; `nombre` / `worker_id` /
 * `ciudad` / `direccion` / `nickname` / `lng` are the old spellings; a single `specialty` becomes the list. Never throws; null = nothing usable.
 */
export function adaptLegacyWorker(raw) {
  if (typeof raw === 'string') return { name: raw };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = { ...raw };
  o.name = raw.name ?? raw.nombre ?? raw.fullName ?? raw.full_name;
  o.id = raw.id ?? raw.worker_id ?? raw.workerId;
  o.city = raw.city ?? raw.ciudad;
  o.address = raw.address ?? raw.direccion ?? raw.dirección;
  o.apodo = raw.apodo ?? raw.nickname;
  o.phone = raw.phone ?? raw.telefono ?? raw.teléfono;
  o.lon = raw.lon ?? raw.lng ?? raw.longitude;
  o.lat = raw.lat ?? raw.latitude;
  if (!Array.isArray(raw.specialties)) {
    const one = raw.specialty ?? raw.oficio ?? raw.trade;
    o.specialties = typeof one === 'string' ? [one] : [];
  }
  return o;
}

/** A clean worker, or null when it has no name. Specialties: a unique list of known ids (max 6); rating 0 = not rated, else 1..5. */
export function normalizeWorker(input, now = Date.now()) {
  const raw = adaptLegacyWorker(input);
  if (!raw) return null;
  const name = text(raw.name, 80);
  if (!name) return null;
  const specialties = [...new Set(Array.isArray(raw.specialties) ? raw.specialties : [])].filter((s) => WORKER_SPECIALTIES.includes(s)).slice(0, MAX_SPECIALTIES);
  const rating = Math.round(Number(raw.rating));
  const created = when(raw.createdAt, now);
  return {
    id: typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : newEntryId(),
    name,
    apodo: text(raw.apodo, 40), // optional nickname ("El Flaco"): in many crews it is what a person is really called; searched and shown with the name
    specialties,
    rating: rating >= 1 && rating <= 5 ? rating : 0,
    phone: sanitizePhone(raw.phone, 32).trim(),
    city: text(raw.city ?? raw.ciudad, 60), // "Ciudad / Localidad": the exact town the Radar compares with the job's city ('' in older files)
    address: text(raw.address, 120), // street and number ONLY: the town lives in `city`
    ...(cleanWorkerCoords(raw.lat, raw.lon) || {}), // saved quietly when the town was picked from the autocomplete; feeds the real distance to a job
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
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // old rows (plain names, no valid id) get ONE stable id and are written back quietly (no change event: this runs while rendering), so a
    // `ref` saved in a project keeps pointing at them; an id-less row repeating a name already in the list is the same person, not a new one
    if (parsed.some((r) => typeof r === 'string' || typeof adaptLegacyWorker(r)?.id !== 'string' || !ID_RE.test(adaptLegacyWorker(r).id))) {
      const names = new Set();
      const kept = parsed.filter((r) => {
        const a = adaptLegacyWorker(r);
        if (!a) return false;
        const key = text(a.name, 80).toLowerCase();
        if (typeof a.id === 'string' && ID_RE.test(a.id)) {
          names.add(key);
          return true;
        }
        if (names.has(key)) return false;
        names.add(key);
        return true;
      });
      const healed = normalizeWorkers(kept);
      try {
        if (healed.length) window.localStorage.setItem(WORKERS_KEY, JSON.stringify(healed));
      } catch {
        /* storage full / blocked: the list still works in memory */
      }
      return healed;
    }
    return normalizeWorkers(parsed);
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
