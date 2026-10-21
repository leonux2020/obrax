import { coerceNumber } from './sanitize.js';
import { CALCULATORS } from './calc.js';

// Task (partida type) definitions: which measurements each guided module asks for, with hard limits.
// `options` are closed choices (never free text): values are validated against the allowed list.
// `openingsAgainst` = the two dimensions whose product is the gross area the openings are deducted from.

const YES_NO = [0, 1];

export const TASKS = Object.freeze({
  slab: {
    id: 'slab',
    chapter: 'foundation',
    defaultWaste: 5,
    fields: [
      { key: 'length', unit: 'm', min: 0.1, max: 500, decimals: 2, required: true },
      { key: 'width', unit: 'm', min: 0.1, max: 500, decimals: 2, required: true },
      { key: 'thickness', unit: 'cm', min: 5, max: 60, decimals: 1, required: true, default: 10 },
    ],
    options: [],
  },
  masonry: {
    id: 'masonry',
    chapter: 'walls',
    defaultWaste: 8,
    openingsAgainst: ['length', 'height'],
    fields: [
      { key: 'length', unit: 'm', min: 0.1, max: 500, decimals: 2, required: true },
      { key: 'height', unit: 'm', min: 0.3, max: 12, decimals: 2, required: true },
      { key: 'thickness', unit: 'cm', min: 8, max: 30, decimals: 1, required: true, default: 14 },
      { key: 'openings', unit: 'm2', min: 0, max: 500, decimals: 2, required: false, default: 0 },
    ],
    options: [],
  },
  drywall: {
    id: 'drywall',
    chapter: 'walls',
    defaultWaste: 10,
    openingsAgainst: ['length', 'height'],
    fields: [
      { key: 'length', unit: 'm', min: 0.1, max: 500, decimals: 2, required: true },
      { key: 'height', unit: 'm', min: 0.5, max: 8, decimals: 2, required: true },
      { key: 'thickness', unit: 'mm', min: 9, max: 25, decimals: 1, required: true, default: 12.5 },
      { key: 'openings', unit: 'm2', min: 0, max: 500, decimals: 2, required: false, default: 0 },
    ],
    options: [{ key: 'faces', values: [1, 2], default: 2 }],
  },
  roof: {
    id: 'roof',
    chapter: 'roof',
    defaultWaste: 10,
    fields: [
      { key: 'length', unit: 'm', min: 0.5, max: 200, decimals: 2, required: true },
      { key: 'width', unit: 'm', min: 0.5, max: 200, decimals: 2, required: true },
      { key: 'slope', unit: 'deg', min: 0, max: 60, decimals: 1, required: true, default: 20 },
      { key: 'overhang', unit: 'm', min: 0, max: 2, decimals: 2, required: false, default: 0.4 },
    ],
    options: [
      { key: 'roofing', values: ['zinc', 'tile'], default: 'zinc' },
      { key: 'insulation', values: YES_NO, default: 1 },
      { key: 'gutters', values: YES_NO, default: 1 },
    ],
  },
  floor: {
    id: 'floor',
    chapter: 'finishes',
    defaultWaste: 10,
    openingsAgainst: ['length', 'width'],
    fields: [
      { key: 'length', unit: 'm', min: 0.1, max: 500, decimals: 2, required: true },
      { key: 'width', unit: 'm', min: 0.1, max: 500, decimals: 2, required: true },
      { key: 'openings', unit: 'm2', min: 0, max: 500, decimals: 2, required: false, default: 0 },
    ],
    options: [
      { key: 'format', values: ['30', '45', '60'], default: '45' },
      { key: 'screed', values: YES_NO, default: 0 },
    ],
  },
  paint: {
    id: 'paint',
    chapter: 'finishes',
    defaultWaste: 5,
    openingsAgainst: ['length', 'height'],
    fields: [
      { key: 'length', unit: 'm', min: 0.1, max: 2000, decimals: 2, required: true },
      { key: 'height', unit: 'm', min: 0.3, max: 12, decimals: 2, required: true },
      { key: 'openings', unit: 'm2', min: 0, max: 2000, decimals: 2, required: false, default: 0 },
    ],
    options: [
      { key: 'coats', values: [1, 2, 3, 4], default: 2 },
      { key: 'primer', values: YES_NO, default: 1 },
      { key: 'putty', values: YES_NO, default: 0 },
    ],
  },
});

export const TASK_IDS = Object.freeze(Object.keys(TASKS));
export const WASTE_LIMITS = Object.freeze({ min: 0, max: 30, step: 1 });

/** Return the allowed option value matching `raw` (string/number tolerant) or the option default. */
export function pickOption(option, raw) {
  const hit = option.values.find((v) => String(v) === String(raw));
  return hit === undefined ? option.default : hit;
}

export function defaultDims(taskId, previous = {}) {
  const task = TASKS[taskId];
  const dims = {};
  for (const f of task.fields) {
    if (f.key === 'length' || f.key === 'width') dims[f.key] = previous[f.key] ?? null;
    else dims[f.key] = f.default ?? null;
  }
  for (const o of task.options) dims[o.key] = o.default;
  return dims;
}

/** Validate raw dims for a task -> clean numeric values + per-field error codes. */
export function validateDims(taskId, dims) {
  const task = TASKS[taskId];
  const values = {};
  const errors = {};
  for (const f of task.fields) {
    const raw = dims?.[f.key];
    if (raw === null || raw === undefined || raw === '') {
      if (f.required) errors[f.key] = 'required';
      else values[f.key] = f.default ?? 0;
      continue;
    }
    const n = coerceNumber(raw, { min: f.min, max: f.max, decimals: f.decimals, fallback: null });
    if (n === null) errors[f.key] = 'range';
    else values[f.key] = n;
  }
  for (const o of task.options) values[o.key] = pickOption(o, dims?.[o.key]);

  if (task.openingsAgainst && !errors.openings) {
    const [a, b] = task.openingsAgainst;
    if (values[a] !== undefined && values[b] !== undefined && (values.openings ?? 0) > values[a] * values[b]) {
      errors.openings = 'openings';
    }
  }
  return { values, errors, valid: Object.keys(errors).length === 0 };
}

export function runCalculation(taskId, values) {
  return CALCULATORS[taskId](values);
}
