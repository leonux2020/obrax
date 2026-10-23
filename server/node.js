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
 * @returns (req, res) => Promise<void>
 */
export function toNodeHandler(handler, { trustProxy = false } = {}) {
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
    } catch {
      status = 500;
      body = { ok: false, error: 'upstream' }; // never leak the exception
    }
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    if (status === 405) res.setHeader('allow', 'POST');
    res.end(JSON.stringify(body));
  };
}
