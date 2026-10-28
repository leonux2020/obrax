import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import BottomSheet from './BottomSheet.jsx';

/**
 * One-click contextual restore. Shown when Drive holds a backup (found with a metadata-only query) and this device has no work yet.
 *  ask -> "Restaurar ahora" (downloads, rebuilds, hydrates) | "Ahora no" (closes; nothing is downloaded)
 *  working -> explicit progress, cannot be closed half-way
 *  done -> short success, then `onDone` (the app shows the projects)
 *  error -> calm message, retry or leave (the manual "Restaurar" in Ajustes stays available)
 * `onRestore` resolves { ok, restored }.
 */
export default function RestorePrompt({ onRestore, onLater, onDone, doneMs = 1400 }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState('ask'); // ask | working | done | error
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  const run = async () => {
    if (phase === 'working') return;
    setPhase('working');
    const r = await Promise.resolve(onRestore()).catch(() => ({ ok: false }));
    if (alive.current) setPhase(r?.ok && r.restored ? 'done' : 'error');
  };

  useEffect(() => {
    if (phase !== 'done') return undefined;
    const id = setTimeout(onDone, doneMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const close = phase === 'working' ? () => {} : phase === 'done' ? onDone : onLater;

  return (
    <BottomSheet title={t('restore.offer.title')} onClose={close}>
      <div data-testid="restore-offer" data-phase={phase}>
        {phase === 'ask' && (
          <>
            <p className="mt-2 text-base leading-snug text-[#E0E0E0]">{t('restore.offer.msg')}</p>
            <div className="mt-5 space-y-2">
              <button type="button" onClick={run} data-testid="restore-offer-now" className="min-h-[44px] w-full rounded-lg bg-brand px-4 text-base font-bold text-black hover:bg-brand-light">
                {t('restore.offer.now')}
              </button>
              <button type="button" onClick={onLater} data-testid="restore-offer-later" className="min-h-[44px] w-full rounded-lg px-4 text-sm font-semibold text-[#E0E0E0]/70 hover:text-[#E0E0E0]">
                {t('restore.offer.later')}
              </button>
            </div>
          </>
        )}
        {phase === 'working' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center" role="status" aria-live="polite" data-testid="restore-offer-working">
            <span className="h-8 w-8 animate-spin rounded-full border-4 border-white/10 border-t-brand" aria-hidden="true" />
            <p className="text-base text-[#E0E0E0]">{t('restore.offer.working')}</p>
          </div>
        )}
        {phase === 'done' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center" role="status" aria-live="polite" data-testid="restore-offer-done">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-brand text-xl text-brand" aria-hidden="true">
              ✓
            </span>
            <p className="text-base text-[#E0E0E0]">{t('restore.offer.done')}</p>
          </div>
        )}
        {phase === 'error' && (
          <>
            <p className="mt-2 text-base leading-snug text-[#e8c35f]" role="status" data-testid="restore-offer-error">
              {t('restore.offer.err')}
            </p>
            <div className="mt-5 space-y-2">
              <button type="button" onClick={run} data-testid="restore-offer-retry" className="min-h-[44px] w-full rounded-lg bg-brand px-4 text-base font-bold text-black hover:bg-brand-light">
                {t('restore.offer.retry')}
              </button>
              <button type="button" onClick={onLater} data-testid="restore-offer-later" className="min-h-[44px] w-full rounded-lg px-4 text-sm font-semibold text-[#E0E0E0]/70 hover:text-[#E0E0E0]">
                {t('restore.offer.later')}
              </button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
