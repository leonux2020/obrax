import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildIconSvg, buildLockupSvg, buildManifest, PNG_ICONS, LOGO_FILE, BRAND } from '../src/brand/icon.js';
import { CSP_META, buildHeadersFile } from '../security/policy.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function renderPng(svg, size) {
  const sharp = (await import('sharp')).default;
  return sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

const NEVER_PRECACHE = /(^sw\.js$|^_headers$|\.map$|^robots\.txt$|^vercel\.json$)/;

/**
 * Brand + PWA plugin.
 *  - serves manifest/icons in dev (generated from src/brand/icon.js)
 *  - injects <link> tags (manifest, favicon, apple-touch-icon), theme color and CSP (build only)
 *  - at build end writes manifest.json, icon.svg, PNG icons, _headers and a versioned sw.js
 */
export default function pwaBrand() {
  let outDir = 'dist';
  let root = process.cwd();
  const pngCache = new Map();

  const getPng = async (def) => {
    if (!pngCache.has(def.file)) {
      pngCache.set(def.file, await renderPng(buildIconSvg({ maskable: def.maskable }), def.size));
    }
    return pngCache.get(def.file);
  };

  const manifestJson = () => JSON.stringify(buildManifest(), null, 2);

  return [
    {
      name: 'pwa-brand:dev-and-html',
      configResolved(config) {
        outDir = path.resolve(config.root, config.build.outDir);
        root = config.root;
      },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = (req.url || '').split('?')[0];
          try {
            if (url === '/manifest.json') {
              res.setHeader('Content-Type', 'application/manifest+json');
              return res.end(manifestJson());
            }
            if (url === '/icon.svg') {
              res.setHeader('Content-Type', 'image/svg+xml');
              return res.end(buildIconSvg());
            }
            if (url === `/${LOGO_FILE}`) {
              res.setHeader('Content-Type', 'image/png');
              return res.end(await renderPng(buildLockupSvg(), 1024));
            }
            const def = PNG_ICONS.find((p) => `/${p.file}` === url);
            if (def) {
              res.setHeader('Content-Type', 'image/png');
              return res.end(await getPng(def));
            }
          } catch (err) {
            return next(err);
          }
          return next();
        });
      },
      transformIndexHtml(_html, ctx) {
        const tags = [
          { tag: 'link', attrs: { rel: 'manifest', href: './manifest.json' }, injectTo: 'head' },
          {
            tag: 'link',
            attrs: { rel: 'icon', type: 'image/svg+xml', href: './icon.svg' },
            injectTo: 'head',
          },
          {
            tag: 'link',
            attrs: { rel: 'icon', type: 'image/png', sizes: '192x192', href: './icon-192.png' },
            injectTo: 'head',
          },
          {
            tag: 'link',
            attrs: { rel: 'apple-touch-icon', sizes: '180x180', href: './apple-touch-icon.png' },
            injectTo: 'head',
          },
          { tag: 'meta', attrs: { name: 'application-name', content: BRAND.name }, injectTo: 'head' },
        ];
        // CSP via <meta> only for production builds (dev needs inline HMR scripts).
        if (!ctx.server) {
          tags.unshift({
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP_META },
            injectTo: 'head-prepend',
          });
        }
        return tags;
      },
    },
    {
      name: 'pwa-brand:emit',
      apply: 'build',
      enforce: 'post',
      async closeBundle() {
        if (!fs.existsSync(outDir)) return;

        fs.writeFileSync(path.join(outDir, 'manifest.json'), manifestJson());
        fs.writeFileSync(path.join(outDir, 'icon.svg'), buildIconSvg());
        for (const def of PNG_ICONS) {
          fs.writeFileSync(path.join(outDir, def.file), await getPng(def));
        }
        fs.writeFileSync(path.join(outDir, LOGO_FILE), await renderPng(buildLockupSvg(), 1024));
        fs.writeFileSync(path.join(outDir, '_headers'), buildHeadersFile());

        // Precache list + content-hash version => atomic, offline-safe updates.
        const files = walk(outDir).filter((f) => !NEVER_PRECACHE.test(f)).sort();
        const template = fs.readFileSync(path.join(here, 'sw.template.js'), 'utf8');
        const hash = crypto.createHash('sha256');
        hash.update(template);
        for (const f of files) {
          hash.update(f);
          hash.update(fs.readFileSync(path.join(outDir, f)));
        }
        const version = hash.digest('hex').slice(0, 12);
        const urls = ['./', ...files.map((f) => `./${f}`)];

        const sw = template
          .split('__VERSION__')
          .join(version)
          .split('__PRECACHE__')
          .join(JSON.stringify(urls));
        if (sw.includes('__VERSION__') || sw.includes('__PRECACHE__')) {
          throw new Error('[pwa-brand] service worker placeholders were not fully replaced');
        }
        // Syntax-check the generated worker so a broken SW can never ship.
        new Function(sw); // eslint-disable-line no-new-func
        fs.writeFileSync(path.join(outDir, 'sw.js'), sw);
        // eslint-disable-next-line no-console
        console.log(`\n[pwa-brand] ${urls.length} files precached, SW version ${version} (root: ${root})`);
      },
    },
  ];
}
