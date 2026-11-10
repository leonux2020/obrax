// The "cooling" state of Gemini's free tier. When Google answers 429 (rate limit / quota) the right reaction is NOT an error on the screen: it is to stop
// asking for a while. This tiny gate remembers until when, shared by the two sides that talk to Gemini about receipts:
//
//   ReceiptSheet   while the gate is active a new photo is parked in the receipt queue at once (no request, no waiting, no red text);
//   receiptSync    a drain that gets a 429 closes the gate for every row and waits: Retry-After when Google sends it, else a 60 s pause that doubles
//                  with every consecutive 429 (60 s, 2 min, 4 min ... 15 min); the first answer that works opens it again.
//
// Pure of the browser and of React. One gate per queue (createReceiptQueue), so tests and tabs of the same page never share a stale one.

export const RATE = Object.freeze({
  baseMs: 60_000, // the first pause when Google gives no hint
  maxMs: 15 * 60_000, // ceiling of the exponential growth
  headerMaxMs: 60 * 60_000, // a Retry-After / retryDelay from Google is honoured up to an hour
  minMs: 5_000, // never hammer: even "retry in 1 s" waits a little
});

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** `Retry-After` header: seconds ("30") or an HTTP date -> ms (0 = none / unreadable). */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined) return 0;
  const text = String(value).trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const at = Date.parse(text);
  return Number.isFinite(at) ? Math.max(0, at - now) : 0;
}

/** Google's JSON delay ("32s", "1.5s", "2m") -> ms (0 = none / unreadable). */
export function parseRetryDelay(value) {
  const m = typeof value === 'string' ? /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(value.trim()) : null;
  if (!m) return 0;
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2] || 's'];
  return Math.round(Number(m[1]) * unit);
}

export function createRateGate() {
  let until = 0;
  let hits = 0;
  return {
    /** A 429 just happened. Closes the gate and returns the pause in ms. `retryAfterMs`: what Google said (0 = nothing). */
    hit({ retryAfterMs = 0, now = Date.now() } = {}) {
      hits += 1;
      const told = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? clamp(retryAfterMs, RATE.minMs, RATE.headerMaxMs) : 0;
      const grown = Math.min(RATE.maxMs, RATE.baseMs * 2 ** (hits - 1));
      // first answer: Google's own number (or the base pause); consecutive ones: never less than the exponential step
      const pause = hits === 1 ? told || RATE.baseMs : Math.max(told, grown);
      until = Math.max(until, now + pause);
      return pause;
    },
    /** Is the gate closed right now? */
    active: (now = Date.now()) => until > now,
    /** When it opens again (ms epoch; 0 = open). */
    until: () => until,
    remaining: (now = Date.now()) => Math.max(0, until - now),
    /** Something worked: Google is answering again. */
    reset() {
      until = 0;
      hits = 0;
    },
    get hits() {
      return hits;
    },
  };
}
