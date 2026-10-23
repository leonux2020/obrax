// Freemium gate. There is no billing yet, so nobody is PRO: every locked feature opens the paywall.
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

export function isPro() {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem(SIM_PRO_KEY) === '1';
  } catch {
    return false;
  }
}

/** Development only (no-op in production builds). */
export function setSimulatedPro(on) {
  if (!import.meta.env.DEV) return;
  try {
    if (on) localStorage.setItem(SIM_PRO_KEY, '1');
    else localStorage.removeItem(SIM_PRO_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** True when the free plan cannot create another project (existing ones are never touched). */
export const projectLimitReached = (count, pro = isPro()) => !pro && Number(count) >= FREE_PROJECT_LIMIT;

export const isProFeature = (id) => PRO_FEATURES.includes(id);
