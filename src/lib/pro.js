// Freemium gate. There is no billing yet, so nobody is PRO: every locked feature opens the paywall.
// Features that can be locked (ids match the benefits listed on ProPaywall):
//   'projects' -> more than FREE_PROJECT_LIMIT projects
//   'ai'       -> AI invoice reading (reserved for the AI phase)
// Google Drive backup is a FREE feature (a switch in Ajustes), not a PRO one.

export const FREE_PROJECT_LIMIT = 3;
export const PRO_FEATURES = Object.freeze(['projects', 'ai']);

/** Placeholder until a payment gateway exists. */
export const isPro = () => false;

/** True when the free plan cannot create another project (existing ones are never touched). */
export const projectLimitReached = (count, pro = isPro()) => !pro && Number(count) >= FREE_PROJECT_LIMIT;

export const isProFeature = (id) => PRO_FEATURES.includes(id);
