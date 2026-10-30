// AI receipt reading ("Escanear Boleta"): the photo of ANY purchase / rental receipt becomes tabulated
// expense lines for the rendición de cuentas, and rented tools / machinery come with the day they must go back.
// Pure logic shared by the browser and the server proxy (same rules as invoice.js: whatever the model prints is
// treated as untrusted data and reduced to a clean, bounded structure).

import { InvoiceError, INVOICE_LIMITS, parseAmount, postImage } from './invoice.js';
import { MAX_PRICE } from './pricing.js';
import { DOCUMENT_TYPES, EXPENSE_CATEGORIES, PAYMENT_METHODS, RENTAL_CATEGORIES, cleanFiscalCode, newEntryId, oneOfOrEmpty } from './ledger.js';

export const RECEIPT_LIMITS = Object.freeze({ maxItems: 40 });

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f<>]/g;
const text = (v, max = 120) => (typeof v === 'string' ? v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const day = (v) => (typeof v === 'string' && DAY_RE.test(v.trim()) && !Number.isNaN(Date.parse(`${v.trim()}T00:00:00Z`)) ? v.trim() : '');

/**
 * Clean an untrusted receipt extraction:
 *   { isReceipt, currency, supplier, date, purchaseType, total|null, vendorTaxId|null, documentType|null, documentNumber|null,
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
  const supplier = text(src.supplier, 60);
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
    const printed = parseAmount(it.amountText);
    const fallback = typeof it.amount === 'number' && Number.isFinite(it.amount) && it.amount > 0 ? it.amount : null;
    const amount = printed ?? fallback;
    if (amount === null || amount > MAX_PRICE * 100) continue;
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
  const isReceipt = src.isReceipt !== false;
  // a slip with only a grand total (restaurant, fuel ticket) is still one valid expense
  if (isReceipt && !items.length && total !== null) items.push({ description: '', quantity: null, unitPrice: null, amount: total, category: purchaseType || 'other', returnDate: '' });
  const currency = typeof src.currency === 'string' && /^[A-Za-z]{3}$/.test(src.currency.trim()) ? src.currency.trim().toUpperCase() : '';
  return { isReceipt, currency, supplier, date: day(src.receiptDate) || day(src.date), purchaseType, total, vendorTaxId, documentType, documentNumber, paymentMethod, netAmount, taxAmount, items };
}

/** The document-level data of a receipt that every expense line copies (what the callers pass to expensesFromRows). */
export const receiptMeta = (receipt) => ({
  supplier: receipt?.supplier || '',
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
export function expensesFromRows(rows, { supplier = '', date = '', currency = '', vendorTaxId = null, documentType = null, documentNumber = null, paymentMethod = null, netAmount = null, taxAmount = null, now = Date.now() } = {}) {
  const taxId = cleanFiscalCode(vendorTaxId, 24);
  const folio = cleanFiscalCode(documentNumber, 32);
  const kind = oneOfOrEmpty(documentType, DOCUMENT_TYPES);
  const pay = oneOfOrEmpty(paymentMethod, PAYMENT_METHODS);
  const base = Number(netAmount) + Number(taxAmount);
  const split = netAmount !== null && taxAmount !== null && Number.isFinite(base) && base > 0 ? Number(netAmount) / base : null;
  return rows
    .filter((r) => r.selected && r.amount > 0)
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
        // the transcription for the spreadsheet: date printed on the receipt, its currency, and the quantity / unit price of the line
        ...(DAY_RE.test(date) ? { date } : {}),
        ...(/^[A-Z]{3}$/.test(currency) ? { currency } : {}),
        ...(r.quantity > 0 ? { quantity: r.quantity } : {}),
        ...(r.unitPrice > 0 ? { unitPrice: r.unitPrice } : {}),
        // fiscal metadata (see normalizeExpenses): only what the paper showed
        ...(taxId ? { vendorTaxId: taxId } : {}),
        ...(kind ? { documentType: kind } : {}),
        ...(folio ? { documentNumber: folio } : {}),
        ...(pay ? { paymentMethod: pay } : {}),
        ...(net !== null ? { netAmount: net, taxAmount: Math.round((r.amount - net) * 100) / 100 } : {}),
      };
    });
}

/** Send ONE compressed receipt photo to the proxy ({kind:'receipt'}) and return the clean extraction. */
export async function requestReceipt(dataUrl, opts = {}) {
  const body = await postImage(dataUrl, { ...opts, kind: 'receipt' });
  const receipt = normalizeReceipt(body);
  if (!receipt.isReceipt) throw new InvoiceError('not_invoice');
  if (!receipt.items.length) throw new InvoiceError('unreadable');
  return receipt;
}
