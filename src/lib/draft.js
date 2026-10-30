// Persistent state (settings, session user, in-progress project) with strict validation on load.
// Anything read from localStorage is treated as untrusted input.

import { REGIONS, LANGS, getRegion } from './regions.js';
import { TASKS, TASK_IDS, WASTE_LIMITS, defaultDims, pickOption } from './tasks.js';
import { MATERIAL_IDS } from './catalog.js';
import { MAX_PRICE } from './pricing.js';
import { normalizeSignature, normalizeInk, normalizeFrozen } from './signature.js';
import { SCHEDULE } from './schedule.js';
import { MACHINE_IDS, DEFAULT_MACHINERY } from './machinery.js';
import {
  coerceNumber,
  sanitizeText,
  sanitizeEmail,
  sanitizeAvatarUrl,
  sanitizeTaxId,
  sanitizePhone,
  oneOf,
} from './sanitize.js';

const KEYS = { settings: 'cp.settings.v1', user: 'cp.user.v1', draft: 'cp.draft.v2', company: 'cp.company.v1', profile: 'cp.profile.v1' };

export const FINANCE_LIMITS = Object.freeze({
  labor: { min: 0, max: 150, step: 1, default: 35 },
  transport: { min: 0, max: 30, step: 1, default: 5 },
  contingency: { min: 0, max: 30, step: 1, default: 0 }, // Imprevistos: % over direct costs (0 keeps every older quote identical)
  profit: { min: 0, max: 100, step: 1, default: 0 }, // Utilidad: % over direct costs + contingency
});
export const TAX_LIMITS = Object.freeze({ min: 0, max: 50, decimals: 2 });
export const MAX_PARTIDAS = 30;
export const MODES = Object.freeze(['quick', 'project']);

function read(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw || raw.length > 50_000) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / blocked: app keeps working in-memory */
  }
}

// ---- settings -------------------------------------------------------------
export function normalizeSettings(obj) {
  const region = obj && typeof obj.region === 'string' && REGIONS[obj.region] ? obj.region : null;
  const fallbackLang = region ? REGIONS[region].lang : 'es';
  // `langLocked`: the user CHOSE the language (it then stops following the device's); only stored when true
  return { region, lang: oneOf(obj?.lang, LANGS, fallbackLang), ...(obj?.langLocked === true ? { langLocked: true } : {}) };
}
export const loadSettings = () => normalizeSettings(read(KEYS.settings));
export const saveSettings = (s) => write(KEYS.settings, s);

// ---- user -----------------------------------------------------------------
export function normalizeUser(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const provider = oneOf(obj.provider, ['google', 'local', 'demo', 'guest'], null);
  if (!provider) return null;
  return {
    provider,
    name: sanitizeText(obj.name, 60).trim() || (provider === 'guest' ? 'Invitado' : 'Usuario'),
    email: sanitizeEmail(obj.email),
    picture: sanitizeAvatarUrl(obj.picture),
  };
}
export const loadUser = () => normalizeUser(read(KEYS.user));
export const saveUser = (u) => write(KEYS.user, u);

// ---- company / professional profile (printed on both reports) -------------
export const EMPTY_COMPANY = Object.freeze({ name: '', taxId: '', phone: '', email: '', city: '', proName: '', proTaxId: '', signature: null });

export function normalizeCompany(obj) {
  if (!obj || typeof obj !== 'object') return { ...EMPTY_COMPANY };
  return {
    name: sanitizeText(obj.name, 80).trim(),
    taxId: sanitizeTaxId(obj.taxId),
    phone: sanitizePhone(obj.phone).trim(),
    email: sanitizeEmail(obj.email),
    city: sanitizeText(obj.city, 60).trim(),
    proName: sanitizeText(obj.proName, 60).trim(), // the professional who signs: personal name ...
    proTaxId: sanitizeTaxId(obj.proTaxId), // ... and personal ID (RUT / DNI / ...)
    signature: normalizeInk(obj.signature), // contractor's ink (PNG), printed automatically on the final documents
  };
}
export const isCompanyEmpty = (c) => !c || Object.values(c).every((v) => !v);
export const loadCompany = () => normalizeCompany(read(KEYS.company));
export const saveCompany = (c) => write(KEYS.company, isCompanyEmpty(c) ? null : normalizeCompany(c));

// ---- onboarding / backup preferences ----------------------------------------
// `onboarded` is the flag that retires the splash screen for good; `drive` is the user's choice for the
// (upcoming) Google Drive backup. Both live next to the company profile, never inside a project.
export const DEFAULT_PROFILE_META = Object.freeze({ onboarded: false, drive: true });
export function normalizeProfileMeta(obj) {
  if (!obj || typeof obj !== 'object') return { ...DEFAULT_PROFILE_META };
  return { onboarded: obj.onboarded === true, drive: obj.drive !== false };
}
export const loadProfileMeta = () => normalizeProfileMeta(read(KEYS.profile));
export const saveProfileMeta = (m) => write(KEYS.profile, normalizeProfileMeta(m));
export const hasStoredProfileMeta = () => read(KEYS.profile) !== null;

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

export const loadDraft = (regionCode) => (regionCode ? normalizeDraft(read(KEYS.draft), regionCode) : null);
export const saveDraft = (d) => write(KEYS.draft, d);
export const clearDraft = () => write(KEYS.draft, null);
/** True when a single-project draft from the pre-dashboard versions is still in localStorage (migration). */
export const hasStoredDraft = () => read(KEYS.draft) !== null;
export const clearAll = () => Object.values(KEYS).forEach((k) => write(k, null));
