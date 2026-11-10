// Direct, client-side call to Google AI Studio (Gemini) with the USER'S OWN key (BYOK, see geminiKey.js).
//
// There is no server in the middle any more: the photo goes from the phone to
//   <GEMINI_BASE>/<model>:generateContent?key=<userGeminiKey>      (Google's v1beta models endpoint, see geminiRequests.js)
// (allowed by `connect-src` in security/policy.js and vercel.json) and the free-tier quota that is spent is the user's. The prompts, schemas and request builders
// are the pure ones of geminiRequests.js; whatever comes back is untrusted JSON that the callers pass through normalizeExtraction /
// normalizeReceipts / normalizeBook.
//
// Failure contract (stable `InvoiceError.code`, translated by the UI and used by the offline queue to decide "retry later" vs "never"):
//   no_key        there is no key on this device (nothing is sent)        bad_key       Google rejected the key (400 API key / 401 / 403)
//   rate_limited  free quota or rate limit (429). `err.retryAfterMs` carries Google's own wait (Retry-After header / RetryInfo.retryDelay), 0 when it gave none.
//                 It is NOT an error for the user: the receipt flow parks the photo in the queue and the queue backs off (rateGate.js).
//                                                                         timeout / network / upstream   connectivity or Google trouble
//   too_large     413                                                     bad_image     the picture is not a jpeg / png / webp data URL
//   unreadable    Google blocked the content or answered nothing usable   cancelled     the caller aborted

import { getGeminiKey } from './geminiKey.js';
import { DEFAULT_MODEL, FALLBACK_MODEL, GEMINI_BASE, buildGeminiRequest, buildPricesRequest, parseModelJson } from './geminiRequests.js';
import { normalizeBook } from './priceBook.js';
import { parseRetryAfter, parseRetryDelay } from './rateGate.js';
import { getRegion } from './regions.js';

export class InvoiceError extends Error {
  /** @param code see ERROR_CODES   @param extra { retryAfterMs } only for 'rate_limited': how long Google asked us to wait (0 = it did not say) */
  constructor(code, { retryAfterMs = 0 } = {}) {
    super(`invoice:${code}`);
    this.code = code;
    if (code === 'rate_limited') this.retryAfterMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.round(retryAfterMs) : 0;
  }
}

export const ERROR_CODES = Object.freeze(['no_key', 'bad_key', 'not_configured', 'rate_limited', 'bad_image', 'too_large', 'not_invoice', 'unreadable', 'upstream', 'timeout', 'network', 'cancelled', 'forbidden']);

export const GEMINI_LIMITS = Object.freeze({
  attemptMs: 25_000, // one request to one model
  totalMs: 45_000, // every attempt of one call together (the user is waiting)
});

const RETRY_STATUS = new Set([404, 408, 500, 502, 503, 504]); // "model gone" / transient: the next model may work
const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** `data:image/...;base64,...` -> { mime, data }, or null when it is not a jpeg / png / webp data URL (the photo of the sheet is always one). */
export function parseImageDataUrl(dataUrl) {
  const m = typeof dataUrl === 'string' ? IMAGE_RE.exec(dataUrl) : null;
  return m && m[2].length >= 4 ? { mime: m[1], data: m[2] } : null;
}

const pad = (n) => String(n).padStart(2, '0');
const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Google's error answer -> a stable code ('' = nothing to say). Only the status / message text is read, never forwarded. */
async function upstreamCode(res) {
  let text = '';
  try {
    const j = await res.json();
    text = `${j?.error?.status ?? ''} ${j?.error?.message ?? ''}`;
  } catch {
    /* no body */
  }
  return /API[_ ]KEY|API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED/i.test(text) ? 'bad_key' : '';
}

/** How long a 429 asks us to wait: the `Retry-After` header, else Google's `RetryInfo.retryDelay` in the JSON body ("32s"). 0 = it did not say. Never throws. */
async function retryAfterOf(res, nowMs) {
  const header = parseRetryAfter(res.headers?.get?.('retry-after'), nowMs);
  if (header > 0) return header;
  try {
    const details = (await res.json())?.error?.details;
    for (const d of Array.isArray(details) ? details : []) {
      const ms = parseRetryDelay(d?.retryDelay);
      if (ms > 0) return ms;
    }
  } catch {
    /* no body */
  }
  return 0;
}

/**
 * The transport shared by every kind of request (documents, prices, the Copilot chat): ONE POST per model with the fallback list, the per-attempt and total
 * time limits, the typed failures above and the 429 reading. Resolves with Google's raw JSON answer, or throws InvoiceError. No prompt, no key lookup:
 * `bodyFor(model)` builds the request and `key` is already the clean user's key.
 */
export async function geminiGenerate({ bodyFor, key, fetchImpl = globalThis.fetch, signal, attemptMs = GEMINI_LIMITS.attemptMs, now = Date.now, deadline = now() + GEMINI_LIMITS.totalMs, models = [DEFAULT_MODEL, FALLBACK_MODEL] }) {
  let last = new InvoiceError('upstream');
  for (const model of models) {
    if (signal?.aborted) throw new InvoiceError('cancelled');
    const left = deadline - now();
    if (left <= 0) throw new InvoiceError('timeout');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.min(attemptMs, left));
    const onAbort = () => ctl.abort();
    signal?.addEventListener?.('abort', onAbort);
    let res;
    try {
      res = await fetchImpl(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyFor(model)),
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: ctl.signal,
      });
    } catch {
      if (signal?.aborted) throw new InvoiceError('cancelled');
      last = new InvoiceError(ctl.signal.aborted ? 'timeout' : 'network');
      continue;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
    if (res.status === 429) {
      // typed, never fatal on its own: the other model may have its own quota; whoever catches it decides (queue + backoff, see ReceiptSheet / receiptSync)
      const wait = await retryAfterOf(res, now());
      last = new InvoiceError('rate_limited', { retryAfterMs: Math.max(wait, last?.retryAfterMs || 0) });
      continue;
    }
    if (res.status === 413) throw new InvoiceError('too_large');
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new InvoiceError('bad_key'); // another model will not change that
      if (res.status === 400) throw new InvoiceError((await upstreamCode(res)) || 'upstream');
      last = new InvoiceError('upstream');
      if (RETRY_STATUS.has(res.status)) continue;
      throw last;
    }
    try {
      return await res.json();
    } catch {
      last = new InvoiceError('upstream');
    }
  }
  throw last;
}

/**
 * ONE direct request to Gemini (model fallback included). Resolves with the model's parsed JSON, or throws InvoiceError.
 *
 * @param {object} o
 *   kind        'invoice' | 'receipt' | 'prices'
 *   dataUrl     the compressed photo (invoice / receipt)
 *   currency    ISO 4217 code expected on the document
 *   regionCode  market of the price list (kind 'prices'); skip = { materials, rent } ids the user's suppliers already cover
 *   apiKey      the user's key (default: the one stored on this device)
 *   fetchImpl   injectable fetch (tests)
 *   signal      caller's AbortSignal
 */
export async function callGemini({
  kind = 'invoice',
  dataUrl = '',
  currency = '',
  regionCode = '',
  skip = null,
  apiKey = getGeminiKey(),
  fetchImpl = globalThis.fetch,
  signal,
  attemptMs = GEMINI_LIMITS.attemptMs,
  totalMs = GEMINI_LIMITS.totalMs,
  models = [DEFAULT_MODEL, FALLBACK_MODEL],
  now = Date.now,
} = {}) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) throw new InvoiceError('no_key'); // before anything is read or sent: the photo stays where it is (queue / sheet)
  const prices = kind === 'prices';
  const receipt = kind === 'receipt';
  const image = prices ? null : parseImageDataUrl(dataUrl);
  if (!prices && !image) throw new InvoiceError('bad_image');
  const region = prices ? getRegion(regionCode) : null;
  if (prices && !region) throw new InvoiceError('bad_image');
  const base = { mime: image?.mime, data: image?.data, currency: typeof currency === 'string' ? currency : '', kind: receipt ? 'receipt' : 'invoice', today: localDay(now()) };

  const deadline = now() + totalMs;
  const attempt = (bodyFor) => geminiGenerate({ bodyFor, key, fetchImpl, signal, attemptMs, deadline, models, now });

  const bodyFor = (grounded) => (model) => (prices ? buildPricesRequest({ regionCode: region.code, model, grounded, skip }) : buildGeminiRequest({ ...base, model }));
  const parsedOf = (payload) => (payload && !payload.promptFeedback?.blockReason ? parseModelJson(payload) : null);

  let payload = null;
  try {
    payload = await attempt(bodyFor(true)); // prices: GROUNDED (google_search): the model looks the prices up on the web
  } catch (err) {
    // a failed grounded request still gets the plain estimate, except when a second request cannot help (key, cancel, deadline, size)
    if (!prices || !(err instanceof InvoiceError) || ['no_key', 'bad_key', 'cancelled', 'timeout', 'too_large'].includes(err.code)) throw err;
  }
  if (prices) {
    const usable = (p) => {
      const parsed = parsedOf(p);
      return Boolean(parsed && normalizeBook({ ...parsed, region: region.code, at: 1 }, region.code));
    };
    if (!usable(payload)) {
      // only when the grounded request produced nothing usable (tool refused, quota of the tool, unreadable text): one plain
      // schema-constrained estimate, so the app still gets a price list
      payload = await attempt(bodyFor(false));
    }
  }
  if (payload?.promptFeedback?.blockReason) throw new InvoiceError('unreadable');
  const parsed = parsedOf(payload);
  if (!parsed) throw new InvoiceError('unreadable');
  return parsed;
}
