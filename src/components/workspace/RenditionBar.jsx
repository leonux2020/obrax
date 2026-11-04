import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { UI_WATCHDOG_MS, settleWithin } from '../../lib/exportSync.js';
import { useExportQueue } from '../../lib/useExportSync.js';
import { CloudUploadIcon } from './icons.jsx';

/**
 * "Cerrar Rendición (Enviar a Drive)": the bottom bar of the audit ledger. The Excel goes to Drive, or to the offline queue (it is never downloaded).
 * Above the button, the state of the parked files of THIS project (waiting / failed) with "Reconectar Drive" or "Reintentar".
 * `onClose()` resolves when it is done; whatever happens the button is released (watchdog), the parent already told the user.
 */
export default function RenditionBar({ projectId, onClose, onRetryQueue = null, onReconnect = null, needsReconnect = false, queue, watchdogMs = UI_WATCHDOG_MS }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false); // the user asked for the Google window: the button says so until Google answers
  const rows = useExportQueue(queue).filter((r) => r.projectId === projectId);
  const waiting = rows.filter((r) => r.status !== 'failed').length;
  const failed = rows.filter((r) => r.status === 'failed').length;

  // "Reconectar Drive": the ONLY place besides "Enviar a Drive" where the Google window may open, and only by this tap
  const reconnect = async () => {
    if (connecting || !onReconnect) return;
    setConnecting(true);
    try {
      await settleWithin(onReconnect(), watchdogMs);
    } catch {
      /* the parent already told the user */
    } finally {
      setConnecting(false);
    }
  };

  const close = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // the parent reads the connection synchronously (offline = parked in IndexedDB at once) and shows the toast; whatever happens the button is freed
      await settleWithin(onClose(), watchdogMs);
    } catch {
      /* the parent already told the user; nothing may leave the screen frozen */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black via-black to-transparent px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-6">
      <div className="mx-auto max-w-3xl space-y-2">
        {(waiting > 0 || failed > 0) && (
          <p role="status" data-testid="fin-queued" className="flex items-center justify-between gap-2 rounded-lg px-1 text-sm font-semibold text-[#e8c35f]">
            <span>{[waiting > 0 && t('fin.queued', { n: waiting }), failed > 0 && t('fin.queued.failed', { n: failed })].filter(Boolean).join(' · ')}</span>
            {needsReconnect && onReconnect ? (
              <button type="button" onClick={reconnect} disabled={connecting} data-testid="fin-reconnect" className="min-h-[44px] shrink-0 rounded-lg border border-[#d4af37] px-3 text-[#e8c35f] disabled:opacity-50">
                {connecting ? t('fin.reconnecting') : t('fin.reconnect')}
              </button>
            ) : (
              onRetryQueue && (
                <button type="button" onClick={onRetryQueue} data-testid="fin-queued-retry" className="min-h-[44px] shrink-0 rounded-lg border border-[#d4af37] px-3 text-[#e8c35f]">
                  {t('fin.queued.retry')}
                </button>
              )
            )}
          </p>
        )}
        <button
          type="button"
          onClick={close}
          disabled={busy}
          data-testid="fin-close"
          className="flex min-h-[64px] w-full select-none items-center justify-center gap-2 rounded-2xl px-5 text-lg transition active:scale-[0.98] disabled:opacity-40 bg-brand text-black font-semibold hover:bg-brand-light"
        >
          <CloudUploadIcon size={24} />
          {busy ? t('fin.closing') : t('fin.close')}
        </button>
      </div>
    </div>
  );
}
