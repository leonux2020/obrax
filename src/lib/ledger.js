// Money and field records that live INSIDE a project (all pure, all validated on load):
//   payments  - what the client has paid (anticipos / abonos): the "Control de Caja" progress bar
//   advances  - cash advanced to workers ("adelantos"), discounted from the labour pool
//   expenses  - receipts read by the AI (or typed): the raw material of the "rendición de cuentas",
//               including rented tools / machinery with the day they must be returned
//   logbook   - dated notes of the site diary (bitácora)
//   location  - where the job is (coordinates of the phone when the user taps "ubicación actual")

import { sanitizeText } from './sanitize.js';

export const LEDGER_LIMITS = Object.freeze({ payments: 200, advances: 200, expenses: 500, logbook: 500, maxAmount: 1e12, noteChars: 80, logChars: 2000 });

export const EXPENSE_CATEGORIES = Object.freeze(['material', 'tool_rental', 'machinery_rental', 'labor', 'transport', 'other']);
export const RENTAL_CATEGORIES = Object.freeze(['tool_rental', 'machinery_rental']);

const ID_RE = /^[a-z0-9]{4,24}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const newEntryId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6);

const amount = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) && n > 0 && n <= LEDGER_LIMITS.maxAmount ? Math.round(n * 100) / 100 : null;
};
const stamp = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const day = (v) => (typeof v === 'string' && DAY_RE.test(v) ? v : '');
const idOf = (v, used) => {
  let id = typeof v === 'string' && ID_RE.test(v) && !used.has(v) ? v : newEntryId();
  while (used.has(id)) id = newEntryId();
  used.add(id);
  return id;
};

function listOf(raw, max, one) {
  if (!Array.isArray(raw)) return [];
  const used = new Set();
  const out = [];
  for (const item of raw.slice(0, max)) {
    if (!item || typeof item !== 'object') continue;
    const clean = one(item, used);
    if (clean) out.push(clean);
  }
  return out;
}

export const normalizePayments = (raw) =>
  listOf(raw, LEDGER_LIMITS.payments, (p, used) => {
    const a = amount(p.amount);
    return a === null ? null : { id: idOf(p.id, used), amount: a, at: stamp(p.at), note: sanitizeText(p.note, LEDGER_LIMITS.noteChars).trim() };
  });

export const normalizeAdvances = (raw) =>
  listOf(raw, LEDGER_LIMITS.advances, (p, used) => {
    const a = amount(p.amount);
    const worker = sanitizeText(p.worker, 60).trim();
    return a === null || !worker ? null : { id: idOf(p.id, used), worker, amount: a, at: stamp(p.at) };
  });

export const normalizeExpenses = (raw) =>
  listOf(raw, LEDGER_LIMITS.expenses, (p, used) => {
    const a = amount(p.amount);
    if (a === null) return null;
    const category = EXPENSE_CATEGORIES.includes(p.category) ? p.category : 'other';
    const rental = RENTAL_CATEGORIES.includes(category);
    return {
      id: idOf(p.id, used),
      at: stamp(p.at),
      supplier: sanitizeText(p.supplier, 60).trim(),
      description: sanitizeText(p.description, 120).trim(),
      amount: a,
      category,
      // only rented tools / machinery have a day to give them back
      returnDate: rental ? day(p.returnDate) : '',
      returned: rental && p.returned === true,
    };
  });

export const normalizeLogbook = (raw) =>
  listOf(raw, LEDGER_LIMITS.logbook, (p, used) => {
    const text = sanitizeText(p.text, LEDGER_LIMITS.logChars).trim();
    return text ? { id: idOf(p.id, used), at: stamp(p.at), text, ...(p.photo === true ? { photo: true } : {}) } : null; // `photo`: a Blob in IndexedDB (notePhotos.js) belongs to this note
  });

/** { lat, lng, label } or null. Coordinates only: nothing is sent anywhere to name the place. */
export function normalizeLocation(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const lat = Number(obj.lat);
  const lng = Number(obj.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const r = (n) => Math.round(n * 1e5) / 1e5;
  return { lat: r(lat), lng: r(lng), label: sanitizeText(obj.label, 80).trim() };
}

export const locationLabel = (loc) => (loc ? loc.label || `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : '');

// ---- derived numbers ------------------------------------------------------------------------------------------
const sum = (list) => list.reduce((s, x) => s + x.amount, 0);
const cents = (n) => Math.round(n * 100) / 100;

/** Cash control: what the client paid against the budget. `pct` is clamped to 0..100 for the bar. */
export function cashSummary(total, payments = []) {
  const paid = cents(sum(payments));
  const pending = cents(Math.max(0, (total || 0) - paid));
  const pct = total > 0 ? Math.min(100, Math.max(0, (paid / total) * 100)) : 0;
  return { total: total || 0, paid, pending, pct, overpaid: total > 0 && paid > total + 0.005 };
}

/** Labour pool (what the labour line of the quote allows) minus the cash already advanced to workers. */
export function laborPool(laborAmount, advances = []) {
  const advanced = cents(sum(advances));
  return { pool: laborAmount || 0, advanced, available: cents((laborAmount || 0) - advanced) };
}

export const expensesTotal = (expenses = []) => cents(sum(expenses));

/** Day string (local calendar) of a timestamp. */
export function dayOf(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Rented tools / machinery not given back yet whose return day is today (or already past). */
export function rentalsDue(expenses = [], now = Date.now()) {
  const today = dayOf(now);
  return expenses.filter((e) => RENTAL_CATEGORIES.includes(e.category) && !e.returned && e.returnDate && e.returnDate <= today);
}

export const hasRentalDue = (project, now = Date.now()) => rentalsDue(project?.expenses, now).length > 0;
