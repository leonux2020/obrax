// HSE (Health, Safety & Environment) quick guide per partida type. The content is data only: every
// item is an id whose text lives in the dictionaries (hse.ppe.* / hse.erg.* / hse.waste.*), so the six
// languages stay in sync and a test can verify that every id resolves. This is general good-practice
// guidance, not a substitute for local regulations or a site safety officer (the sheet says so).

import { TASK_IDS } from './tasks.js';

export const PPE_IDS = Object.freeze([
  'helmet', 'glasses', 'gloves', 'gloves_chem', 'boots', 'boots_rubber', 'hivis', 'mask', 'respirator', 'hearing', 'harness', 'knee_pads', 'coverall', 'sleeves', 'sun',
]);

export const ERGO_IDS = Object.freeze([
  'lift', 'bags', 'spine', 'breaks', 'kneel', 'overhead', 'ladder', 'cart', 'wrist', 'boards', 'boxes', 'heat', 'sheets', 'ventilation',
]);

export const WASTE_IDS = Object.freeze([
  'washout', 'cement_bags', 'rubble', 'aggregates', 'metal', 'block_offcuts', 'mortar_batches', 'gypsum', 'packaging', 'dust', 'wood', 'insulation', 'adhesive', 'wetcut', 'paint_hazard', 'paint_leftover', 'brush_water', 'inventory',
]);

export const HSE = Object.freeze({
  slab: {
    ppe: { mandatory: ['helmet', 'glasses', 'gloves_chem', 'boots', 'mask'], recommended: ['boots_rubber', 'hearing', 'knee_pads', 'hivis', 'sleeves'] },
    ergonomics: ['lift', 'bags', 'cart', 'spine', 'breaks'],
    waste: ['washout', 'cement_bags', 'rubble', 'aggregates', 'metal', 'inventory'],
  },
  masonry: {
    ppe: { mandatory: ['helmet', 'glasses', 'gloves', 'boots', 'mask'], recommended: ['gloves_chem', 'hearing', 'sleeves', 'hivis'] },
    ergonomics: ['lift', 'bags', 'spine', 'ladder', 'breaks'],
    waste: ['block_offcuts', 'mortar_batches', 'cement_bags', 'rubble', 'inventory'],
  },
  drywall: {
    ppe: { mandatory: ['glasses', 'gloves', 'boots', 'mask'], recommended: ['helmet', 'hearing', 'knee_pads', 'sleeves'] },
    ergonomics: ['boards', 'overhead', 'ladder', 'wrist', 'breaks'],
    waste: ['gypsum', 'metal', 'packaging', 'dust', 'inventory'],
  },
  roof: {
    ppe: { mandatory: ['helmet', 'harness', 'boots', 'gloves', 'glasses'], recommended: ['hearing', 'hivis', 'sun', 'mask', 'sleeves'] },
    ergonomics: ['ladder', 'sheets', 'heat', 'lift', 'breaks'],
    waste: ['metal', 'wood', 'insulation', 'packaging', 'inventory'],
  },
  floor: {
    ppe: { mandatory: ['knee_pads', 'gloves', 'glasses', 'boots', 'mask'], recommended: ['hearing', 'gloves_chem', 'sleeves'] },
    ergonomics: ['kneel', 'boxes', 'spine', 'lift', 'breaks'],
    waste: ['rubble', 'adhesive', 'wetcut', 'packaging', 'inventory'],
  },
  paint: {
    ppe: { mandatory: ['glasses', 'gloves_chem', 'boots', 'mask'], recommended: ['respirator', 'coverall', 'helmet', 'sleeves'] },
    ergonomics: ['overhead', 'wrist', 'ladder', 'ventilation', 'breaks'],
    waste: ['paint_hazard', 'paint_leftover', 'brush_water', 'packaging', 'inventory'],
  },
});

/** HSE guide of a task, as translation keys ready for t(). Unknown tasks return null. */
export function hseFor(task) {
  const g = HSE[task];
  if (!g) return null;
  return {
    task,
    mandatory: g.ppe.mandatory.map((id) => `hse.ppe.${id}`),
    recommended: g.ppe.recommended.map((id) => `hse.ppe.${id}`),
    ergonomics: g.ergonomics.map((id) => `hse.erg.${id}`),
    waste: g.waste.map((id) => `hse.waste.${id}`),
  };
}

/** Every dictionary key the HSE module can ask for (used by the tests to prove nothing is missing). */
export const hseKeys = () => TASK_IDS.flatMap((task) => {
  const g = hseFor(task);
  return [...g.mandatory, ...g.recommended, ...g.ergonomics, ...g.waste];
});
