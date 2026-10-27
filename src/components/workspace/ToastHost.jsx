import { useI18n } from '../../lib/i18n.jsx';
import { dismissToast, useToasts } from '../../lib/notify.js';

const TONE = { info: '#E0E0E0', ok: '#00d95f', warn: '#ff9500' };

/** In-app toasts, above the dock. Colour only on the left border and the text, never as a fill. */
export default function ToastHost() {
  const { t } = useI18n();
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-3 [bottom:calc(5.5rem+env(safe-area-inset-bottom))]" aria-live="polite" role="status" data-testid="toast-host">
      {toasts.map((x) => (
        <button
          key={x.id}
          type="button"
          onClick={() => dismissToast(x.id)}
          data-testid="toast"
          data-tone={x.tone}
          style={{ borderLeftColor: TONE[x.tone] ?? TONE.info, color: TONE[x.tone] ?? TONE.info }}
          className="pointer-events-auto max-w-md rounded-lg border border-l-2 border-white/15 bg-black px-4 py-3 text-left text-sm font-bold shadow-lg"
        >
          {t(x.key, x.params)}
        </button>
      ))}
    </div>
  );
}
