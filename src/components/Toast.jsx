import { useEffect } from 'react';

/** Transient notice above the bottom nav: pure black, thin border, dismisses itself (and on tap). */
export default function Toast({ message, onDone, ms = 3200 }) {
  useEffect(() => {
    if (!message) return undefined;
    const id = setTimeout(onDone, ms);
    return () => clearTimeout(id);
  }, [message, ms, onDone]);
  if (!message) return null;
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
      <button
        type="button"
        role="status"
        aria-live="polite"
        onClick={onDone}
        data-testid="toast"
        className="pointer-events-auto max-w-sm rounded-2xl border border-white/10 bg-black px-4 py-3 text-center text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(0,0,0,1)]"
      >
        {message}
      </button>
    </div>
  );
}
