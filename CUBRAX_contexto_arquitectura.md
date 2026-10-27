# CUBRAX — Contexto de arquitectura y UX (extracto para consultor externo)

Stack: React 18 + Vite 5 + Tailwind 3, PWA, OLED negro puro. Persistencia local-first en **IndexedDB** (base `obrax`).
Los imports genéricos de React se omiten; se conservan los imports internos para ver dependencias.

## Índice

1. Modelo de datos y persistencia (IndexedDB)
2. Lógica de estados de tiempo (semáforo)
3. Dashboard / lista de proyectos (contadores + tarjetas)
4. Tarjeta de proyecto (Card)
5. Vista detallada de proyecto ("ficha")
6. Anexo: textos i18n de los estados y flujo de datos

---

## Mapa rápido de flujo de datos

```
IndexedDB (obrax.projects)  <->  projectStore (db.js / projectStore.js)
        |  normalizeProject() valida TODO lo que se lee/escribe
        v
App.jsx: projects[] (estado React)  --activeId-->  proyecto abierto
        |  setDraft()/setProject() actualizan updatedAt
        |  efecto con debounce 250 ms + flush en pagehide/visibilitychange -> projectStore.save()
        v
Dashboard  --projectLevel()/sortProjects()-->  contadores + ProjectCard
ProjectCard / ProjectView --computeAll(draft, ...)--> total del presupuesto (quote.total)
```

Claves de diseño a tener en cuenta:
- Un **Proyecto** = un trabajo de un cliente. Contiene `startDate`/`endDate` (YYYY-MM-DD, días de calendario local), `closedAt` (0 = activo; >0 = Historial), `company` (copia congelada del perfil), `location`, y los libros `payments`, `advances`, `expenses`, `logbook`, más el `draft` (cliente/nombre, partidas, finanzas, firma, congelado).
- **No existe un campo `status` persistido**: el estado (futuro / a tiempo / por vencer / atrasado / cerrado) se **deriva** siempre de fechas + `closedAt` + "ahora".
- El **total** de la tarjeta no se guarda: se recalcula con el motor (`computeAll`) a partir del `draft` y la ventana de mercado de 15 min.
- Fotos viven en otro store (`project_photos`, clave `"<projectId>:<slot>"`), no dentro del registro del proyecto.

---

# 1. Modelo de datos y persistencia

### `src/lib/db.js` — Esquema de la base IndexedDB y runner de transacciones

```js
// One IndexedDB database ("obrax") shared by photos, projects and the company logo.
//
// v1 had a single store, `photos` (keyPath: slot) holding the photos of the one and only project.
// v2 keeps that store untouched (so its rows can be migrated) and adds:
//   project_photos  keyPath `key` = "<projectId>:<slot>"   photos scoped per project
//   projects        keyPath `id`                           one record per client job
//   company         keyPath `key`                          company logo (base64)
// v3 adds:
//   prices          keyPath `region`                       last known price book of each region (priceStore.js)

export const DB_NAME = 'obrax';
export const DB_VERSION = 3;
export const STORE_LEGACY_PHOTOS = 'photos';
export const STORE_PHOTOS = 'project_photos';
export const STORE_PROJECTS = 'projects';
export const STORE_COMPANY = 'company';
export const STORE_PRICES = 'prices';

export function openDb(factory) {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const has = (n) => db.objectStoreNames.contains(n);
      if (!has(STORE_PHOTOS)) db.createObjectStore(STORE_PHOTOS, { keyPath: 'key' });
      if (!has(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      if (!has(STORE_COMPANY)) db.createObjectStore(STORE_COMPANY, { keyPath: 'key' });
      if (!has(STORE_PRICES)) db.createObjectStore(STORE_PRICES, { keyPath: 'region' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close(); // never block an upgrade from another tab
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

/** Small promise wrapper: run(storeName, mode, (store) => request | void) -> request result. */
export function createRunner(factory) {
  let dbPromise;
  const open = () => (dbPromise ??= openDb(factory));
  return async function run(storeName, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
}

export const hasIndexedDb = () => typeof indexedDB !== 'undefined' && Boolean(indexedDB);
```

### `src/lib/projectStore.js` — Backend IndexedDB + fallback en memoria + store de proyectos

```js
// Project persistence: IndexedDB store `projects` (one record per client job, company snapshot and
// draft included), memory fallback when IndexedDB is unavailable.

import { STORE_PROJECTS, createRunner, hasIndexedDb } from './db.js';
import { normalizeProject, normalizeProjects } from './projects.js';

export function memoryProjectBackend() {
  const map = new Map();
  return {
    kind: 'memory',
    async getAll() {
      return [...map.values()];
    },
    async put(p) {
      map.set(p.id, p);
    },
    async remove(id) {
      map.delete(id);
    },
  };
}

export function idbProjectBackend(factory) {
  const run = createRunner(factory);
  return {
    kind: 'indexeddb',
    getAll: () => run(STORE_PROJECTS, 'readonly', (s) => s.getAll()),
    put: (p) => run(STORE_PROJECTS, 'readwrite', (s) => s.put(p)),
    remove: (id) => run(STORE_PROJECTS, 'readwrite', (s) => s.delete(id)),
  };
}

export function createProjectStore(primary = null) {
  const fallback = memoryProjectBackend();
  let backend = primary || fallback;
  const guard = async (op, ...args) => {
    try {
      return await backend[op](...args);
    } catch {
      if (backend === fallback) throw new Error('project store unavailable');
      backend = fallback;
      return fallback[op](...args);
    }
  };
  return {
    get kind() {
      return backend.kind;
    },
    /** All stored projects, validated, newest first (display order is decided by the dashboard). */
    async load() {
      const list = normalizeProjects(await guard('getAll'));
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async save(project) {
      const clean = normalizeProject(project);
      if (!clean) throw new Error('invalid project');
      await guard('put', clean);
      return clean;
    },
    remove: (id) => guard('remove', id),
  };
}

export const projectStore = createProjectStore(hasIndexedDb() ? idbProjectBackend(indexedDB) : null);
```

### `src/lib/projects.js` (líneas 1-18) — Modelo Proyecto: newProject / normalizeProject (esquema) y helpers de fecha

Constantes, límites y ID.

```js
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
```

### `src/lib/projects.js` (líneas 19-39)

Utilidades de fechas (días de calendario locales, a prueba de DST).

```js
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
```

### `src/lib/projects.js` (líneas 98-130) — Instantánea de empresa por proyecto

```js
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
```

### `src/lib/projects.js` (líneas 131-197) — Modelo de proyecto: creación, validación y helpers de tarjeta

```js
// ---- project model --------------------------------------------------------------------------------------
export function newProject({ regionCode, mode = 'quick', company = null, logo = '', name = '', client = '', startDate = '', endDate = '', location = null, now = Date.now() }) {
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
    payments: [],
    advances: [],
    expenses: [],
    logbook: [],
    draft,
  };
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
```

Forma de un registro `Project` (resumen):

```js
{
  id: string,            // /^[a-z0-9]{6,24}$/
  createdAt: number,     // ms epoch
  updatedAt: number,     // ms epoch (lo actualiza App.jsx en cada edición)
  startDate: 'YYYY-MM-DD' | '',
  endDate:   'YYYY-MM-DD' | '',   // se descarta si es anterior a startDate
  closedAt:  number,     // 0 = activo; >0 = finalizado (pestaña Historial)
  company:  { name, taxId, phone, email, city, proName, proTaxId, signature, logo },  // snapshot inmutable
  location: { lat, lng, label } | null,
  payments: [{ id, amount, at, note }],                 // abonos del cliente
  advances: [{ id, worker, amount, at }],               // adelantos a trabajadores
  expenses: [{ id, at, supplier, description, amount, category, returnDate, returned }],
  logbook:  [{ id, at, text }],                         // bitácora
  draft:    { ... }  // ver abajo: cliente, partidas, finanzas, firma, congelado
}
```

### `src/lib/ledger.js` — Sub-registros del proyecto (pagos, adelantos, gastos, bitácora, ubicación) y números derivados

```js
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
    return text ? { id: idOf(p.id, used), at: stamp(p.at), text } : null;
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
```

### `src/lib/draft.js` (líneas 23-31) — Constantes del borrador (límites financieros)

```js
export const FINANCE_LIMITS = Object.freeze({
  labor: { min: 0, max: 150, step: 1, default: 35 },
  transport: { min: 0, max: 30, step: 1, default: 5 },
  contingency: { min: 0, max: 30, step: 1, default: 0 }, // Imprevistos: % over direct costs (0 keeps every older quote identical)
  profit: { min: 0, max: 100, step: 1, default: 0 }, // Utilidad: % over direct costs + contingency
});
export const TAX_LIMITS = Object.freeze({ min: 0, max: 50, decimals: 2 });
export const MAX_PARTIDAS = 30;
export const MODES = Object.freeze(['quick', 'project']);
```

### `src/lib/draft.js` (líneas 108-221) — Borrador del proyecto: newPartida / newDraft / normalizePartida / normalizeDraft

```js
// ---- draft (project in progress) -------------------------------------------
const ID_RE = /^[a-z0-9]{1,16}$/;
export const newPartidaId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export function newPartida(task = 'slab') {
  return { id: newPartidaId(), name: '', task, dims: defaultDims(task), waste: TASKS[task].defaultWaste };
}

export function newDraft(regionCode, mode = 'quick') {
  const region = getRegion(regionCode);
  return {
    mode,
    step: 0,
    project: { name: '', client: '' },
    partidas: mode === 'quick' ? [newPartida('slab')] : [],
    finance: { labor: FINANCE_LIMITS.labor.default, transport: FINANCE_LIMITS.transport.default, contingency: FINANCE_LIMITS.contingency.default, profit: FINANCE_LIMITS.profit.default, tax: null },
    chainId: 'best',
    overrides: {},
    attachPhotos: true, // the field photos are printed on the client budget too (always in the technical dossier); the user can opt out
    photosChoice: false, // true once the user has touched that switch: only then is `attachPhotos` taken literally
    showBreakdown: false, // client PDF also lists the Materials / Labor / Transport totals (never stores or unit prices)
    signature: null, // client signature + data, see lib/signature.js
    crew: SCHEDULE.defaultCrew, // workers on site (planning, see lib/schedule.js)
    crewAuto: true, // crew derived from the project deadline (when it has one); false = the manual `crew`
    machinery: { ...DEFAULT_MACHINERY, excluded: [] }, // major machinery rental: master switch + machines the user turned off
    frozen: null, // "Generar PDF" freezes the quote: market prices and project dates stop moving (see lib/signature.js)
    regionCode: region ? region.code : null,
  };
}

export function normalizePartida(obj, usedIds = new Set()) {
  if (!obj || typeof obj !== 'object') return null;
  const task = oneOf(obj.task, TASK_IDS, null);
  if (!task) return null;
  const def = TASKS[task];
  const dims = defaultDims(task);
  for (const f of def.fields) {
    const v = coerceNumber(obj.dims?.[f.key], { min: f.min, max: f.max, decimals: f.decimals, fallback: null });
    if (v !== null) dims[f.key] = v;
    else if (f.key === 'length' || f.key === 'width') dims[f.key] = null;
  }
  for (const o of def.options) dims[o.key] = pickOption(o, obj.dims?.[o.key]);
  let id = typeof obj.id === 'string' && ID_RE.test(obj.id) && !usedIds.has(obj.id) ? obj.id : newPartidaId();
  while (usedIds.has(id)) id = newPartidaId();
  usedIds.add(id);
  const waste = coerceNumber(obj.waste, { min: WASTE_LIMITS.min, max: WASTE_LIMITS.max, decimals: 0, fallback: null });
  return { id, name: sanitizeText(obj.name, 60).trim(), task, dims, waste: waste === null ? def.defaultWaste : waste };
}

/**
 * Machinery choices. A draft saved BEFORE machinery existed has none: unsigned ones get the suggestion
 * switched on, but a SIGNED quote keeps it off so its signed total is not altered behind the client's back.
 */
function normalizeMachinery(obj, signature) {
  if (!obj || typeof obj !== 'object') return { include: !signature, excluded: [] };
  const excluded = Array.isArray(obj.excluded) ? [...new Set(obj.excluded.filter((id) => MACHINE_IDS.includes(id)))] : [];
  return { include: obj.include !== false, excluded };
}

export function normalizeDraft(obj, regionCode) {
  const base = newDraft(regionCode);
  if (!obj || typeof obj !== 'object' || obj.regionCode !== regionCode) return base;
  const region = getRegion(regionCode);
  const mode = oneOf(obj.mode, MODES, 'quick');

  const used = new Set();
  let partidas = Array.isArray(obj.partidas)
    ? obj.partidas.slice(0, MAX_PARTIDAS).map((p) => normalizePartida(p, used)).filter(Boolean)
    : [];
  if (mode === 'quick') partidas = partidas.length ? partidas.slice(0, 1) : [newPartida('slab')];

  const finance = {};
  for (const [k, lim] of Object.entries(FINANCE_LIMITS)) {
    finance[k] = coerceNumber(obj.finance?.[k], { min: lim.min, max: lim.max, decimals: 0, fallback: null });
    if (finance[k] === null) finance[k] = lim.default;
  }
  // Tax rate is only user-adjustable where there is no single national rate (US, CA, BR).
  finance.tax = region.taxEditable
    ? coerceNumber(obj.finance?.tax, { ...TAX_LIMITS, fallback: null })
    : null;

  const chainId =
    obj.chainId === 'best' || region.chains.some((c) => c.id === obj.chainId) ? obj.chainId : 'best';

  const overrides = {};
  if (obj.overrides && typeof obj.overrides === 'object') {
    for (const id of MATERIAL_IDS) {
      const v = coerceNumber(obj.overrides[id], { min: 0.000001, max: MAX_PRICE, decimals: 2, fallback: null });
      if (v !== null) overrides[id] = v;
    }
  }

  const signature = normalizeSignature(obj.signature);
  const photosChoice = obj.photosChoice === true;
  return {
    mode,
    step: Math.min(4, Math.max(0, Number.isInteger(obj.step) ? obj.step : 0)),
    project: { name: sanitizeText(obj.project?.name, 80), client: sanitizeText(obj.project?.client, 80) },
    partidas,
    finance,
    chainId,
    overrides,
    // drafts saved before the choice existed carry the old default (false): photos are on unless the user switched them off
    attachPhotos: photosChoice ? obj.attachPhotos !== false : true,
    photosChoice,
    showBreakdown: obj.showBreakdown === true,
    signature,
    crew: coerceNumber(obj.crew, { min: SCHEDULE.minCrew, max: SCHEDULE.maxCrew, decimals: 0, fallback: SCHEDULE.defaultCrew }),
    crewAuto: obj.crewAuto !== false,
    machinery: normalizeMachinery(obj.machinery, signature),
    frozen: normalizeFrozen(obj.frozen),
    regionCode,
  };
}
```

### `src/lib/signature.js` (líneas 170-216) — Fechas congeladas y firma: qué línea de tiempo/precio usa un presupuesto

```js

/**
 * The simulated market prices move every 15 minutes, so a signed total would drift away from what the
 * client accepted. While a signature exists the quote is therefore priced at the moment it was signed;
 * removing the signature releases the prices again.
 */
export const pricingTime = (draft, now) => draft?.signature?.pricedAt || draft?.frozen?.pricedAt || now;

/**
 * The project dates the crew / rental plan is computed with. A signed quote is FROZEN: it keeps the dates it
 * was signed with (stamped by `freezeSignature`), so editing the project's dates afterwards cannot change its
 * crew, rentals or total. A signature that predates the stamp plans without dates (the legacy behaviour).
 * Unsigned quotes follow the live project dates. Removing the signature releases the plan.
 */
export function planningTimeline(draft, live = {}) {
  const sig = draft?.signature;
  if (!sig) {
    if (draft?.frozen) return draft.frozen.timeline; // "Generar PDF" froze it with the dates of that moment
    return { startDate: live?.startDate || '', endDate: live?.endDate || '' };
  }
  return sig.timeline ?? { startDate: '', endDate: '' };
}

/**
 * The frozen quote ("Generar PDF"): { at, pricedAt, total, timeline, book? }. While it exists the market clock and the
 * project dates are ignored by the quote (same guarantee a client signature gives, but without the client).
 */
export function normalizeFrozen(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const at = Number(obj.at);
  const pricedAt = Number(obj.pricedAt);
  const total = Number(obj.total);
  if (!Number.isFinite(pricedAt) || pricedAt <= 0) return null;
  return {
    at: Number.isFinite(at) && at > 0 ? at : pricedAt,
    pricedAt,
    total: Number.isFinite(total) && total >= 0 ? total : 0,
    timeline: normalizeTimeline(obj.timeline) ?? { startDate: '', endDate: '' },
    ...(lockedBook(obj.book) ? { book: lockedBook(obj.book) } : {}),
  };
}

/** Freeze the quote now: prices at `pricedAt`, project dates as they are. A signed quote is already frozen by its signature. */
export function freezeQuote(draft, { pricedAt, total = 0, live = {}, now = Date.now(), book = null }) {
  if (draft.frozen) return draft;
  return { ...draft, frozen: normalizeFrozen({ at: now, pricedAt, total, timeline: normalizeTimeline(live), book }) };
}
```

### `src/App.jsx` (líneas 200-265) — Cómo App.jsx persiste (debounce + flush) y actualiza updatedAt

```js

  // ---- persistence of the open project (debounced) + flush when the page is hidden --------------------
  useEffect(() => {
    if (!active) return undefined;
    const id = setTimeout(() => !wipingRef.current && projectStore.save(active).catch(() => {}), 250);
    return () => clearTimeout(id);
  }, [active]);
  // `pagehide` alone is not reliable on mobile / installed PWAs (the OS often freezes or kills the page without it):
  // `visibilitychange -> hidden` is the last event that is guaranteed to run, so the open project is also flushed there.
  useEffect(() => {
    const flush = () => activeRef.current && !wipingRef.current && projectStore.save(activeRef.current).catch(() => {});
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // ---- project actions -------------------------------------------------------------------------------------
  const commit = useCallback((project) => {
    setProjects((list) => (list.some((p) => p.id === project.id) ? list.map((p) => (p.id === project.id ? project : p)) : [project, ...list]));
    projectStore.save(project).catch(() => {});
  }, []);

  const openProject = useCallback((id) => {
    setActiveId(id);
    setEditor(false);
    setPhotos(emptySlots());
    photoStoreFor(id)
      .load()
      .then((p) => activeRef.current?.id === id && setPhotos(p))
      .catch(() => {});
    window.scrollTo({ top: 0 });
  }, []);

  const closeProject = useCallback(() => {
    if (activeRef.current) projectStore.save(activeRef.current).catch(() => {});
    setActiveId(null);
    setEditor(false);
    setPhotos(emptySlots());
  }, []);

  // The open project's draft: all wizard / project-view edits flow through here.
  const setDraft = useCallback(
    (update) =>
      setProjects((list) =>
        list.map((p) => {
          if (p.id !== activeId) return p;
          const draft = typeof update === 'function' ? update(p.draft) : update;
          return draft === p.draft ? p : { ...p, draft, updatedAt: Date.now() };
        })
      ),
    [activeId]
  );
  // The open project itself (payments, advances, expenses, logbook...).
  const setProject = useCallback(
    (update) =>
      setProjects((list) =>
        list.map((p) => {
          if (p.id !== activeId) return p;
          const next = typeof update === 'function' ? update(p) : update;
          return next === p ? p : { ...next, updatedAt: Date.now() };
        })
      ),
```


---

# 2. Lógica de estados de tiempo

Reglas acordadas: **verde** = a tiempo; **naranja** = quedan ≤ 3 días **o** ≤ 20 % del cronograma (incluye "vence hoy");
**rojo** = pasada la fecha de término (`daysLate` = días de atraso); **azul / `future`** = aún no inicia (`daysUntilStart`).
Un trabajo iniciado **sin fecha de término** cuenta como *a tiempo* (verde). Un proyecto cerrado (`closedAt > 0`) pasa a `closed` (gris) en la UI.
Todo es **puro** (sin React) y recibe `now` por parámetro → testeable.

### `src/lib/projects.js` (líneas 1-97) — trafficLight / projectLevel / sortProjects / isClosed

```js
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
```

### `src/components/levelStyle.js` — Colores por estado y texto de detalle ("Atraso de 5 d", "Vence hoy", "Inicia en 3 d", "Faltan 12 d")

```js
// Colour of every project state (traffic light + "future" + finished). Used by the dashboard pills, the card's
// thick bottom border and the status pill inside a project, so the whole app speaks one colour language.
export const LEVEL_COLOR = Object.freeze({
  red: '#ff2b2b',
  orange: '#ff9500',
  green: '#00d95f',
  future: '#2d8cff',
  none: '#525252',
  closed: '#737373',
});

/** The state text of a project ("Atraso de 5 d", "Vence hoy", "Inicia en 3 d", "Faltan 12 d"); '' when there is nothing to say. */
export function levelDetail(t, info) {
  if (info.level === 'red') return t('light.late', { n: info.daysLate });
  if (info.level === 'future') return t('light.starts', { n: info.daysUntilStart });
  const left = info.light?.daysLeft;
  if (left === null || left === undefined) return t('light.none'); // no end date: nothing to count down
  if (info.level === 'orange' || info.level === 'green') return left === 0 ? t('light.today') : t('light.daysLeft', { n: left });
  return '';
}
```

### `src/components/TrafficLight.jsx` — Semáforo en forma de píldora (usado en otras vistas)

```js
import { useI18n } from '../lib/i18n.jsx';

const DOT = {
  green: { background: '#22c55e', boxShadow: '0 0 10px 1px rgba(34,197,94,0.55)' },
  orange: { background: '#f97316', boxShadow: '0 0 10px 1px rgba(249,115,22,0.55)' },
  red: { background: '#ef4444', boxShadow: '0 0 10px 1px rgba(239,68,68,0.6)' },
  none: { background: 'transparent', boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.4)' },
};

/** Time traffic light: coloured dot + text (never colour alone). `light` comes from trafficLight(). */
export default function TrafficLight({ light }) {
  const { t } = useI18n();
  const { level, daysLeft } = light;
  let detail = '';
  if (level === 'red') detail = t('light.late', { n: Math.abs(daysLeft) });
  else if (level !== 'none') detail = daysLeft === 0 ? t('light.today') : t('light.daysLeft', { n: daysLeft });
  const label = t(`light.${level}`);
  return (
    <span
      role="img"
      aria-label={`${t('light.label')}: ${label}${detail ? `, ${detail}` : ''}`}
      data-level={level}
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-sm font-bold"
    >
      <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full" style={DOT[level]} />
      <span aria-hidden="true" className="truncate">
        {label}
        {detail && <span className="font-medium text-neutral-300"> · {detail}</span>}
      </span>
    </span>
  );
}
```

### `src/lib/schedule.js` (líneas 146-218) — Planificación de cuadrilla ligada a startDate/endDate (no es el semáforo, pero consume las mismas fechas)

```js
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
```


---

# 3. Dashboard / lista de proyectos

### `src/components/Dashboard.jsx` — Contadores globales (4 triángulos de advertencia), pestañas Activos/Historial y mapeo de tarjetas

```js
import { useI18n } from '../lib/i18n.jsx';
import { isClosed, projectLevel, sortProjects } from '../lib/projects.js';
import { usePro } from '../lib/usePro.js';
import { Logo, Wordmark } from './ui.jsx';
import HelmetIcon from './HelmetIcon.jsx';
import { LEVEL_COLOR } from './levelStyle.js';
import ProjectCard from './ProjectCard.jsx';
import ProQaTag from './ProQaTag.jsx';

/** Re-render once a minute (and when the tab becomes visible) so the traffic lights never go stale. */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, intervalMs);
    const onVis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [intervalMs]);
  return now;
}

const EMPTY_TRIANGLE = '#737373'; // neutral grey for a counter that is 0

const PILLS = [
  ['red', 'pill.late'],
  ['orange', 'pill.soon'],
  ['green', 'pill.ok'],
  ['future', 'pill.future'],
];

/**
 * Main view. Header (logo + "Proyectos" on one line, a discreet PRO badge), four colour counters instead of a
 * sentence, the Activos / Historial tabs and one full-width card per job. "Nuevo proyecto" is the FAB.
 */
export default function Dashboard({ projects, tab, onTab, onNew, onOpen, onPro }) {
  const pro = usePro();
  const { t } = useI18n();
  const now = useNow();

  const { active, history } = useMemo(() => {
    const a = [];
    const h = [];
    for (const p of projects) (isClosed(p) ? h : a).push(p);
    return { active: sortProjects(a, now), history: [...h].sort((x, y) => y.closedAt - x.closedAt) };
  }, [projects, now]);

  const counts = useMemo(() => {
    const c = { red: 0, orange: 0, green: 0, future: 0 };
    for (const p of active) {
      const level = projectLevel(p, now).level;
      if (level in c) c[level] += 1;
    }
    return c;
  }, [active, now]);

  const shown = tab === 'history' ? history : active;

  return (
    <main className="mx-auto w-full max-w-3xl px-3 pb-44 pt-3 sm:px-4">
      <header className="mb-2 flex items-center gap-3">
        {/* isotype (32 px tall) + name, aligned on one line */}
        <Logo size={32} />
        <span className="sr-only">{t('app.name')}</span>
        <span className="flex min-w-0 flex-1 items-center">
          <Wordmark height={16} />
        </span>
        {/* PRO: always a real button that opens the plans screen (also when PRO is already active). Gold hard hat on top. */}
        <button
          type="button"
          onClick={() => onPro()}
          data-testid={pro ? 'pro-active' : 'pro-scan'}
          data-pro={pro ? 'true' : undefined}
          aria-label={pro ? t('pro.active') : t('pro.cta')}
          className={`flex min-h-[52px] min-w-[52px] flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-1 transition-shadow duration-200 hover:shadow-[0_0_14px_rgba(212,175,55,0.5)] focus-visible:shadow-[0_0_14px_rgba(212,175,55,0.5)] active:shadow-[0_0_18px_rgba(232,195,95,0.6)] ${
            pro ? 'border-[#d4af37]/60 text-[#e8c35f]' : 'border-white/15 text-white/60 hover:border-[#d4af37]/70 hover:text-[#e8c35f]'
          }`}
        >
          <HelmetIcon size={28} />
          <span className="text-[11px] font-extrabold leading-none tracking-widest">PRO</span>
        </button>
      </header>
      <h1 className="mb-1 truncate text-2xl font-extrabold tracking-tight">{t('nav.projects')}</h1>
      <p className="mb-3 min-h-[12px]">
        <ProQaTag />
      </p>

      {active.length > 0 && (
        <ul className="mb-3 flex items-center justify-around" data-testid="dash-pills" aria-label={t('light.label')}>
          {PILLS.map(([level, key]) => {
            const n = counts[level];
            const color = LEVEL_COLOR[level];
            // zero state: an EMPTY, dimmed outline (no number, neutral colour, low opacity) so it does not compete for attention
            const stroke = n > 0 ? color : EMPTY_TRIANGLE;
            return (
              <li key={level} data-testid={`pill-${level}`} data-count={n} data-empty={n > 0 ? undefined : 'true'} aria-label={`${t(key)}: ${n}`} title={t(key)} className="relative block h-[54px] w-[60px]">
                {/* warning-sign triangle: transparent / OLED black inside; vivid state colour + number when > 0, empty and dimmed at 0 */}
                <svg viewBox="0 0 60 54" className="absolute inset-0 h-full w-full" aria-hidden="true" focusable="false" style={n > 0 ? { filter: `drop-shadow(0 0 5px ${color}66)` } : undefined}>
                  <polygon points="30,3 57,51 3,51" fill="none" stroke={stroke} strokeWidth="2" strokeOpacity={n > 0 ? 1 : 0.28} strokeLinejoin="round" data-testid={`tri-${level}`} />
                </svg>
                {n > 0 && (
                  <span aria-hidden="true" className="absolute inset-x-0 top-[25px] text-center text-xl font-black leading-none tabular-nums" style={{ color }}>
                    {n}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div role="tablist" aria-label={t('nav.projects')} className="mb-3 grid grid-cols-2 border-b border-white/10">
        {[
          ['active', 'dash.tab.active', active.length],
          ['history', 'dash.tab.history', history.length],
        ].map(([id, key, n]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            data-testid={`tab-${id}`}
            onClick={() => onTab(id)}
            className={`min-h-[48px] border-b-2 text-base font-bold transition ${tab === id ? 'border-brand text-white' : 'border-transparent text-neutral-400 hover:text-white'}`}
          >
            {t(key)} <span className="text-sm font-semibold text-neutral-400">{n}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="mt-10 text-center text-neutral-400" data-testid="dash-empty">
          {t(tab === 'history' ? 'dash.empty.history' : 'dash.empty.active')}
        </p>
      ) : (
        <ul className="space-y-3" aria-label={t(tab === 'history' ? 'dash.tab.history' : 'dash.tab.active')}>
          {shown.map((p) => (
            <ProjectCard key={p.id} project={p} now={now} onOpen={() => onOpen(p.id)} />
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onNew}
        data-testid="fab-new"
        aria-label={t('dash.new')}
        className="no-print fixed right-4 z-30 flex h-16 w-16 items-center justify-center rounded-full bg-brand text-black shadow-[0_0_24px_rgba(34,197,94,0.35)] transition active:scale-95 [bottom:calc(5.5rem+env(safe-area-inset-bottom))]"
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </main>
  );
}
```


---

# 4. Tarjeta de proyecto (Card)

### `src/components/ProjectCard.jsx` — Toda la tarjeta es el botón; borde inferior = color de estado; detalle de días; total; reloj de arena si hay alquiler por devolver

```js
import { useI18n, makeI18n } from '../lib/i18n.jsx';
import { computeAll } from '../lib/engine.js';
import { pricingTime, planningTimeline } from '../lib/signature.js';
import { marketBucket } from '../lib/pricing.js';
import { getRegion } from '../lib/regions.js';
import { usePriceBook } from '../lib/usePrices.js';
import { hasRentalDue } from '../lib/ledger.js';
import { isClosed, projectClient, projectLevel, projectTitle } from '../lib/projects.js';
import { LEVEL_COLOR, levelDetail } from './levelStyle.js';
import Hourglass from './Hourglass.jsx';

/**
 * One client job, full width. The WHOLE card is the button (no Open / Edit buttons): a hairline neutral outline and a
 * slightly thicker bottom border that is the ONLY thing carrying the state colour, plus the country flag, the days
 * that matter and an hourglass when a rented tool is due back today.
 */
export default function ProjectCard({ project, now, onOpen }) {
  const { t, lang } = useI18n();
  const region = getRegion(project.draft.regionCode);
  const closed = isClosed(project);
  const info = projectLevel(project, now);
  const level = closed ? 'closed' : info.level;
  const detail = closed ? t('proj.closed') : levelDetail(t, info);
  const rentalDue = !closed && hasRentalDue(project, now);

  // Same inputs as the project screen; it re-prices whenever the market window rolls over (15 min) or the day changes.
  const priceTime = pricingTime(project.draft, now);
  const bucket = marketBucket(priceTime);
  const day = new Date(priceTime).toDateString();
  const book = usePriceBook(project.draft.regionCode);
  const total = useMemo(() => {
    const r = computeAll(project.draft, priceTime, { timeline: planningTimeline(project.draft, project), book, chains: false });
    return r.valid ? makeI18n(lang, project.draft.regionCode).money(r.quote.total) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.draft, project.startDate, project.endDate, lang, bucket, day, book]);

  const title = projectTitle(project) || t('proj.untitled');
  const client = projectClient(project);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid="project-card"
        data-level={level}
        aria-label={[title, client, detail].filter(Boolean).join(', ')}
        style={{ borderBottomColor: LEVEL_COLOR[level] }}
        className="block w-full rounded-2xl border border-b-[3px] border-white/10 bg-transparent p-4 text-left transition active:bg-white/[0.04]"
      >
        <span className="flex items-start gap-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-extrabold">{title}</span>
            {client && <span className="block truncate text-sm text-neutral-300">{client}</span>}
          </span>
          {rentalDue && <Hourglass label={t('rental.dueToday')} />}
          <span className="text-base leading-none" aria-hidden="true" data-testid="card-flag">
            {region?.flag}
          </span>
        </span>
        <span className="mt-3 flex items-end justify-between gap-3">
          <span
            data-testid="card-detail"
            className={`text-sm font-bold text-neutral-300 ${level === 'red' ? 'text-base' : ''}`}
          >
            {detail}
          </span>
          {total && <span className="text-base font-extrabold tabular-nums">{total}</span>}
        </span>
      </button>
    </li>
  );
}
```

### `src/lib/projectTotals.js` — Total para listados (misma regla que la pantalla del proyecto)

```js
// Budget total (tax included) of a project at a given moment, with exactly the rules the project screens use:
// frozen / signed quotes keep their price time and dates; the rest follow the live market window and dates.

import { computeAll } from './engine.js';
import { planningTimeline, pricingTime } from './signature.js';

/** Total with tax, or null while the project has no valid measures yet. */
export function projectTotal(project, now = Date.now()) {
  const r = computeAll(project.draft, pricingTime(project.draft, now), { timeline: planningTimeline(project.draft, project), chains: false });
  return r.valid ? r.quote.total : null;
}

export function projectTotals(projects, now = Date.now()) {
  return new Map(projects.map((p) => [p.id, projectTotal(p, now)]));
}
```

### `src/lib/engine.js` — Punto de entrada del cálculo: draft -> validación -> cómputo -> cronograma -> maquinaria -> cotización

```js
import { validateDims, runCalculation } from './tasks.js';
import { resolvePrices, buildQuote, chainTotals, marketBucket, planAll } from './pricing.js';
import { planProject } from './schedule.js';
import { planMachinery, DEFAULT_MACHINERY } from './machinery.js';
import { effectiveBook } from './priceBook.js';
import { currentBook } from './priceRegistry.js';

/**
 * Single entry point used by the UI: draft -> validation per partida, takeoff, ONE consolidated
 * purchase plan, prices and quote.
 *
 *  - quick mode:   exactly one partida
 *  - `chains: false` skips the per-chain comparison (one extra quote per store chain): lists, cards and totals only
 *    need `valid` and `quote`, so they ask for the light result.
 *  - project mode: any number of partidas; shared materials (e.g. cement bags from a slab and a wall)
 *                  are summed into a single purchase line before rounding to whole sale units.
 */
export function computeAll(draft, now = Date.now(), { timeline = null, book: liveBook, chains = true } = {}) {
  const partidas = draft.partidas.map((p) => {
    const validation = validateDims(p.task, p.dims);
    return {
      id: p.id,
      name: p.name,
      task: p.task,
      waste: p.waste,
      validation,
      values: validation.values,
      calc: validation.valid ? runCalculation(p.task, validation.values) : null,
    };
  });

  const valid = partidas.length > 0 && partidas.every((p) => p.validation.valid);
  if (!valid) {
    return { valid: false, partidas, validation: partidas[0]?.validation ?? { values: {}, errors: {}, valid: false } };
  }

  const bucket = marketBucket(now);
  // Live market prices (price service) when there are any; a signed / frozen quote keeps the book it was agreed with.
  const book = effectiveBook(draft, liveBook !== undefined ? liveBook : currentBook(draft.regionCode));
  const inputs = partidas.map((p) => ({ lines: p.calc.lines, waste: p.waste }));
  const plan = planAll(inputs);
  const prices = resolvePrices({
    ids: plan.map((i) => i.id),
    regionCode: draft.regionCode,
    chainId: draft.chainId,
    overrides: draft.overrides,
    bucket,
    book,
  });
  // Crew plan (HH vs dead technical time, crew derived from the project's deadline unless set by hand) and
  // the major machinery it implies (rented per day of use, at the same 15-minute market window as materials).
  const schedule = planProject(partidas, draft, timeline, now);
  const machinery = planMachinery({ partidas, schedule, regionCode: draft.regionCode, config: draft.machinery ?? DEFAULT_MACHINERY, bucket, book });
  const quote = buildQuote({ partidas: inputs, plan, prices, finance: draft.finance, regionCode: draft.regionCode, machinery });
  const totals = !chains ? null : chainTotals({
    partidas: inputs,
    regionCode: draft.regionCode,
    overrides: draft.overrides,
    bucket,
    book,
  });
  return {
    valid: true,
    mode: draft.mode,
    partidas,
    validation: partidas[0].validation,
    prices,
    quote,
    schedule,
    machinery,
    chainTotals: totals,
    book, // the price book that priced this quote (null = built-in reference prices)
  };
}
```


---

# 5. Vista detallada de proyecto ("ficha")

Orden vertical actual: (1) identidad + estado + lápiz de edición, bloque de ubicación → (2) dinero: presupuesto y barra de caja
→ (3) sliders de Mano de Obra / Imprevistos / Utilidad (+ adelantos) → (4) botón de escáner IA de boletas → (5) insumos y gastos
→ (6) fotos (Tap-to-Snap) → (7) bitácora con dictado por voz → exportar rendición → barra fija inferior "Generar PDF".
El cálculo técnico (medidas, partidas, precios, cronograma) vive en un **editor aparte** (`onEditor`), no en esta ficha.

### `src/components/ProjectView.jsx`

```js
import { useMarketClock } from '../lib/marketClock.js';
import { useI18n } from '../lib/i18n.jsx';
import { computeAll } from '../lib/engine.js';
import { pricingTime, planningTimeline, freezeQuote } from '../lib/signature.js';
import { FINANCE_LIMITS } from '../lib/draft.js';
import { LEDGER_LIMITS, cashSummary, dayOf, laborPool, locationLabel, newEntryId, rentalsDue, RENTAL_CATEGORIES } from '../lib/ledger.js';
import { isClosed, parseDay, projectClient, projectLevel, projectTitle, toDayString } from '../lib/projects.js';
import { buildRenditionFile } from '../lib/rendition.js';
import { photosForReport } from '../lib/photos.js';
import { createReportPdf, pdfToFile, warmPdfEngine } from '../lib/reportPdf.js';
import { shareOrDownload } from '../lib/shareFile.js';
import { sanitizeText } from '../lib/sanitize.js';
import { createDictation, getSpeechRecognition } from '../lib/speech.js';
import { useAiAccess } from '../lib/usePro.js';
import { usePriceBook, usePriceFeed } from '../lib/usePrices.js';
import { Button, DateInput, NumberField, TextField } from './ui.jsx';
import { LEVEL_COLOR, levelDetail } from './levelStyle.js';
import PercentSlider from './PercentSlider.jsx';
import CashSheet from './CashSheet.jsx';
import ReceiptSheet from './ReceiptSheet.jsx';
import SnapGrid from './SnapGrid.jsx';
import Hourglass from './Hourglass.jsx';

const Icon = ({ children, size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="mt-6">
      <h2 id={id} className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Hidden accordion: cash advanced to workers, discounted from the labour pool that stays visible above it. */
function Advances({ advances, onChange, pool }) {
  const { t, money, region, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [worker, setWorker] = useState('');
  const [amount, setAmount] = useState(null);
  const [date, setDate] = useState(() => toDayString(new Date())); // today, editable
  const stamp = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms)) : '');
  const add = (e) => {
    e.preventDefault();
    if (!worker.trim() || !(amount > 0) || advances.length >= LEDGER_LIMITS.advances) return;
    const day = parseDay(date);
    // the chosen day at local noon (so it never slips to another day with the time zone); today keeps the real time
    const at = day ? (date === toDayString(new Date()) ? Date.now() : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).getTime()) : Date.now();
    onChange([{ id: newEntryId(), worker: worker.trim(), amount, at }, ...advances]);
    setWorker('');
    setAmount(null);
    setDate(toDayString(new Date()));
  };
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="adv-panel"
        onClick={() => setOpen((v) => !v)}
        data-testid="advances-toggle"
        className="flex min-h-[48px] w-full items-center gap-2 rounded-xl border border-white/10 px-4 text-left text-sm font-bold text-neutral-200 transition hover:border-white/30"
      >
        <span className="flex-1">{t('adv.title')}</span>
        {pool.advanced > 0 && <span className="tabular-nums text-[#e8c35f]">−{money(pool.advanced)}</span>}
        <span aria-hidden="true" className={`text-lg text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}>
          ›
        </span>
      </button>
      {open && (
        <div id="adv-panel" className="mt-2 space-y-3 rounded-xl border border-white/10 p-4" data-testid="advances-panel">
          <form onSubmit={add} className="space-y-3">
            <TextField label={t('adv.worker')} value={worker} onChange={setWorker} sanitize={(v) => sanitizeText(v, 60)} placeholder={t('adv.workerPh')} />
            <NumberField label={t('adv.amount')} value={amount} onChange={setAmount} decimals={region.digits} placeholder="0" />
            <div>
              <label htmlFor="adv-date" className="label">
                {t('adv.date')}
              </label>
              <DateInput id="adv-date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="advance-date" />
            </div>
            <Button type="submit" className="w-full" disabled={!worker.trim() || !(amount > 0)} data-testid="advance-add">
              {t('adv.add')}
            </Button>
          </form>
          {advances.length > 0 && (
            <ul className="divide-y divide-white/10" data-testid="advance-list">
              {advances.map((a) => (
                <li key={a.id} className="flex min-h-[52px] items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{a.worker}</span>
                    <span className="block text-xs text-neutral-400">{stamp(a.at)}</span>
                  </span>
                  <span className="font-bold tabular-nums">{money(a.amount)}</span>
                  <button
                    type="button"
                    onClick={() => onChange(advances.filter((x) => x.id !== a.id))}
                    aria-label={`${t('common.delete')}: ${a.worker}`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-lg text-red-400 hover:border-red-500"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Bitácora con dictado por voz (Web Speech API): the microphone icon starts/stops the dictation, the words appear in the
 * text area WHILE you speak and, when the dictation ends, the note is saved by itself into the project (IndexedDB, through
 * the usual persistence of the open project). Typing and the "Guardar nota" button keep working.
 */
export function Logbook({ entries, onChange }) {
  const { t, lang, locale } = useI18n();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState(''); // i18n key of the status line
  const field = useRef(null);
  const dictation = useRef(null);
  // refs so the speech callbacks (created once per session) always see the latest values
  const textRef = useRef('');
  const entriesRef = useRef(entries);
  const changeRef = useRef(onChange);
  entriesRef.current = entries;
  changeRef.current = onChange;
  textRef.current = text;

  const commit = (raw) => {
    const clean = sanitizeText(raw, LEDGER_LIMITS.logChars).trim();
    if (!clean) return false;
    changeRef.current([{ id: newEntryId(), at: Date.now(), text: clean }, ...entriesRef.current].slice(0, LEDGER_LIMITS.logbook));
    setText('');
    textRef.current = '';
    return true;
  };
  const save = () => {
    setNote('');
    commit(text);
  };
  const supported = Boolean(getSpeechRecognition());
  const micIssue = ['log.dictateDenied', 'log.dictateUnsupported', 'log.dictateNetwork', 'log.dictateError'].includes(note); // shown as a visible red notice

  const toggleMic = () => {
    if (listening) {
      dictation.current?.stop();
      return;
    }
    if (!supported) {
      field.current?.focus();
      setNote('log.dictateUnsupported');
      return;
    }
    setNote('log.listening');
    dictation.current = createDictation({
      lang,
      locale,
      getBase: () => textRef.current,
      onText: (full) => setText(sanitizeText(full, LEDGER_LIMITS.logChars)),
      onActive: () => setNote('log.listening'), // the microphone is really open
      onEnd: (full) => {
        setListening(false);
        setNote(commit(full) ? 'log.autosaved' : ''); // end of the dictation = saved into the project
      },
      onError: (kind) => {
        setListening(false);
        setNote(
          kind === 'denied' ? 'log.dictateDenied' : kind === 'unsupported' ? 'log.dictateUnsupported' : kind === 'network' ? 'log.dictateNetwork' : 'log.dictateError',
        );
      },
    });
    if (dictation.current.start()) setListening(true);
  };
  // leaving the screen while dictating: close the session (its onEnd still saves what was said)
  useEffect(() => () => dictation.current?.stop(), []);

  const stamp = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) : '');
  return (
    <div className="space-y-3">
      {entries.length > 0 && (
        <ul className="space-y-2" data-testid="log-list">
          {entries.map((e) => (
            <li key={e.id} className="rounded-xl border border-white/10 px-4 py-3">
              <p className="text-xs font-semibold text-neutral-400">{stamp(e.at)}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{e.text}</p>
              <button
                type="button"
                onClick={() => onChange(entries.filter((x) => x.id !== e.id))}
                aria-label={`${t('common.delete')}: ${stamp(e.at)}`}
                className="mt-1 min-h-[36px] text-xs font-bold text-neutral-500 hover:text-red-400"
              >
                {t('common.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <textarea
          ref={field}
          value={text}
          onChange={(e) => setText(sanitizeText(e.target.value, LEDGER_LIMITS.logChars))}
          rows={3}
          lang={lang}
          inputMode="text"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          enterKeyHint="done"
          placeholder={t('log.placeholder')}
          aria-label={t('log.title')}
          data-testid="log-input"
          className="field-input min-h-[96px] resize-y pr-14"
        />
        <button
          type="button"
          onClick={toggleMic}
          aria-label={listening ? t('log.dictate.stop') : t('log.dictate')}
          aria-pressed={listening}
          data-testid="log-mic"
          data-listening={listening ? 'true' : 'false'}
          className={`absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full border transition active:scale-95 ${
            listening ? 'animate-pulse border-red-500 bg-red-500 text-white shadow-[0_0_16px_rgba(239,68,68,0.7)]' : 'border-white/15 text-brand hover:border-brand'
          }`}
        >
          {/* the microphone itself turns red and blinks while it listens; tap again to stop */}
          <Icon size={22}>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
          </Icon>
        </button>
      </div>
      {note && (
        <p
          role={micIssue ? 'alert' : 'status'}
          data-testid="log-mic-hint"
          data-kind={listening ? 'listening' : micIssue ? 'error' : 'info'}
          className={
            listening
              ? 'flex items-center gap-2 text-xs font-semibold text-red-400'
              : micIssue
                ? 'rounded-xl border border-red-500/60 px-3 py-2 text-sm font-semibold text-red-400'
                : 'text-xs text-neutral-300'
          }
        >
          {listening && <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />}
          {t(note)}
        </p>
      )}
      {text.trim() && !listening && (
        <Button className="w-full" onClick={save} data-testid="log-save">
          {t('log.save')}
        </Button>
      )}
    </div>
  );
}

/** Where the job is: the place as text plus two quick actions (open in the maps app / share it). Edited only from the pencil. */
function LocationBlock({ location }) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  const label = locationLabel(location);
  const url = location ? `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}` : '';
  const share = async () => {
    setNote('');
    const data = { title: label, text: label, url };
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share(data);
      } else if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setNote('copied');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') setNote('');
    }
  };
  return (
    <section aria-labelledby="pv-loc" className="card mt-4" data-testid="pv-location-block">
      <h2 id="pv-loc" className="text-xs font-bold uppercase tracking-wider text-neutral-400">
        {t('loc.title')}
      </h2>
      {location ? (
        <>
          <p data-testid="pv-location" className="mt-1.5 flex items-center gap-2 break-words text-sm text-neutral-200">
            <Icon size={18}>
              <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
              <circle cx="12" cy="10" r="2.5" />
            </Icon>
            <span className="min-w-0 flex-1">{label}</span>
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="loc-open"
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 border-brand px-3 text-sm font-bold text-brand transition hover:bg-brand/10 active:scale-[0.98]"
            >
              {t('loc.open')}
            </a>
            <button
              type="button"
              onClick={share}
              data-testid="loc-share"
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/15 px-3 text-sm font-bold text-white transition hover:border-white/40 active:scale-[0.98]"
            >
              {t('loc.share')}
            </button>
          </div>
          {note === 'copied' && (
            <p role="status" data-testid="loc-note" className="mt-2 text-xs text-neutral-300">
              {t('loc.copied')}
            </p>
          )}
        </>
      ) : (
        <p data-testid="pv-location-empty" className="mt-1.5 text-sm text-neutral-400">
          {t('loc.none')}
        </p>
      )}
    </section>
  );
}

/**
 * The inside of a project, top to bottom: identity + state + pencil, the money (budget + cash bar), the three
 * horizontal selectors (+ advances), the AI receipt scan, the supplies, Tap-to-Snap, the bitácora, the rendición and,
 * fixed at the base, "Generar PDF".
 */
export default function ProjectView({ project, setProject, setDraft, photos, setPhotos, company, onBack, onEdit, onEditor, onPro, prepareReceipt, fetchImpl }) {
  const i18n = useI18n();
  const { t, money, num, unit, region, locale } = i18n;
  const pro = useAiAccess(); // 'pro' | 'dev' (localhost bypass) | null
  const { now } = useMarketClock();
  const draft = project.draft;
  const [cashOpen, setCashOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(null); // 'pdf' | 'xlsx'
  const [note, setNote] = useState(''); // 'pdfError' | 'downloaded' | ''

  useEffect(() => {
    warmPdfEngine();
  }, []);

  const priceTime = pricingTime(draft, now);
  const timeline = planningTimeline(draft, project);
  usePriceFeed(draft.regionCode);
  const book = usePriceBook(draft.regionCode);
  const result = useMemo(
    () => computeAll(draft, priceTime, { timeline, book }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, priceTime, timeline.startDate, timeline.endDate, book]
  );
  const total = result.valid ? result.quote.total : 0;
  const cash = cashSummary(total, project.payments);
  const pool = laborPool(result.valid ? result.quote.labor : 0, project.advances);
  const closed = isClosed(project);
  const info = projectLevel(project, Date.now());
  const level = closed ? 'closed' : info.level;
  const detail = closed ? t('proj.closed') : levelDetail(t, info);
  const due = rentalsDue(project.expenses, Date.now());
  const title = projectTitle(project) || t('proj.untitled');
  const client = projectClient(project);

  const setFinance = (key) => (value) => setDraft((d) => ({ ...d, finance: { ...d.finance, [key]: value } }));
  const setList = (key) => (list) => setProject((p) => ({ ...p, [key]: list }));
  const items = result.valid ? result.quote.items : [];
  const visibleItems = showAll ? items : items.slice(0, 5);

  const generatePdf = async () => {
    if (!result.valid || busy) return;
    setBusy('pdf');
    setNote('');
    try {
      // "Generar PDF" FREEZES the quote: from now on the document and the project keep these prices and dates
      // (a client signature already does the same, so it is left alone). The contractor's signature from the
      // company profile is printed by the report itself.
      const frozen = draft.frozen || draft.signature ? draft : freezeQuote(draft, { pricedAt: priceTime, total, live: project, book: result.book });
      if (frozen !== draft) setDraft(() => frozen);
      const { doc, fileName, title: shareTitle } = await createReportPdf('client', { draft: frozen, result, company, i18n, photos: photosForReport(photos, t) });
      const outcome = await shareOrDownload(pdfToFile(doc, fileName), { title: shareTitle });
      if (outcome === 'downloaded') setNote('downloaded');
    } catch {
      setNote('pdfError');
    } finally {
      setBusy(null);
    }
  };

  const exportRendition = async () => {
    if (busy) return;
    setBusy('xlsx');
    setNote('');
    try {
      const file = buildRenditionFile([project], new Map([[project.id, result.valid ? total : null]]), { t, locale, currency: region.currency, digits: region.digits });
      const outcome = await shareOrDownload(file, { title: t('xl.shareTitle', { name: title }) });
      if (outcome === 'downloaded') setNote('downloaded');
    } catch {
      setNote('xlsxError');
    } finally {
      setBusy(null);
    }
  };

  const saveExpenses = (list) => {
    setProject((p) => ({ ...p, expenses: [...list, ...p.expenses].slice(0, LEDGER_LIMITS.expenses) }));
    setScanOpen(false);
  };
  const toggleReturned = (id) => setList('expenses')(project.expenses.map((e) => (e.id === id ? { ...e, returned: !e.returned } : e)));

  return (
    <main className="mx-auto w-full max-w-3xl px-3 pb-44 pt-3 sm:px-4" data-testid="project-view">
      {/* 1. identity, state and the pencil (edit only) */}
      <header className="flex items-start gap-2">
        <button type="button" onClick={onBack} aria-label={t('common.back')} data-testid="pv-back" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 hover:border-brand">
          <Icon>
            <path d="M15 18l-6-6 6-6" />
          </Icon>
        </button>
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="truncate text-2xl font-extrabold leading-tight">{title}</h1>
          <p className="truncate text-sm text-neutral-300">
            <span aria-hidden="true">{region.flag}</span> {client || t('proj.noClient')}
          </p>
        </div>
        <button type="button" onClick={onEdit} aria-label={t('proj.edit')} data-testid="pv-edit" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 hover:border-brand">
          <Icon>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
          </Icon>
        </button>
      </header>
      <div className="mt-2 flex items-center gap-2">
        <span
          data-testid="pv-status"
          data-level={level}
          className="inline-flex max-w-full items-center gap-2 rounded-full border-2 px-3 py-1.5 text-sm font-extrabold"
          style={{ color: LEVEL_COLOR[level], borderColor: LEVEL_COLOR[level] }}
        >
          <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: LEVEL_COLOR[level] }} />
          <span className="truncate">{detail || t(`light.${info.level}`)}</span>
        </span>
        {due.length > 0 && <Hourglass label={t('rental.dueToday')} />}
      </div>

      <LocationBlock location={project.location} />

      {/* 2. money: the budget and the cash control bar */}
      <section aria-labelledby="pv-budget" className="card mt-4">
        <h2 id="pv-budget" className="text-xs font-bold uppercase tracking-wider text-neutral-400">
          {t('pv.budget')}
        </h2>
        <p data-testid="budget-total" className="mt-1 text-4xl font-black tabular-nums text-brand">
          {result.valid ? money(total) : '—'}
        </p>
        {draft.frozen && (
          <p data-testid="frozen-chip" className="mt-1 text-xs font-bold text-[#e8c35f]">
            {t('pv.frozen')}
          </p>
        )}
        <button
          type="button"
          onClick={() => setCashOpen(true)}
          data-testid="cash-bar"
          aria-label={`${t('cash.title')}: ${money(cash.paid)} / ${money(cash.total)}`}
          className="mt-4 block w-full text-left"
        >
          <span className="block h-5 overflow-hidden rounded-full border border-white/15">
            <span data-testid="cash-fill" data-pct={Math.round(cash.pct)} style={{ width: `${cash.pct}%` }} className={`block h-full rounded-full transition-all ${cash.overpaid ? 'bg-[#e8c35f]' : 'bg-brand'}`} />
          </span>
          <span className="mt-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span>
              {t('cash.paid')} <b className="tabular-nums">{money(cash.paid)}</b> <span className="text-neutral-400">· {Math.round(cash.pct)} %</span>
            </span>
            <span className="text-neutral-300">
              {t('cash.pending')} <b className="tabular-nums">{money(cash.pending)}</b>
            </span>
          </span>
        </button>

        {/* the calculation (measures, partidas, prices, schedule) lives in the editor: a quiet row inside the budget card */}
        <button
          type="button"
          onClick={onEditor}
          data-testid="editor-open"
          data-pending={result.valid ? undefined : 'true'}
          className={`mt-4 flex min-h-[44px] w-full items-center gap-2 border-t border-white/10 pt-3 text-left text-sm font-semibold transition hover:text-white ${result.valid ? 'text-neutral-300' : 'text-brand'}`}
        >
          <Icon size={18}>
            <path d="M3 17L17 3l4 4L7 21H3z" />
            <path d="M13 7l4 4M9 11l2 2M6 14l2 2" />
          </Icon>
          <span className="flex-1">{result.valid ? t('pv.calc', { n: draft.partidas.length }) : t('pv.calc.define')}</span>
          <span aria-hidden="true" className="text-lg text-neutral-500">
            ›
          </span>
        </button>
      </section>

      {/* 3. selectors: one slider each (Mano de Obra, Imprevistos, Utilidad) */}
      <section aria-label={t('pv.selectors')} className="card mt-4 space-y-4" data-testid="selectors">
        <PercentSlider label={t('fin.labor')} testId="slider-labor" value={draft.finance.labor} min={FINANCE_LIMITS.labor.min} max={FINANCE_LIMITS.labor.max} onChange={setFinance('labor')} />
        {result.valid && (
          <p data-testid="labor-pool" data-available={pool.available} className="text-sm text-neutral-300">
            {t('adv.pool')}: <b className="tabular-nums text-white">{money(pool.available)}</b>
            {pool.advanced > 0 && <span className="text-[#e8c35f]"> (−{money(pool.advanced)})</span>}
          </p>
        )}
        <Advances advances={project.advances} onChange={setList('advances')} pool={pool} />
        <PercentSlider label={t('fin.contingency')} testId="slider-contingency" value={draft.finance.contingency} min={FINANCE_LIMITS.contingency.min} max={FINANCE_LIMITS.contingency.max} onChange={setFinance('contingency')} />
        <PercentSlider label={t('fin.profit')} testId="slider-profit" value={draft.finance.profit} min={FINANCE_LIMITS.profit.min} max={FINANCE_LIMITS.profit.max} onChange={setFinance('profit')} />
      </section>

      {/* 4. AI receipt scan */}
      <button
        type="button"
        onClick={() => (pro ? setScanOpen(true) : onPro('ai'))}
        data-testid="scan-receipt"
        className="mt-5 flex min-h-[64px] w-full items-center justify-center gap-3 rounded-2xl border-2 border-[#d4af37] px-4 text-lg font-extrabold text-[#e8c35f] transition active:scale-[0.99]"
      >
        <Icon size={28}>
          <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
          <circle cx="12" cy="13.5" r="3.5" />
        </Icon>
        <span>{t('scan.cta')}</span>
        {!pro && <span className="rounded border border-[#d4af37]/60 px-1.5 text-[10px] tracking-widest">PRO</span>}
        {pro === 'dev' && <span data-testid="ai-dev-badge" className="rounded border border-white/30 px-1.5 text-[10px] tracking-widest text-neutral-300">DEV</span>}
      </button>

      {/* 5. supplies: what the quote needs + what the receipts say was bought / rented */}
      <Section id="pv-supplies" title={t('sup.title')}>
        {items.length > 0 && (
          <>
            <ul className="divide-y divide-white/10 rounded-2xl border border-white/10" data-testid="supply-list">
              {visibleItems.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{t(`mat.${i.id}`)}</span>
                    <span className="block text-xs text-neutral-400">
                      {num(i.packs)} {unit(i.saleUnit)}
                    </span>
                  </span>
                  <span className="text-sm font-bold tabular-nums">{money(i.total)}</span>
                </li>
              ))}
            </ul>
            {items.length > 5 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} data-testid="supply-more" className="mt-1 min-h-[44px] w-full text-sm font-bold text-neutral-300 hover:text-white">
                {showAll ? t('sup.less') : t('sup.more', { n: items.length - 5 })}
              </button>
            )}
          </>
        )}
        {items.length === 0 && project.expenses.length === 0 && <p className="rounded-2xl border border-white/10 px-4 py-4 text-sm text-neutral-400">{t('sup.empty')}</p>}

        {project.expenses.length > 0 && (
          <ul className="mt-3 space-y-2" data-testid="expense-list">
            {project.expenses.map((e) => {
              const rental = RENTAL_CATEGORIES.includes(e.category);
              const isDue = due.some((d) => d.id === e.id);
              return (
                <li
                  key={e.id}
                  data-testid={`expense-${e.id}`}
                  data-due={isDue ? 'true' : undefined}
                  className={`rounded-2xl border bg-black px-4 py-3 ${isDue ? 'border-[#d4af37]' : 'border-white/10'}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{e.description || t(`exp.cat.${e.category}`)}</span>
                      <span className="block truncate text-xs text-neutral-400">{[t(`exp.cat.${e.category}`), e.supplier].filter(Boolean).join(' · ')}</span>
                    </span>
                    {isDue && <Hourglass label={t('rental.dueToday')} />}
                    <span className="font-bold tabular-nums">{money(e.amount)}</span>
                    <button
                      type="button"
                      onClick={() => setList('expenses')(project.expenses.filter((x) => x.id !== e.id))}
                      aria-label={`${t('common.delete')}: ${e.description || t(`exp.cat.${e.category}`)}`}
                      className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg text-neutral-500 hover:text-red-400"
                    >
                      ×
                    </button>
                  </div>
                  {rental && (
                    <button
                      type="button"
                      onClick={() => toggleReturned(e.id)}
                      aria-pressed={e.returned}
                      data-testid={`expense-return-${e.id}`}
                      className={`mt-2 min-h-[44px] w-full rounded-xl border px-3 text-sm font-bold ${e.returned ? 'border-brand/40 text-brand' : isDue ? 'border-[#d4af37] text-[#e8c35f]' : 'border-white/10 text-neutral-200'}`}
                    >
                      {e.returned ? `✓ ${t('rental.returned')}` : e.returnDate ? t('rental.returnBy', { date: e.returnDate === dayOf(Date.now()) ? t('light.todayShort') : e.returnDate }) : t('rental.markReturned')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* 6. Tap-to-Snap */}
      <Section id="pv-snap" title={t('snap.title')}>
        <SnapGrid photos={photos} setPhotos={setPhotos} projectId={project.id} />
      </Section>

      {/* 7. bitácora (last field of the view) */}
      <Section id="pv-log" title={t('log.title')}>
        <Logbook entries={project.logbook} onChange={setList('logbook')} />
      </Section>

      <Button variant="ghost" className="mt-6 w-full" onClick={exportRendition} disabled={busy === 'xlsx'} data-testid="export-rendition">
        {busy === 'xlsx' ? t('pdf.generating') : t('xl.export')}
      </Button>
      {note === 'xlsxError' && (
        <p role="alert" className="mt-2 text-sm font-semibold text-red-400">
          {t('xl.error')}
        </p>
      )}
      {note === 'downloaded' && (
        <p role="status" data-testid="share-note" className="mt-2 text-sm text-neutral-300">
          {t('share.downloaded')}
        </p>
      )}

      {/* base: Generar PDF */}
      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-black px-3 py-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-3xl">
          {note === 'pdfError' && (
            <p role="alert" className="mb-2 text-sm font-semibold text-red-400">
              {t('pdf.error')}
            </p>
          )}
          <Button className="w-full" onClick={generatePdf} disabled={!result.valid || busy === 'pdf'} data-testid="pdf-generate">
            {busy === 'pdf' ? t('pdf.generating') : t('pv.pdf')}
          </Button>
        </div>
      </div>

      {cashOpen && <CashSheet total={total} payments={project.payments} onChange={setList('payments')} onClose={() => setCashOpen(false)} />}
      {scanOpen && <ReceiptSheet onSave={saveExpenses} onClose={() => setScanOpen(false)} {...(prepareReceipt ? { prepareImage: prepareReceipt } : {})} {...(fetchImpl ? { fetchImpl } : {})} />}
    </main>
  );
}
```


---

# 6. Anexo

## Textos de estado (i18n, es)

| Clave | Texto |
|---|---|
| `pill.late` / `pill.soon` / `pill.ok` / `pill.future` | Atrasado / Por vencer / A tiempo / Futuros |
| `light.late` | Atraso de {n} d |
| `light.today` | Vence hoy |
| `light.daysLeft` | Faltan {n} d |
| `light.starts` | Inicia en {n} d |
| `light.none` | Sin plazo |
| `proj.closed` | Terminado |

Hay 6 idiomas (es, en, pt, fr, it, de) con paridad de claves verificada por tests.

## Puntos de acoplamiento relevantes para una refactorización UX

1. **Estado derivado, no persistido**: `projectLevel(project, now)` se llama en Dashboard (contadores), ProjectCard y ProjectView; cualquier cambio de reglas se hace en un solo sitio (`projects.js`) y el color en `levelStyle.js`.
2. **`now` inyectado**: Dashboard refresca cada 60 s (`useNow`); ProjectCard recibe `now`; ProjectView usa `Date.now()` directo para el semáforo y `useMarketClock` para precios.
3. **Cada tarjeta recalcula el total** con `computeAll(..., { chains:false })` (memoizado por draft, fechas, idioma y ventana de mercado de 15 min).
4. **Costura ficha/editor**: la ficha no muestra partidas ni cálculos detallados; solo `pv.calc` ("N partidas") y un botón al editor. Los insumos de la ficha vienen de `result.quote.items`.
5. **Persistencia**: edición en memoria (`projects[]`) + guardado con debounce de 250 ms y flush al ocultar la página; nunca se guarda sin pasar por `normalizeProject`.
6. **Congelado**: "Generar PDF" o una firma del cliente congelan precios y fechas (`draft.frozen` / `draft.signature`); `planningTimeline`/`pricingTime` deciden si se usan las fechas vivas o las congeladas.
