// Regenerates src/data/baseCatalog.json from the built-in CATALOG (single source of truth for the shape).
// Usage: node scripts/gen-base-catalog.mjs
// The JSON is the OFFLINE price layer: when a material has neither a price of the user nor a live one, the app reads this.
import fs from 'node:fs';
import { CATALOG } from '../src/lib/catalog.js';

const items = {};
for (const [id, m] of Object.entries(CATALOG)) {
  items[id] = { sale: m.sale, size: Math.round(m.size * 1e4) / 1e4, usd: m.usd };
}
const out = { version: 1, currency: 'USD', note: 'Reference price of ONE sale unit before regional index and chain factor.', items };
fs.writeFileSync(new URL('../src/data/baseCatalog.json', import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
console.log(`baseCatalog.json: ${Object.keys(items).length} items`);
