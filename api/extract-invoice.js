// Serverless entry (Vercel `api/` convention) for production hosting: same handler as the Vite dev proxy.
// Configure GEMINI_API_KEY (and optionally GEMINI_MODEL) in the host's environment variables, never in the repo.
import { createInvoiceHandler } from '../server/geminiProxy.js';
import { readGeminiConfig } from '../server/env.js';
import { toNodeHandler } from '../server/node.js';

let handle = null;
export default function extractInvoice(req, res) {
  if (!handle) {
    const cfg = readGeminiConfig(process.env);
    // Production never sends an exception to the browser; it is always written to the function log (Vercel > Logs).
    // Outside production (vercel dev, local runs) the real error also travels in the 500 payload as `detail`.
    const dev = process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
    handle = toNodeHandler(createInvoiceHandler({ ...cfg, log: (line) => console.error(`[extract-invoice] ${line}`) }), { trustProxy: true, devErrors: dev, secrets: [cfg.apiKey] });
  }
  return handle(req, res);
}
