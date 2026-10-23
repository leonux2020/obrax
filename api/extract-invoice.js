// Serverless entry (Vercel `api/` convention) for production hosting: same handler as the Vite dev proxy.
// Configure GEMINI_API_KEY (and optionally GEMINI_MODEL) in the host's environment variables, never in the repo.
import { createInvoiceHandler } from '../server/geminiProxy.js';
import { readGeminiConfig } from '../server/env.js';
import { toNodeHandler } from '../server/node.js';

let handle = null;
export default function extractInvoice(req, res) {
  handle ??= toNodeHandler(createInvoiceHandler(readGeminiConfig(process.env)), { trustProxy: true });
  return handle(req, res);
}
