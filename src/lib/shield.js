// Anti-scraping / anti-copy shield.
// Honest scope: nothing running in a browser can be made 100% un-copyable. This layer raises the cost:
//  1. human-input detection (isTrusted events). It never blocks anyone (assistive tech and legitimate
//     automation must keep working); sessions driven only by synthetic events just get a much
//     stricter rate limit on the price engine
//  2. refresh rate limiting (token bucket) against scripted harvesting
//  3. anti-framing (clickjacking / mirror embedding)
//  4. production bundle: minified, no source maps, console stripped, hashed filenames
//  5. robots.txt + X-Robots-Tag + strict CSP headers (see /security/policy.js)
// The real business logic that must stay secret belongs on a server behind auth.

let humanSeen = false;

export function installShield() {
  if (typeof window === 'undefined') return;

  // anti-framing
  try {
    if (window.top !== window.self) {
      document.documentElement.textContent = '';
      window.top.location.href = window.self.location.href;
      return;
    }
  } catch {
    document.documentElement.textContent = '';
    return;
  }

  const mark = (e) => {
    if (e.isTrusted) {
      humanSeen = true;
      for (const t of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(t, mark, true);
    }
  };
  for (const t of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(t, mark, true);
}

/** True once the page has received a genuine user input event. */
export const humanVerified = () => humanSeen;

/** Token-bucket limiter: `limit` actions per `windowMs`. */
export function createRateLimiter(limit, windowMs, clock = Date.now) {
  let stamps = [];
  return () => {
    const now = clock();
    stamps = stamps.filter((t) => now - t < windowMs);
    if (stamps.length >= limit) return false;
    stamps.push(now);
    return true;
  };
}
