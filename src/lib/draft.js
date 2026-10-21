// Persistent state (settings, session user, in-progress project) with strict validation on load.
// Anything read from localStorage is treated as untrusted input.

import { REGIONS, LANGS, getRegion } from './regions.js';
import { TASKS, TASK_IDS, defaultDims } from './tasks.js';
import { MATERIAL_IDS } from './catalog.js';
import { MAX_PRICE } from './pricing.js';
import {
  coerceNumber,
  sanitizeText,
  sanitizeEmail,
  sanitizeAvatarUrl,
  sanitizeTaxId,
  sanitizePhone,
  oneOf,
} from './sanitize.js';

const KEYS = { settings: 'cp.settings.v1', user: 'cp.user.v1', draft: 'cp.draft.v1', company: 'cp.company.v1' };

export const FINANCE_LIMITS = Object.freeze({
  labor: { min: 0, max: 150, step: 1, default: 35 },
  transport: { min: 0, max: 30, step: 1, default: 5 },
  waste: { min: 0, max: 30, step: 1, default: 5 },
});

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
  return { region, lang: oneOf(obj?.lang, LANGS, fallbackLang) };
}
export const loadSettings = () => normalizeSettings(read(KEYS.settings));
export const saveSettings = (s) => write(KEYS.settings, s);

// ---- user -----------------------------------------------------------------
export function normalizeUser(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const provider = oneOf(obj.provider, ['google', 'demo', 'guest'], null);
  if (!provider) return null;
  return {
    provider,
    name: sanitizeText(obj.name, 60) || (provider === 'guest' ? 'Invitado' : 'Usuario'),
    email: sanitizeEmail(obj.email),
    picture: sanitizeAvatarUrl(obj.picture),
  };
}
export const loadUser = () => normalizeUser(read(KEYS.user));
export const saveUser = (u) => write(KEYS.user, u);

// ---- company / professional profile (printed on both reports) -------------
export const EMPTY_COMPANY = Object.freeze({ name: '', taxId: '', phone: '', email: '', city: '' });

export function normalizeCompany(obj) {
  if (!obj || typeof obj !== 'object') return { ...EMPTY_COMPANY };
  return {
    name: sanitizeText(obj.name, 80).trim(),
    taxId: sanitizeTaxId(obj.taxId),
    phone: sanitizePhone(obj.phone).trim(),
    email: sanitizeEmail(obj.email),
    city: sanitizeText(obj.city, 60).trim(),
  };
}
export const isCompanyEmpty = (c) => !c || Object.values(c).every((v) => !v);
export const loadCompany = () => normalizeCompany(read(KEYS.company));
export const saveCompany = (c) => write(KEYS.company, isCompanyEmpty(c) ? null : normalizeCompany(c));

// ---- draft (project in progress) -------------------------------------------
export function newDraft(regionCode) {
  const region = getRegion(regionCode);
  return {
    task: 'slab',
    step: 0,
    project: { name: '', client: '' },
    dims: defaultDims('slab'),
    finance: {
      labor: FINANCE_LIMITS.labor.default,
      transport: FINANCE_LIMITS.transport.default,
      waste: TASKS.slab.defaultWaste,
    },
    chainId: 'best',
    overrides: {},
    regionCode: region ? region.code : null,
  };
}

export function normalizeDraft(obj, regionCode) {
  const base = newDraft(regionCode);
  if (!obj || typeof obj !== 'object' || obj.regionCode !== regionCode) return base;
  const task = oneOf(obj.task, TASK_IDS, 'slab');
  const dims = defaultDims(task);
  for (const f of TASKS[task].fields) {
    const v = coerceNumber(obj.dims?.[f.key], { min: f.min, max: f.max, decimals: f.decimals, fallback: null });
    if (v !== null) dims[f.key] = v;
    else if (f.key === 'length' || f.key === 'width') dims[f.key] = null;
  }
  dims.faces = oneOf(Number(obj.dims?.faces), [1, 2], 2);

  const finance = {};
  for (const [k, lim] of Object.entries(FINANCE_LIMITS)) {
    finance[k] = coerceNumber(obj.finance?.[k], { min: lim.min, max: lim.max, decimals: 0, fallback: null });
    if (finance[k] === null) finance[k] = k === 'waste' ? TASKS[task].defaultWaste : lim.default;
  }

  const region = getRegion(regionCode);
  const chainId =
    obj.chainId === 'best' || region.chains.some((c) => c.id === obj.chainId) ? obj.chainId : 'best';

  const overrides = {};
  if (obj.overrides && typeof obj.overrides === 'object') {
    for (const id of MATERIAL_IDS) {
      const v = coerceNumber(obj.overrides[id], { min: 0.000001, max: MAX_PRICE, decimals: 2, fallback: null });
      if (v !== null) overrides[id] = v;
    }
  }

  return {
    task,
    step: Math.min(4, Math.max(0, Number.isInteger(obj.step) ? obj.step : 0)),
    project: { name: sanitizeText(obj.project?.name, 80), client: sanitizeText(obj.project?.client, 80) },
    dims,
    finance,
    chainId,
    overrides,
    regionCode,
  };
}

export const loadDraft = (regionCode) => (regionCode ? normalizeDraft(read(KEYS.draft), regionCode) : null);
export const saveDraft = (d) => write(KEYS.draft, d);
export const clearDraft = () => write(KEYS.draft, null);
export const clearAll = () => Object.values(KEYS).forEach((k) => write(k, null));
