// Motion budget (JS side). CSS already switches every animation / transition off under `prefers-reduced-motion` and `body.eco-mode`
// (index.css); this is the same decision for the few places that move things from JavaScript (smooth scrolling).

/** true when the user asked for reduced motion or the battery eco-mode is on. */
export function calmMotion() {
  try {
    if (typeof document !== 'undefined' && document.body?.classList.contains('eco-mode')) return true;
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** The `behavior` to hand to scrollTo / scrollIntoView: instant when motion is unwelcome. */
export const scrollBehavior = () => (calmMotion() ? 'auto' : 'smooth');
