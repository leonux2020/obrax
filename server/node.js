// Adapter between Node's (req, res) world (Vite middleware, Vercel/Netlify-style functions) and the pure
// invoice handler. It enforces the body cap WHILE reading, so an oversized upload is cut off early.

import { MAX_BODY_BYTES } from './geminiProxy.js';

/** Read the request body as text, aborting past `limit` bytes. Resolves { text, tooLarge }. */
export function readBody(req, limit = MAX_BODY_BYTES) {
  // Some platforms (Vercel) have already parsed the body.
  if (req.body !== undefined && req.body !== null) {
    const text = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    return Promise.resolve({ text, tooLarge: Buffer.byteLength(text) > limit });
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      if (tooLarge) return;
      size += c.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve({ text: tooLarge ? '' : Buffer.concat(chunks).toString('utf8'), tooLarge }));
    req.on('error', reject);
  });
}

export const clientIp = (req, trustProxy = false) => {
  const fwd = trustProxy ? String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return fwd || req.socket?.remoteAddress || 'unknown';
};

/**
 * @param handler  createInvoiceHandler(...)
 * @param opts     { trustProxy } trust X-Forwarded-For only behind a platform that sets it (Vercel)
 *                 { devErrors } DEVELOPMENT ONLY: add the real error (message + stack) to the 500 payload as `detail`
 *                 { secrets }   strings (the API key) scrubbed from anything logged or returned
 *                 { log }       (line) => void, defaults to console.error: the server-side log always gets the real error
 * @returns (req, res) => Promise<void>
 */
export function toNodeHandler(handler, { trustProxy = false, devErrors = false, secrets = [], log = (line) => console.error(line) } = {}) {
  const scrub = (s) => secrets.filter(Boolean).reduce((out, secret) => out.split(secret).join('***'), String(s));
  return async (req, res) => {
    let status;
    let body;
    try {
      const { text, tooLarge } = req.method === 'POST' ? await readBody(req) : { text: '', tooLarge: false };
      if (tooLarge) {
        status = 413;
        body = { ok: false, error: 'too_large' };
      } else {
        ({ status, body } = await handler({ method: req.method, headers: req.headers, ip: clientIp(req, trustProxy), bodyText: text }));
      }
    } catch (err) {
      status = 500;
      body = { ok: false, error: 'upstream' }; // production never leaks the exception to the browser...
      const real = scrub(err?.stack || err?.message || err);
      try {
        log(`[extract-invoice] unhandled error: ${real}`); // ...but the host's function log (Vercel logs / dev terminal) always has it
      } catch {
        /* logging must never break a response */
      }
      if (devErrors) body.detail = real.slice(0, 4000);
    }
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    if (status === 405) res.setHeader('allow', 'POST');
    res.end(JSON.stringify(body));
  };
}
