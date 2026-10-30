// AI receipt reading ("Escanear Boleta"): the photo of ANY purchase / rental receipt becomes tabulated
// expense lines for the rendición de cuentas, and rented tools / machinery come with the day they must go back.
// Pure logic shared by the browser and the server proxy (same rules as invoice.js: whatever the model prints is
// treated as untrusted data and reduced to a clean, bounded structure).

import { InvoiceError, INVOICE_LIMITS, parseAmount, postImage } from './invoice.js';
import { MAX_PRICE } from './pricing.js';
import { EXPENSE_CATEGORIES, RENTAL_CATEGORIES, newEntryId } from './ledger.js';

export const RECEIPT_LIMITS = Object.freeze({ maxItems: 40 });

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f<>]/g;
const text = (v, max = 120) => (typeof v === 'string' ? v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const day = (v) => (typeof v === 'string' && DAY_RE.test(v.trim()) && !Number.isNaN(Date.parse(`${v.trim()}T00:00:00Z`)) ? v.trim() : '');

/**
 * Clean an untrusted receipt extraction:
 *   { isReceipt, currency, supplier, date, purchaseType, total|null, items: [{ description, quantity|null, unitPrice|null, amount, category, returnDate }] }
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
  return { isReceipt, currency, supplier, date: day(src.receiptDate) || day(src.date), purchaseType, total, items };
}

/** Review rows -> expense records ready to store in the project (the user may have edited / unticked rows). */
export function expensesFromRows(rows, { supplier = '', now = Date.now() } = {}) {
  return rows
    .filter((r) => r.selected && r.amount > 0)
    .map((r) => ({
      id: newEntryId(),
      at: now,
      supplier,
      description: r.description,
      amount: r.amount,
      category: r.category,
      returnDate: RENTAL_CATEGORIES.includes(r.category) ? r.returnDate || '' : '',
      returned: false,
    }));
}

/** Send ONE compressed receipt photo to the proxy ({kind:'receipt'}) and return the clean extraction. */
export async function requestReceipt(dataUrl, opts = {}) {
  const body = await postImage(dataUrl, { ...opts, kind: 'receipt' });
  const receipt = normalizeReceipt(body);
  if (!receipt.isReceipt) throw new InvoiceError('not_invoice');
  if (!receipt.items.length) throw new InvoiceError('unreadable');
  return receipt;
}
