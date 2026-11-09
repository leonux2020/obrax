// AI invoice reading (PRO). Pure logic of the browser UI (there is no server: see gemini.js):
//  - normalizeExtraction(): turns ANY untrusted JSON (a model answer) into a clean, bounded
//    structure. Nothing the model prints can add a material that is not in the catalog or an absurd number.
//  - planInvoicePrices(): maps the extracted lines to the materials of the CURRENT quote (price per SALE unit,
//    without tax) and flags what looks wrong.
//  - requestExtraction(): the only network call; it talks to Google directly with the user's own key (gemini.js, BYOK).
// No Gemini key is shipped with the app: each user brings their own (geminiKey.js), kept only on their device.

import { CATALOG } from './catalog.js';
import { InvoiceError, callGemini } from './gemini.js';
import { MAX_PRICE, roundMoney } from './pricing.js';

export const INVOICE_LIMITS = Object.freeze({
  maxItems: 60,
  maxText: 120,
  maxQty: 1_000_000,
  // sent to the proxy: the compressed JPEG must stay well below the proxy cap
  maxSide: 1600,
  targetBytes: 900_000,
  requestTimeoutMs: 45_000,
  // a price that is this many times above/below the reference is probably a misread
  suspiciousRatio: 8,
});

export const PRICE_BASES = Object.freeze(['sale_unit', 'base_unit']);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f<>]/g;
const text = (v, max = INVOICE_LIMITS.maxText) => (typeof v === 'string' ? v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const positive = (v, max) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};
const round4 = (n) => Math.round(n * 10_000) / 10_000;

/**
 * Parse an amount EXACTLY as printed on a document, whatever the country's separators:
 *   "4.990" -> 4990 (CLP thousands)   "1.234,56" -> 1234.56   "1,234.56" -> 1234.56   "12,5" -> 12.5   "$ 4 990" -> 4990
 * A single separator followed by exactly three digits is a THOUSANDS separator (prices almost never carry three
 * decimals); several equal separators are thousands; with both kinds the last one is the decimal mark.
 * Models love to "normalise" 4.990 into 4.99, which is why the proxy asks for the printed text.
 */
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const s = value.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  let out;
  if (dot >= 0 && comma >= 0) {
    const dec = Math.max(dot, comma) === dot ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    out = s.split(thou).join('').replace(dec, '.');
  } else if (dot >= 0 || comma >= 0) {
    const sep = dot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    const last = parts[parts.length - 1];
    const thousands = parts.length > 2 || (last.length === 3 && parts[0].length >= 1 && parts[0].length <= 3 && parts[0] !== '0');
    out = thousands ? parts.join('') : `${parts.slice(0, -1).join('')}.${last}`;
  } else out = s;
  const n = Number(out);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Like parseAmount but SIGNED: a deduction printed as "-1,21", "−1,21" (typographic minus), "1,21-" (trailing minus, common on till
 * tapes) or "(1,21)" (accounting brackets) is NEGATIVE. Returns a non-zero finite number or null. Discounts must never be read as charges.
 */
export function parseSignedAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0 ? value : null;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  const negative = /^[\s(]*[-\u2212\u2013\u2014]/.test(t) || /[-\u2212\u2013\u2014)]\s*$/.test(t.replace(/\s*[A-Za-z$€£]{1,4}\s*$/, ''));
  const n = parseAmount(t.replace(/[-\u2212\u2013\u2014]/g, ''));
  return n === null ? null : negative ? -n : n;
}

/**
 * Clean an untrusted extraction. Returns { isInvoice, currency, taxIncluded, supplier, date, items[] } where
 * every item is { materialId|null, description, quantity|null, unit, unitPrice, priceBasis, lineTotal|null }.
 * Lines without a positive price are dropped.
 */
export function normalizeExtraction(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const items = [];
  for (const it of Array.isArray(src.items) ? src.items.slice(0, INVOICE_LIMITS.maxItems * 2) : []) {
    if (!it || typeof it !== 'object') continue;
    // the text exactly as printed wins over the model's own number (see parseAmount)
    const printed = parseAmount(it.unitPriceText);
    const unitPrice = positive(printed ?? it.unitPrice, MAX_PRICE);
    if (unitPrice === null) continue;
    const quantity = positive(it.quantity, INVOICE_LIMITS.maxQty);
    const lineTotal = positive(parseAmount(it.lineTotalText) ?? it.lineTotal, MAX_PRICE * 100);
    items.push({
      materialId: typeof it.materialId === 'string' && Object.prototype.hasOwnProperty.call(CATALOG, it.materialId) ? it.materialId : null,
      description: text(it.description),
      quantity: quantity === null ? null : round4(quantity),
      unit: text(it.unit, 20),
      unitPrice: round4(unitPrice),
      priceBasis: PRICE_BASES.includes(it.priceBasis) ? it.priceBasis : 'sale_unit',
      lineTotal: lineTotal === null ? null : round4(lineTotal),
      // does quantity x unit price match the printed line total? (null = cannot tell)
      consistent: quantity !== null && lineTotal !== null && it.priceBasis !== 'base_unit' ? Math.abs(unitPrice * quantity - lineTotal) <= Math.max(1, lineTotal * 0.03) : null,
    });
    if (items.length >= INVOICE_LIMITS.maxItems) break;
  }
  const currency = typeof src.currency === 'string' && /^[A-Za-z]{3}$/.test(src.currency.trim()) ? src.currency.trim().toUpperCase() : '';
  const date = typeof src.invoiceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.invoiceDate.trim()) ? src.invoiceDate.trim() : '';
  return {
    isInvoice: src.isInvoice !== false,
    currency,
    taxIncluded: src.taxIncluded === true,
    supplier: text(src.supplier, 60),
    date,
    items,
  };
}

/**
 * Map extracted lines onto the CURRENT quote.
 * @param extraction  result of normalizeExtraction
 * @param quoteItems  result.quote.items of the open quote (id, refPrice, saleSize ...)
 * @param region      the project's region (currency, digits)
 * @param taxRate     fraction (0.19) used to strip tax from prices printed WITH tax
 * @returns {{rows: Array, ignored: Array, currencyMismatch: boolean}}
 *  row = { id, description, quantity, unit, price, refPrice, ratio, suspicious, selectable, selected, lines }
 *  `price` is per SALE unit, net of tax, rounded to the currency's decimals; several lines of the same
 *  material are merged into one quantity-weighted average.
 */
export function planInvoicePrices(extraction, { quoteItems = [], region, taxRate = 0 } = {}) {
  const ex = normalizeExtraction(extraction);
  const currencyMismatch = !!ex.currency && !!region && ex.currency !== region.currency;
  const inQuote = new Map(quoteItems.map((q) => [q.id, q]));
  const groups = new Map();
  const ignored = [];
  for (const it of ex.items) {
    if (!it.materialId) {
      ignored.push({ description: it.description, reason: 'nomatch' });
      continue;
    }
    if (!inQuote.has(it.materialId)) {
      ignored.push({ description: it.description, reason: 'notinquote', materialId: it.materialId });
      continue;
    }
    const size = CATALOG[it.materialId].size;
    let price = it.priceBasis === 'base_unit' ? it.unitPrice * size : it.unitPrice;
    if (ex.taxIncluded && taxRate > 0) price /= 1 + taxRate;
    const g = groups.get(it.materialId) ?? { sum: 0, weight: 0, lines: [], description: it.description, quantity: 0, unit: it.unit };
    const w = it.quantity ?? 1;
    g.sum += price * w;
    g.weight += w;
    g.quantity += it.quantity ?? 0;
    g.lines.push(it);
    groups.set(it.materialId, g);
  }
  const rows = [];
  for (const [id, g] of groups) {
    const price = roundMoney(g.sum / g.weight, region);
    const ref = inQuote.get(id).refPrice;
    const ratio = ref > 0 ? price / ref : 1;
    const suspicious = g.lines.some((l) => l.consistent === false) || !(price > 0) || ratio > INVOICE_LIMITS.suspiciousRatio || ratio < 1 / INVOICE_LIMITS.suspiciousRatio;
    const selectable = price > 0 && price <= MAX_PRICE && !currencyMismatch;
    rows.push({
      id,
      description: g.description,
      quantity: g.quantity || null,
      unit: g.unit,
      price,
      refPrice: ref,
      ratio,
      suspicious,
      selectable,
      selected: selectable && !suspicious,
      lines: g.lines.length,
    });
  }
  return { rows, ignored, currencyMismatch };
}

/** Overrides ({materialId: price per sale unit}) for the chosen rows. Never returns invalid prices. */
export function overridesFromRows(rows, selectedIds) {
  const chosen = new Set(selectedIds);
  const out = {};
  for (const r of rows) if (chosen.has(r.id) && r.selectable && r.price > 0 && r.price <= MAX_PRICE) out[r.id] = r.price;
  return out;
}

// ---- network (direct to Google, with the user's own key: see gemini.js) -------------------------------------------------
export { ERROR_CODES, InvoiceError } from './gemini.js';

/**
 * Read ONE compressed photo with Gemini, straight from the browser (BYOK), and return the model's parsed JSON (untrusted: the callers
 * normalize it). Shared by invoice and receipt reading. `kind` only selects one of the fixed prompts of geminiRequests.js.
 * @throws {InvoiceError} with a stable `code` the UI translates ('no_key' when this device has no key yet; nothing is sent then).
 */
export async function postImage(dataUrl, { kind = 'invoice', currency = '', fetchImpl = globalThis.fetch, signal, apiKey } = {}) {
  return callGemini({ kind, dataUrl, currency, fetchImpl, signal, ...(apiKey !== undefined ? { apiKey } : {}) });
}

/** Read ONE compressed invoice photo and return the clean extraction. */
export async function requestExtraction(dataUrl, opts = {}) {
  const body = await postImage(dataUrl, { ...opts, kind: 'invoice' });
  const extraction = normalizeExtraction(body);
  if (!extraction.isInvoice) throw new InvoiceError('not_invoice');
  if (!extraction.items.length) throw new InvoiceError('unreadable');
  return extraction;
}
