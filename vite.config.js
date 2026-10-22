import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pwaBrand from './plugins/pwa-brand.js';

export default defineConfig(({ mode }) => ({
  // Relative base => the same build works at a domain root or in a sub-path (GitHub Pages).
  base: './',
  plugins: [react(), pwaBrand()],
  esbuild:
    mode === 'production'
      ? { drop: ['console', 'debugger'], legalComments: 'none' }
      : { legalComments: 'none' },
  build: {
    target: 'es2019',
    sourcemap: false, // never ship source maps: protects proprietary logic
    minify: 'esbuild',
    cssMinify: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 700,
  },
  // Fixed dev port so the Google OAuth "Authorized JavaScript origin" (http://localhost:3000) always matches.
  server: { port: 3000, strictPort: true },
  preview: { port: 3000, strictPort: true },
  test: {
    environment: 'node',
    // Tests must not depend on a developer's .env.local: Google is unconfigured unless a test stubs it.
    env: { VITE_GOOGLE_CLIENT_ID: '' },
    pool: 'threads', // the default forks pool is unstable on some Node 18 setups
    include: ['tests/**/*.test.js'],
  },
}));
