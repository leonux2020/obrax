// Freemium gate. There is no billing yet, so nobody is PRO (unless the temporary quality-control switch below is on):
// every locked feature opens the paywall.
// Features that can be locked (ids match the benefits listed on ProPaywall):
//   'projects' -> more than FREE_PROJECT_LIMIT projects
//   'ai'       -> AI invoice reading (Phase 5, via the server proxy)
// Google Drive backup is a FREE feature (a switch in Ajustes), not a PRO one.

export const FREE_PROJECT_LIMIT = 3;
export const PRO_FEATURES = Object.freeze(['projects', 'ai']);

// Placeholder until a payment gateway exists: nobody is PRO. The ONLY way in is a DEVELOPMENT-ONLY switch
// (the test button of the paywall, compiled out of production builds) that stores a local flag, so the PRO
// flows can be tried on localhost. A real subscription must replace this with a server-verified entitlement.
export const SIM_PRO_KEY = 'cp.pro.sim.v1';

// TEMPORARY QUALITY-CONTROL SWITCH. While true, the paywall is open in EVERY environment (production, preview,
// localhost): isPro() is always true, so the project limit and the AI scanners are unlocked, and the app shows a
// subtle "MODO PRO (Prueba)" tag as a reminder. Set it to false to bring the paywall back (nothing else to change).
// The test runner (MODE 'test') is the only exception, so the paywall logic stays testable; tests exercise the open
// state through qaProOpen({ mode }). The AI server proxy keeps its own origin check and rate limits either way.
export const PRO_QA_OPEN = true;
export const PRO_QA_LABEL = 'MODO PRO (Prueba)';

/** Is the paywall intentionally open for quality control? (always, except inside the test runner). */
export const qaProOpen = ({ flag = PRO_QA_OPEN, mode = import.meta.env.MODE } = {}) => Boolean(flag) && mode !== 'test';

const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

/** Subscribe to PRO changes (same tab via setSimulatedPro, other tabs via the storage event). Returns the unsubscribe. */
export function subscribePro(fn) {
  listeners.add(fn);
  const onStorage = (e) => (e.key === null || e.key === SIM_PRO_KEY) && fn();
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

export function isPro() {
  if (qaProOpen()) return true; // quality-control build: premium features open for everybody
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem(SIM_PRO_KEY) === '1';
  } catch {
    return false;
  }
}

/** Development only (no-op in production builds). Notifies every subscriber at once: no reload, no second click. */
export function setSimulatedPro(on) {
  if (!import.meta.env.DEV) return;
  try {
    if (on) localStorage.setItem(SIM_PRO_KEY, '1');
    else localStorage.removeItem(SIM_PRO_KEY);
  } catch {
    /* storage unavailable: the flag simply does not stick */
  }
  notify();
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Development-only bypass of the PRO paywall for the AI features (receipt scanner + invoice reading), so they can be
 * tried without simulating a subscription. It needs ALL of: the Vite dev server (`MODE === 'development'`, which also
 * means `DEV`) and a loopback host. Production builds, preview
 * servers on another host and the test runner (MODE 'test') never get it; `import.meta.env.DEV` is a build-time
 * constant, so the branch is dead code in production bundles. It unlocks the client gate only: the server proxy keeps
 * its own origin check and rate limit.
 */
export function devAiBypass({ dev = import.meta.env.DEV, mode = import.meta.env.MODE, host = typeof location === 'undefined' ? '' : location.hostname } = {}) {
  return Boolean(dev) && mode === 'development' && LOCAL_HOSTS.has(String(host).toLowerCase());
}

/** Who may use the AI features right now: 'pro' (subscription), 'dev' (local bypass) or null (paywall). */
export const aiAccess = () => (isPro() ? 'pro' : devAiBypass() ? 'dev' : null);

/** True when the free plan cannot create another project (existing ones are never touched). */
export const projectLimitReached = (count, pro = isPro()) => !pro && Number(count) >= FREE_PROJECT_LIMIT;

export const isProFeature = (id) => PRO_FEATURES.includes(id);
