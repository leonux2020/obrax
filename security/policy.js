// Single source for the security policy. Consumed by the Vite plugin, which:
//  - injects the CSP <meta> into index.html (works on hosts that cannot set headers, e.g. GitHub Pages)
//  - emits dist/_headers (Netlify / Cloudflare Pages)
// vercel.json mirrors these values (a unit test keeps them in sync).

export const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
  'style-src': ["'self'", 'https://accounts.google.com/gsi/style'],
  'img-src': ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com'],
  'font-src': ["'self'"],
  'connect-src': ["'self'", 'https://accounts.google.com/gsi/'],
  'frame-src': ['https://accounts.google.com/gsi/'],
  'manifest-src': ["'self'"],
  'worker-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
};

// Directives that are ignored inside <meta http-equiv>; only valid as real headers.
export const CSP_HEADER_ONLY = {
  'frame-ancestors': ["'none'"],
  'upgrade-insecure-requests': [],
};

const serialize = (map) =>
  Object.entries(map)
    .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
    .join('; ');

export const CSP_META = serialize(CSP_DIRECTIVES);
export const CSP_HEADER = serialize({ ...CSP_DIRECTIVES, ...CSP_HEADER_ONLY });

export const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP_HEADER,
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noai, noimageai',
};

export function buildHeadersFile() {
  const lines = ['/*'];
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) lines.push(`  ${k}: ${v}`);
  lines.push(
    '',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/sw.js',
    '  Cache-Control: no-cache',
    '',
    '/index.html',
    '  Cache-Control: no-cache',
    '',
    '/manifest.json',
    '  Content-Type: application/manifest+json',
    '  Cache-Control: no-cache',
    ''
  );
  return lines.join('\n');
}
