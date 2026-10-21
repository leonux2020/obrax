import { coerceNumber, oneOf } from './sanitize.js';
import { CALCULATORS } from './calc.js';

// Task definitions: which measurements each guided module asks for, with hard limits.
export const TASKS = Object.freeze({
  slab: {
    id: 'slab',
    defaultWaste: 5,
    fields: [
      { key: 'length', unit: 'm', min: 0.1, max: 500, decimals: 2, required: true },
      { key: 'width', unit: 'm', min: 0.1, max: 500, decimals: 2, required: true },
      { key: 'thickness', unit: 'cm', min: 5, max: 60, decimals: 1, required: true, default: 10 },
    ],
  },
  masonry: {
    id: 'masonry',
    defaultWaste: 8,
    fields: [
      { key: 'length', unit: 'm', min: 0.1, max: 500, decimals: 2, required: true },
      { key: 'height', unit: 'm', min: 0.3, max: 12, decimals: 2, required: true },
      { key: 'thickness', unit: 'cm', min: 8, max: 30, decimals: 1, required: true, default: 14 },
      { key: 'openings', unit: 'm2', min: 0, max: 500, decimals: 2, required: false, default: 0 },
    ],
  },
  drywall: {
    id: 'drywall',
    defaultWaste: 10,
    options: ['faces'],
    fields: [
      { key: 'length', unit: 'm', min: 0.1, max: 500, decimals: 2, required: true },
      { key: 'height', unit: 'm', min: 0.5, max: 8, decimals: 2, required: true },
      { key: 'thickness', unit: 'mm', min: 9, max: 25, decimals: 1, required: true, default: 12.5 },
      { key: 'openings', unit: 'm2', min: 0, max: 500, decimals: 2, required: false, default: 0 },
    ],
  },
});

export const TASK_IDS = Object.freeze(Object.keys(TASKS));

export function defaultDims(taskId, previous = {}) {
  const task = TASKS[taskId];
  const dims = { faces: 2 };
  for (const f of task.fields) {
    if (f.key === 'length' || f.key === 'width') dims[f.key] = previous[f.key] ?? null;
    else dims[f.key] = f.default ?? null;
  }
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
  if (task.options?.includes('faces')) values.faces = oneOf(Number(dims?.faces), [1, 2], 2);
  const openings = values.openings ?? 0;
  if (
    values.length !== undefined &&
    values.height !== undefined &&
    !errors.openings &&
    openings > values.length * values.height
  ) {
    errors.openings = 'openings';
  }
  return { values, errors, valid: Object.keys(errors).length === 0 };
}

export function runCalculation(taskId, values) {
  return CALCULATORS[taskId](values);
}
