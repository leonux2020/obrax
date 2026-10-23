import { loadEnv } from 'vite';
import { createInvoiceHandler } from '../server/geminiProxy.js';
import { readGeminiConfig } from '../server/env.js';
import { toNodeHandler } from '../server/node.js';

export const AI_ROUTE = '/api/extract-invoice';

/**
 * Vite plugin: mounts the invoice proxy on the dev server (`npm run dev`) and on `vite preview`, so the
 * frontend can call /api/extract-invoice on the same origin (localhost:3000) with no CORS and no key in the
 * browser. The key is read from .env.local on the SERVER side only, when the dev server starts (restart it
 * after editing the file). In production the same handler runs as the serverless function in /api.
 *
 * `options.env` / `options.fetchImpl` exist for tests.
 */
export default function aiProxy(options = {}) {
  let handler = null;
  const build = (mode, root, logger) => {
    const env = options.env ?? loadEnv(mode, root, ''); // '' prefix: also non-VITE_ vars, but only on the server
    const cfg = readGeminiConfig(env);
    handler = toNodeHandler(createInvoiceHandler({ ...cfg, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), ...(options.limits ?? {}), log: (line) => logger?.info(`  [ai-proxy] ${line}`) }));
    return cfg.apiKey ? 'ready' : 'missing-key';
  };
  const mount = (server) => {
    server.middlewares.use(AI_ROUTE, (req, res, next) => {
      return handler ? handler(req, res) : next();
    });
  };
  let mode = 'development';
  let root = process.cwd();
  return {
    name: 'obrax-ai-proxy',
    configResolved(cfg) {
      mode = cfg.mode;
      root = cfg.root;
    },
    configureServer(server) {
      const state = build(mode, root, server.config.logger);
      server.config.logger.info(`  [ai-proxy] ${AI_ROUTE} ${state === 'ready' ? 'ready (GEMINI_API_KEY loaded, server side only)' : 'GEMINI_API_KEY missing in .env.local: invoice reading disabled'}`);
      mount(server);
    },
    configurePreviewServer(server) {
      build(mode, root, server.config.logger);
      mount(server);
    },
  };
}
