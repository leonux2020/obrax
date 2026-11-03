// AI receipt reading ("Escanear Boleta"): the photo of ANY purchase / rental receipt becomes tabulated
// expense lines for the rendición de cuentas, and rented tools / machinery come with the day they must go back.
// Pure logic shared by the browser and the server proxy (same rules as invoice.js: whatever the model prints is
// treated as untrusted data and reduced to a clean, bounded structure).

import { InvoiceError, INVOICE_LIMITS, parseAmount, parseSignedAmount, postImage } from './invoice.js';
import { MAX_PRICE } from './pricing.js';
import { DOCUMENT_TYPES, EXPENSE_CATEGORIES, PAYMENT_METHODS, RENTAL_CATEGORIES, cleanFiscalCode, newEntryId, oneOfOrEmpty } from './ledger.js';

export const RECEIPT_LIMITS = Object.freeze({ maxItems: 40, maxReceipts: 10 }); // lines per receipt, receipts per photo

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f<>]/g;
const text = (v, max = 120) => (typeof v === 'string' ? v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const day = (v) => (typeof v === 'string' && DAY_RE.test(v.trim()) && !Number.isNaN(Date.parse(`${v.trim()}T00:00:00Z`)) ? v.trim() : '');

// ---- discounts: a deduction is NEVER an expense ----------------------------------------------------------------------------------------
/** Words of a deduction line in the six languages (and the common Italian till ones): SCONTO, BUONO, DISCOUNT, DESCUENTO, RABATT, COUPON... */
export const DISCOUNT_RE = /\b(sconto|abbuono|riduzione|ribasso|buono|discount|descuento|desconto|rebate|coupon|cup[oó]n|rabatt|nachlass|gutschein|rabais|remise|r[eé]duction|reducci[oó]n|redu[cç][aã]o)\b/i;
export const isDiscountLine = (it) => DISCOUNT_RE.test(String(it?.description || ''));
const money2 = (n) => Math.round(n * 100) / 100;
const sumItems = (list) => money2(list.reduce((s, i) => s + Math.round(i.amount * 100), 0) / 100);

/**
 * Mathematical self-check, server side, on top of the one asked of the model: the lines must add up to the TOTAL PAID. When they add up to MORE
 * (a discount was read as a charge: the line printed "BUONO -1,21" came back as +1,21) and flipping the sign of the deduction-looking lines
 * makes the sum match the total EXACTLY, the signs are corrected. Nothing is guessed: without a printed total, or when no flip matches, the lines stay
 * as read (the review screen then warns). A negative line (global discount) takes the category that carries most of the purchase, so no
 * category of the breakdown can ever go below zero. Mutates `items`.
 */
function settleDiscounts(items, total) {
  if (total === null || !items.length) return;
  const matches = (list) => Math.abs(sumItems(list) - total) <= 0.02;
  if (!matches(items)) {
    const candidates = items.map((it, i) => (it.amount > 0 && isDiscountLine(it) ? i : -1)).filter((i) => i >= 0);
    const flipped = (idx) => items.map((it, i) => (idx.includes(i) ? { ...it, amount: -it.amount } : it));
    const attempts = candidates.length ? [candidates, ...candidates.map((i) => [i])] : [];
    for (const idx of attempts) {
      const next = flipped(idx);
      if (matches(next)) {
        idx.forEach((i) => {
          items[i].amount = -items[i].amount;
        });
        break;
      }
    }
  }
  const byCategory = new Map();
  for (const it of items) if (it.amount > 0) byCategory.set(it.category, (byCategory.get(it.category) || 0) + it.amount);
  const dominant = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const it of items) {
    if (it.amount < 0) {
      if (dominant) it.category = dominant;
      it.returnDate = '';
    }
  }
}

/** { itemsSum, total, diff, inflated, ok } of a receipt (null without a printed total): `inflated` = the lines add up to MORE than was paid. */
export function receiptSumCheck(receipt) {
  const total = receipt?.total;
  if (!(Number(total) > 0) || !Array.isArray(receipt?.items) || !receipt.items.length) return null;
  const itemsSum = sumItems(receipt.items);
  const diff = money2(itemsSum - total);
  return { itemsSum, total, diff, inflated: diff > 0.02, ok: Math.abs(diff) <= 0.02 };
}

/**
 * Clean ONE untrusted receipt (a photo may hold several: see normalizeReceipts):
 *   { isReceipt, currency, supplier, sucursal|null, date, purchaseType, total|null, vendorTaxId|null, documentType|null, documentNumber|null,
 *     paymentMethod|null, netAmount|null, taxAmount|null, items: [{ description, quantity|null, unitPrice|null, amount, category, returnDate }] }
 * `category` / `purchaseType` are whitelisted (EXPENSE_CATEGORIES): anything unknown becomes the purchase's type or 'other'.
 * `amount` is the LINE TOTAL actually paid (the printed text wins over the model's own number); lines without a
 * positive amount are dropped. Only rented tools / machinery keep a `returnDate`.
 */
export function normalizeReceipt(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  // the kind of purchase as a whole: the fallback category of a line whose own category is missing or unknown (a new / foreign value never breaks the parser)
  const purchaseType = EXPENSE_CATEGORIES.includes(src.purchaseType) ? src.purchaseType : '';
  const total = (() => {
    const printed = parseAmount(src.totalText);
    const n = printed ?? (typeof src.total === 'number' && Number.isFinite(src.total) && src.total > 0 ? src.total : null);
    return n !== null && n <= MAX_PRICE * 100 ? Math.round(n * 100) / 100 : null;
  })();
  const supplier = text(src.vendorName || src.supplier, 60); // `vendorName` is what the AI answers; `supplier` is the name already stored / normalised
  // the branch / street address printed on the paper (null when none): `sucursal` is the key the AI answers and the one we store; `branch` is accepted too
  const sucursal = text(src.sucursal ?? src.branch, 80) || null;
  // ---- fiscal metadata (audit): null whenever the paper did not show it, never invented ----------------------------------
  const vendorTaxId = cleanFiscalCode(src.vendorTaxId, 24) || null;
  const documentNumber = cleanFiscalCode(src.documentNumber, 32) || null;
  const documentType = oneOfOrEmpty(src.documentType, DOCUMENT_TYPES) || null;
  const paymentMethod = oneOfOrEmpty(src.paymentMethod, PAYMENT_METHODS) || null;
  const part = (printedText, n) => {
    // the printed text wins over the model's number; 0 is a real value (exempt document)
    const v = parseAmount(printedText) ?? (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null);
    return v !== null && v <= MAX_PRICE * 100 ? Math.round(v * 100) / 100 : null;
  };
  let netAmount = part(src.netAmountText, src.netAmount);
  let taxAmount = part(src.taxAmountText, src.taxAmount);
  // net or tax cannot exceed the grand total: a misread is dropped, and the missing one is derived from the other + the total
  if (total !== null && netAmount !== null && netAmount > total + 0.01) netAmount = null;
  if (total !== null && taxAmount !== null && taxAmount > total + 0.01) taxAmount = null;
  if (total !== null && netAmount === null && taxAmount !== null && total - taxAmount > 0) netAmount = Math.round((total - taxAmount) * 100) / 100;
  if (total !== null && taxAmount === null && netAmount !== null) taxAmount = Math.round(Math.max(0, total - netAmount) * 100) / 100;
  const items = [];
  for (const it of Array.isArray(src.items) ? src.items.slice(0, RECEIPT_LIMITS.maxItems * 2) : []) {
    if (!it || typeof it !== 'object') continue;
    // SIGNED: a deduction ("BUONO -1,21", "SCONTO 2,41-", "(1,21)") is negative, never a charge. The printed text wins over the model's number;
    // when the text lost its sign but the model's number is the same size and negative, the model's sign is kept.
    const printed = parseSignedAmount(it.amountText);
    const numeric = typeof it.amount === 'number' && Number.isFinite(it.amount) && it.amount !== 0 ? it.amount : null;
    let amount = printed ?? numeric;
    if (printed !== null && printed > 0 && numeric !== null && numeric < 0 && Math.abs(Math.abs(numeric) - printed) <= 0.011) amount = -printed;
    if (amount === null || Math.abs(amount) > MAX_PRICE * 100) continue;
    const category = EXPENSE_CATEGORIES.includes(it.category) ? it.category : purchaseType || 'other';
    const quantity = Number(it.quantity);
    const unit = parseAmount(it.unitPriceText) ?? (typeof it.unitPrice === 'number' && Number.isFinite(it.unitPrice) && it.unitPrice > 0 ? it.unitPrice : null);
    items.push({
      description: text(it.description),
      quantity: Number.isFinite(quantity) && quantity > 0 && quantity <= INVOICE_LIMITS.maxQty ? quantity : null,
      unitPrice: unit !== null && unit <= MAX_PRICE * 100 ? Math.round(unit * 100) / 100 : null,
      amount: Math.round(amount * 100) / 100,
      category,
      returnDate: RENTAL_CATEGORIES.includes(category) ? day(it.returnDate) : '',
    });
    if (items.length >= RECEIPT_LIMITS.maxItems) break;
  }
  settleDiscounts(items, total);
  const isReceipt = src.isReceipt !== false;
  // a slip with only a grand total (restaurant, fuel ticket) is still one valid expense
  if (isReceipt && !items.length && total !== null) items.push({ description: '', quantity: null, unitPrice: null, amount: total, category: purchaseType || 'other', returnDate: '' });
  const currency = typeof src.currency === 'string' && /^[A-Za-z]{3}$/.test(src.currency.trim()) ? src.currency.trim().toUpperCase() : '';
  return { isReceipt, currency, supplier, sucursal, date: day(src.receiptDate) || day(src.date), purchaseType, total, vendorTaxId, documentType, documentNumber, paymentMethod, netAmount, taxAmount, items };
}

/** The document-level data of a receipt that every expense line copies (what the callers pass to expensesFromRows). */
export const receiptMeta = (receipt) => ({
  supplier: receipt?.supplier || '',
  sucursal: receipt?.sucursal ?? null,
  date: receipt?.date || '',
  currency: receipt?.currency || '',
  vendorTaxId: receipt?.vendorTaxId ?? null,
  documentType: receipt?.documentType ?? null,
  documentNumber: receipt?.documentNumber ?? null,
  paymentMethod: receipt?.paymentMethod ?? null,
  netAmount: receipt?.netAmount ?? null,
  taxAmount: receipt?.taxAmount ?? null,
});

/**
 * Review rows -> expense records ready to store in the project (the user may have edited / unticked rows).
 * The document's NET and TAX are PRORATED over the lines by their share of the total (net + tax), so every line carries its own
 * net / tax and the columns add up to the document's figures however many lines the user keeps.
 */
export function expensesFromRows(rows, { supplier = '', sucursal = null, date = '', currency = '', vendorTaxId = null, documentType = null, documentNumber = null, paymentMethod = null, netAmount = null, taxAmount = null, now = Date.now() } = {}) {
  const branch = text(sucursal, 80);
  const taxId = cleanFiscalCode(vendorTaxId, 24);
  const folio = cleanFiscalCode(documentNumber, 32);
  const kind = oneOfOrEmpty(documentType, DOCUMENT_TYPES);
  const pay = oneOfOrEmpty(paymentMethod, PAYMENT_METHODS);
  const base = Number(netAmount) + Number(taxAmount);
  const split = netAmount !== null && taxAmount !== null && Number.isFinite(base) && base > 0 ? Number(netAmount) / base : null;
  const docId = newEntryId(); // one id per receipt document: its lines stay grouped (a photo can hold several documents)
  return rows
    .filter((r) => r.selected && r.amount !== 0) // a negative line (global discount) is kept: it lowers the total, it is never a charge
    .map((r) => {
      const net = split === null ? null : Math.round(r.amount * split * 100) / 100;
      return {
        id: newEntryId(),
        at: now,
        supplier,
        description: r.description,
        amount: r.amount,
        category: r.category,
        returnDate: RENTAL_CATEGORIES.includes(r.category) ? r.returnDate || '' : '',
        returned: false,
        docId,
        // the transcription for the spreadsheet: date printed on the receipt, its currency, and the quantity / unit price of the line
        ...(DAY_RE.test(date) ? { date } : {}),
        ...(/^[A-Z]{3}$/.test(currency) ? { currency } : {}),
        ...(r.quantity > 0 ? { quantity: r.quantity } : {}),
        ...(r.unitPrice > 0 ? { unitPrice: r.unitPrice } : {}),
        ...(branch ? { sucursal: branch } : {}), // where the purchase was made (for warranty returns)
        // fiscal metadata (see normalizeExpenses): only what the paper showed
        ...(taxId ? { vendorTaxId: taxId } : {}),
        ...(kind ? { documentType: kind } : {}),
        ...(folio ? { documentNumber: folio } : {}),
        ...(pay ? { paymentMethod: pay } : {}),
        ...(net !== null ? { netAmount: net, taxAmount: Math.round((r.amount - net) * 100) / 100 } : {}),
      };
    });
}

/**
 * The answer for a whole PHOTO: one image can hold ONE OR SEVERAL receipts / invoices / tickets, each an independent record.
 * Accepts the batch `{ isReceipt, receipts: [..] }` and, for older answers, a single receipt object. Every receipt is cleaned by
 * normalizeReceipt; those that are not a receipt or have no readable line are dropped.
 * @returns {{ isReceipt: boolean, receipts: object[] }}  isReceipt false = the photo holds no purchase document at all
 */
export function normalizeReceipts(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(src.receipts) ? src.receipts.slice(0, RECEIPT_LIMITS.maxReceipts * 2) : [src];
  const clean = list.map((r) => normalizeReceipt(r));
  const receipts = clean.filter((r) => r.isReceipt && r.items.length).slice(0, RECEIPT_LIMITS.maxReceipts);
  const none = src.isReceipt === false || (clean.length > 0 && clean.every((r) => !r.isReceipt));
  return { isReceipt: !none, receipts };
}

/** `receipts` of a batch answer, or [receipt] for the single-receipt shape (older answers, queue rows saved before batches). */
export const asReceipts = (x) => (Array.isArray(x?.receipts) ? x.receipts : x && Array.isArray(x.items) ? [x] : []);

const toRows = (receipt, prefix = 'r') => receipt.items.map((it, i) => ({ ...it, key: `${prefix}${i}`, selected: true }));

/** Every receipt of a batch -> expense records: one independent group (own docId, own fiscal data and net / tax split) per receipt. */
export const batchExpenses = (receipts, { now = Date.now() } = {}) => receipts.flatMap((r) => expensesFromRows(toRows(r), { ...receiptMeta(r), now }));

/** Send ONE compressed photo to the proxy ({kind:'receipt'}) and return its clean receipts: `{ isReceipt: true, receipts: [..] }` (1 or more). */
export async function requestReceipt(dataUrl, opts = {}) {
  const body = await postImage(dataUrl, { ...opts, kind: 'receipt' });
  const batch = normalizeReceipts(body);
  if (!batch.isReceipt) throw new InvoiceError('not_invoice');
  if (!batch.receipts.length) throw new InvoiceError('unreadable');
  return batch;
}

// ---- Smart deduplication ---------------------------------------------------------------------------------------------------------------
// The same paper scanned twice (a batch of photos, a retry, a queued photo that was also taken online) must not count twice. A DOCUMENT's
// fingerprint is its total + the date printed on it + the shop name (normalized: no case, accents, punctuation or spacing). All three must
// be known: a receipt without date or without shop is never discarded (better a double than a lost purchase).

/** "Sodimac  S.A." / "SODIMAC S.A" / "sodímac sa" -> "sodimacsa". */
export const normalizeShop = (name) => (typeof name === 'string' ? name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '') : '');

/** `null` when the document cannot be fingerprinted. `amount` = the sum of its lines. */
export function receiptFingerprint({ amount, date, supplier }) {
  const cents = Math.round((Number(amount) || 0) * 100);
  const shop = normalizeShop(supplier);
  return cents > 0 && DAY_RE.test(date || '') && shop ? `${cents}|${date}|${shop}` : null;
}

/** Expenses grouped by document (lines of one receipt share `docId`; a manual expense is a document of one line). */
const documentsOf = (expenses) => {
  const docs = new Map();
  for (const e of Array.isArray(expenses) ? expenses : []) {
    const key = e?.docId || `line:${e?.id}`;
    const d = docs.get(key) || { amount: 0, date: e?.date, supplier: e?.supplier };
    d.amount += Number(e?.amount) || 0;
    docs.set(key, d);
  }
  return [...docs.values()];
};

/** The set of fingerprints the project already holds. */
export const expenseFingerprints = (expenses) => new Set(documentsOf(expenses).map(receiptFingerprint).filter(Boolean));

/** Split scanned receipts (normalizeReceipt shape) into the new ones and the ones already stored. */
export function dropDuplicateReceipts(receipts, existing) {
  const known = expenseFingerprints(existing);
  const fresh = [];
  let skipped = 0;
  for (const r of receipts) {
    const fp = receiptFingerprint({ amount: r.items.reduce((s, it) => s + (Number(it.amount) || 0), 0), date: r.date, supplier: r.supplier });
    if (fp && known.has(fp)) skipped += 1;
    else fresh.push(r);
  }
  return { fresh, skipped };
}

/** Same for ready expense lines (the offline queue path): each `docId` is one document. Returns the lines to add and how many documents were skipped. */
export function dropDuplicateExpenses(lines, existing) {
  const known = expenseFingerprints(existing);
  const byDoc = new Map();
  for (const e of lines) byDoc.set(e.docId || `line:${e.id}`, [...(byDoc.get(e.docId || `line:${e.id}`) || []), e]);
  const fresh = [];
  let skipped = 0;
  for (const group of byDoc.values()) {
    const [d] = documentsOf(group);
    const fp = receiptFingerprint(d);
    if (fp && known.has(fp)) skipped += 1;
    else fresh.push(...group);
  }
  return { fresh, skipped };
}
