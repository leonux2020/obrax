// Money and field records that live INSIDE a project (all pure, all validated on load):
//   payments  - what the client has paid (anticipos / abonos): the "Control de Caja" progress bar
//   advances  - cash advanced to workers ("adelantos"), discounted from the labour pool
//   expenses  - receipts read by the AI (or typed): the raw material of the "rendición de cuentas",
//               including rented tools / machinery with the day they must be returned
//   logbook   - dated notes of the site diary (bitácora)
//   location  - where the job is (coordinates of the phone when the user taps "ubicación actual")

import { sanitizeText } from './sanitize.js';
import { getRegion, taxRateFor } from './regions.js';

export const LEDGER_LIMITS = Object.freeze({ payments: 200, advances: 200, expenses: 500, logbook: 500, maxAmount: 1e12, noteChars: 80, logChars: 2000 });

export const EXPENSE_CATEGORIES = Object.freeze(['material', 'tool_rental', 'machinery_rental', 'labor', 'transport', 'food', 'other']);
// A job site has indirect costs too: `food` = food / per-diem for the crew (supermarket, restaurant), `transport` = fuel, tolls, freight.
export const RENTAL_CATEGORIES = Object.freeze(['tool_rental', 'machinery_rental']);

// Fiscal metadata of a receipt (corporate accounting / audit): closed vocabularies, translated by exp.doc.* / exp.pay.* keys.
export const DOCUMENT_TYPES = Object.freeze(['invoice', 'receipt', 'ticket', 'other']); // Factura, Boleta / Scontrino / Recibo, Ticket
export const PAYMENT_METHODS = Object.freeze(['cash', 'card', 'transfer', 'other']); // Efectivo, Tarjeta, Transferencia
// the tax id of the shop (RUT, NIT, Partita IVA, CNPJ...) and the folio: short codes, never free prose
// eslint-disable-next-line no-control-regex
const CODE_JUNK = /[\u0000-\u001f\u007f-\u009f<>`\\{}[\]$|^~]/g;
export const cleanFiscalCode = (v, max = 32) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(CODE_JUNK, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');
export const oneOfOrEmpty = (v, list) => (typeof v === 'string' && list.includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : '');

const ID_RE = /^[a-z0-9]{4,24}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const newEntryId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6);

const amount = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) && n > 0 && n <= LEDGER_LIMITS.maxAmount ? Math.round(n * 100) / 100 : null;
};
// like `amount` but 0 is a real value (an exempt document has tax 0)
const amount0 = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= LEDGER_LIMITS.maxAmount ? Math.round(n * 100) / 100 : null;
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

const RECEIPT_ID_RE = /^[a-z0-9]{4,24}$/;

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
      // transcription of the receipt line (all optional; older records have none): printed date, ISO currency, quantity, unit price
      ...(day(p.date) ? { date: day(p.date) } : {}),
      ...(typeof p.currency === 'string' && /^[A-Za-z]{3}$/.test(p.currency.trim()) ? { currency: p.currency.trim().toUpperCase() } : {}),
      ...(amount(p.quantity) !== null ? { quantity: amount(p.quantity) } : {}),
      ...(amount(p.unitPrice) !== null ? { unitPrice: amount(p.unitPrice) } : {}),
      // fiscal metadata for audit (each present only when the receipt showed it): shop tax id, document type + folio, how it was paid,
      // and the NET / TAX share of THIS line (the document's net and tax prorated over its lines)
      ...(cleanFiscalCode(p.vendorTaxId, 24) ? { vendorTaxId: cleanFiscalCode(p.vendorTaxId, 24) } : {}),
      ...(oneOfOrEmpty(p.documentType, DOCUMENT_TYPES) ? { documentType: oneOfOrEmpty(p.documentType, DOCUMENT_TYPES) } : {}),
      ...(cleanFiscalCode(p.documentNumber, 32) ? { documentNumber: cleanFiscalCode(p.documentNumber, 32) } : {}),
      ...(oneOfOrEmpty(p.paymentMethod, PAYMENT_METHODS) ? { paymentMethod: oneOfOrEmpty(p.paymentMethod, PAYMENT_METHODS) } : {}),
      ...(amount0(p.netAmount) !== null ? { netAmount: amount0(p.netAmount) } : {}),
      ...(amount0(p.taxAmount) !== null ? { taxAmount: amount0(p.taxAmount) } : {}),
      // context: the project this expense belongs to (never orphan), where the job is, and which receipt document the line came from
      ...(typeof p.projectId === 'string' && ID_RE.test(p.projectId) ? { projectId: p.projectId } : {}),
      ...(sanitizeText(p.place, 80).trim() ? { place: sanitizeText(p.place, 80).trim() } : {}),
      ...(typeof p.docId === 'string' && ID_RE.test(p.docId) ? { docId: p.docId } : {}),
      // the photo of the receipt these lines came from (a Blob in IndexedDB, see receiptPhotos.js); several lines can share one
      ...(typeof p.receiptId === 'string' && RECEIPT_ID_RE.test(p.receiptId) ? { receiptId: p.receiptId } : {}),
    };
  });

/**
 * Every expense of a batch inherits the context of the project it is saved into: its `projectId` (always the project's own id,
 * whatever the line said), the project's currency when the receipt printed none, and the place of the job. No expense is ever orphan.
 */
export function withProjectContext(project, expenses) {
  const currency = getRegion(project?.draft?.regionCode)?.currency || '';
  const place = sanitizeText(project?.cityOrRegion || project?.location?.label || '', 80).trim();
  return (Array.isArray(expenses) ? expenses : []).map((e) => ({
    ...e,
    projectId: project.id,
    ...(e.currency || !currency ? {} : { currency }),
    ...(place ? { place } : {}),
  }));
}

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

/**
 * REAL cash on hand of the job: what the client has paid (advances / payments) minus what has gone out of the pocket
 * (registered expenses + cash advanced to workers). Negative = the contractor is financing the job. Always a finite number.
 */
export function liquidity(payments = [], expenses = [], advances = []) {
  return cents(cents(sum(payments)) - cents(sum(expenses)) - cents(sum(advances)));
}

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

/**
 * Money spent per shop: [{ key, name, currency, total, count }], biggest first; the expenses with no supplier go together in ONE group
 * at the end (`name: ''`, the caller labels it). Shops are matched ignoring case / extra spaces ("sodimac " = "Sodimac"); a shop paid
 * in two currencies gives two groups (money of different currencies is never added). `currency: ''` = the project's own.
 */
export function supplierTotals(expenses = []) {
  const groups = new Map();
  for (const e of Array.isArray(expenses) ? expenses : []) {
    const name = typeof e?.supplier === 'string' ? e.supplier.trim().replace(/\s+/g, ' ') : '';
    const currency = typeof e?.currency === 'string' ? e.currency.toUpperCase() : '';
    const key = `${name.toLowerCase()}|${currency}`;
    const g = groups.get(key) || { key, name, currency, total: 0, count: 0 };
    g.total = Math.round((g.total + (Number(e?.amount) || 0)) * 100) / 100;
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => (a.name === '') - (b.name === '') || b.total - a.total || a.name.localeCompare(b.name));
}

/** "29 oct 2026" for a printed receipt day ('YYYY-MM-DD'); '' when there is none / it is odd. Never throws. */
export function expenseDayLabel(value, locale = 'es') {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return '';
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return '';
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }
}

// ---- Contabilidad Global: pure aggregation over the projects already stored (no new data, no schema change) -------------------------
// Money of different currencies is NEVER added together: every aggregate is a list [{ currency, regionCode, amount }] with one
// line per currency (sorted by currency code), formatted by the caller with the money of that market.

const DAY_MS = 86_400_000;
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const total = (list) => cents(arr(list).reduce((s, x) => s + num(x.amount), 0));

/** A project that is still running (not finished / historical). */
export const isActiveProject = (project) => !(Number(project?.closedAt) > 0);

/** Currency and market of a project (its own country, not the app's). */
export const projectMarket = (project) => {
  const region = getRegion(project?.draft?.regionCode);
  return { currency: region ? region.currency : '', regionCode: region ? region.code : project?.draft?.regionCode || '' };
};

/** Real cash of ONE project: Σ client payments - Σ expenses - Σ worker advances. */
export const projectLiquidity = (project) => liquidity(arr(project?.payments), arr(project?.expenses), arr(project?.advances));

/** Tax rate applied to ONE project (the market's, or the one the contractor set where it is editable): 0.19 = 19 %. */
export function projectTaxRate(project) {
  const region = getRegion(project?.draft?.regionCode);
  return region ? taxRateFor(region, project?.draft?.finance) : 0;
}

/**
 * Tax contained in an amount that was collected WITH tax included (the quote total includes it): amount x rate / (1 + rate).
 * 119 collected at 19 % holds 19 of tax. Never negative, to the cent.
 */
export const taxIncluded = (amount, rate) => (num(amount) > 0 && num(rate) > 0 ? cents((num(amount) * num(rate)) / (1 + num(rate))) : 0);

/** Σ tax contained in what the client really paid on ONE project. */
export const projectTaxReserve = (project) => taxIncluded(total(project?.payments), projectTaxRate(project));

/** Pending to collect from the client on ONE project (budget with tax - payments), 0 when the quote is not valid yet. */
export const projectReceivable = (project, budget) => (num(budget) > 0 ? cents(Math.max(0, num(budget) - total(project?.payments))) : 0);

/** The most recent REAL interaction of a project: newest of logbook notes, expenses, client payments and worker advances. 0 if none. */
export function getLastProjectActivity(project) {
  let last = 0;
  for (const list of [project?.logbook, project?.expenses, project?.payments, project?.advances]) {
    for (const entry of arr(list)) if (num(entry.at) > last) last = num(entry.at);
  }
  return last;
}

/** Order key of the accounting list: last movement, or (while there is none) the creation / last edit of the project. */
export const activityKey = (project) => getLastProjectActivity(project) || num(project?.createdAt) || num(project?.updatedAt);

/** Whole calendar days between a moment and now (0 = today, 1 = yesterday...), or null without a moment. Never negative. */
export function daysAgo(ms, now = Date.now()) {
  if (!(num(ms) > 0)) return null;
  const a = new Date(num(ms));
  const b = new Date(now);
  const diff = Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);
  return Math.max(0, diff);
}

/** Projects, most recent movement first (stable: the input order breaks ties). */
export const sortByActivity = (projects) =>
  arr(projects)
    .map((p, i) => ({ p, i, k: activityKey(p) }))
    .sort((a, b) => b.k - a.k || a.i - b.i)
    .map((x) => x.p);

/** Days since the last client payment (or since the project began while nothing was paid), or null. */
export const daysWithoutPayment = (project, now = Date.now()) => daysAgo(Math.max(0, ...arr(project?.payments).map((x) => num(x.at))) || num(project?.createdAt), now);

/** Collection warning: balance still pending and more than `limit` days without a payment. Returns the days, or 0 when all is well. */
export function collectionDelay(project, budget, now = Date.now(), limit = 15) {
  if (!isActiveProject(project) || !(projectReceivable(project, budget) > 0)) return 0;
  const days = daysWithoutPayment(project, now);
  return days !== null && days > limit ? days : 0;
}

/** Adds `valueOf(project)` of every ACTIVE project per currency -> [{ currency, regionCode, amount }]. Empty list when nothing to add. */
function perCurrency(projects, valueOf) {
  const lines = new Map();
  for (const p of arr(projects)) {
    if (!isActiveProject(p)) continue;
    const { currency, regionCode } = projectMarket(p);
    if (!currency) continue; // unknown market: there is no money to format
    const line = lines.get(currency) ?? { currency, regionCode, amount: 0 };
    line.amount = cents(line.amount + num(valueOf(p)));
    lines.set(currency, line);
  }
  return [...lines.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Net cash available across the active projects (Σ payments - Σ expenses - Σ advances), per currency. */
export const globalLiquidity = (projects) => perCurrency(projects, projectLiquidity);

/** Tax shield: tax contained in the payments really collected, per currency (the amount to set aside for the tax office). */
export const globalTaxReserve = (projects) => perCurrency(projects, projectTaxReserve);

/** Pending to collect from clients (budget - payments), per currency. `budgets` is Map(projectId -> total with tax | null). */
export const globalReceivables = (projects, budgets) => perCurrency(projects, (p) => projectReceivable(p, budgets?.get?.(p.id)));

/** Active projects with a collection warning -> [{ id, days }] (`budgets` as in globalReceivables). */
export const lateCollections = (projects, budgets, now = Date.now(), limit = 15) =>
  arr(projects)
    .map((p) => ({ id: p.id, days: collectionDelay(p, budgets?.get?.(p.id), now, limit) }))
    .filter((x) => x.days > 0);

/**
 * "12 Mar – 28 Apr 2026": the project's dates (start - estimated end); only the start when there is no end; the creation date when
 * there are none. Returns { kind: 'range' | 'start' | 'created' | 'none', text }. Never throws on missing / odd dates.
 */
export function projectDateRange(project, locale = 'es') {
  const parse = (v) => {
    if (typeof v !== 'string' || !DAY_RE.test(v)) return null;
    const [y, m, d] = v.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
  };
  let fmt;
  try {
    fmt = (date, opts) => new Intl.DateTimeFormat(locale, opts).format(date);
    fmt(new Date(), {});
  } catch {
    fmt = (date, opts) => new Intl.DateTimeFormat('es', opts).format(date);
  }
  const start = parse(project?.startDate);
  const end = parse(project?.endDate);
  const dm = { day: 'numeric', month: 'short' };
  const dmy = { ...dm, year: 'numeric' };
  if (start && end) {
    const sameYear = start.getFullYear() === end.getFullYear();
    return { kind: 'range', text: `${fmt(start, sameYear ? dm : dmy)} – ${fmt(end, dmy)}` };
  }
  if (start) return { kind: 'start', text: fmt(start, dmy) };
  if (end) return { kind: 'start', text: fmt(end, dmy) };
  const created = num(project?.createdAt);
  if (created > 0) return { kind: 'created', text: fmt(new Date(created), dmy) };
  return { kind: 'none', text: '' };
}

/** Per currency, over the ACTIVE projects, every figure of the breakdown sheet: received, spent, advanced, liquid, tax, receivable. */
export function globalBreakdown(projects, budgets) {
  const lines = new Map();
  for (const p of arr(projects)) {
    if (!isActiveProject(p)) continue;
    const { currency, regionCode } = projectMarket(p);
    if (!currency) continue;
    const line = lines.get(currency) ?? { currency, regionCode, received: 0, spent: 0, advanced: 0, liquid: 0, tax: 0, receivable: 0 };
    line.received = cents(line.received + total(p.payments));
    line.spent = cents(line.spent + total(p.expenses));
    line.advanced = cents(line.advanced + total(p.advances));
    line.liquid = cents(line.received - line.spent - line.advanced);
    line.tax = cents(line.tax + projectTaxReserve(p));
    line.receivable = cents(line.receivable + projectReceivable(p, budgets?.get?.(p.id)));
    lines.set(currency, line);
  }
  return [...lines.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Active projects with a balance still to collect: [{ id, currency, regionCode, pending, late }] - late ones first, then by amount. */
export function receivableList(projects, budgets, now = Date.now(), limit = 15) {
  return arr(projects)
    .map((p) => ({ id: p.id, ...projectMarket(p), pending: isActiveProject(p) ? projectReceivable(p, budgets?.get?.(p.id)) : 0, late: collectionDelay(p, budgets?.get?.(p.id), now, limit) }))
    .filter((x) => x.pending > 0 && x.currency)
    .sort((a, b) => b.late - a.late || b.pending - a.pending);
}

/** Short name of the tax of the active projects ("IVA", "VAT"...): the common one, or '' when the markets use different names. */
export function globalTaxLabel(projects) {
  const names = new Set(arr(projects).filter(isActiveProject).map((p) => getRegion(p?.draft?.regionCode)?.taxName).filter(Boolean));
  return names.size === 1 ? [...names][0] : '';
}
