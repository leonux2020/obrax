import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import BottomSheet from '../BottomSheet.jsx';
import { CloudUploadIcon, FileCogIcon, FileSignatureIcon, TableIcon } from './icons.jsx';

const OPTIONS = [
  ['client', FileSignatureIcon, 'ws.export.client', 'ws.export.clientHint'],
  ['tech', FileCogIcon, 'ws.export.tech', 'ws.export.techHint'],
  ['xlsx', TableIcon, 'ws.export.xlsx', 'ws.export.xlsxHint'],
];

// Hierarchy: ONLY the client PDF (the one that closes the deal) is highlighted; the rest stay neutral and secondary.
const CARD = 'flex min-h-[72px] w-full items-center gap-3 rounded-2xl border px-4 text-left transition active:scale-[0.99] disabled:opacity-40';
const NEUTRAL = 'border-white/10 active:border-white/40';
const PRIMARY = 'border-brand active:border-brand-light';

/** Export bottom sheet: three clear documents. `onExport(kind)` resolves to 'shared' | 'downloaded' | 'cancelled' or throws. */
export default function ExportSheet({ onExport, onClose, canPdf, onSync = null, syncing = false }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(false);

  const run = async (kind) => {
    if (busy) return;
    setBusy(kind);
    setError(false);
    try {
      const outcome = await onExport(kind);
      if (outcome !== 'cancelled') onClose();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <BottomSheet title={t('ws.export.title')} onClose={onClose}>
      <ul className="mt-3 space-y-2" data-testid="export-sheet">
        {OPTIONS.map(([kind, Icon, label, hint]) => {
          const disabled = Boolean(busy) || (kind !== 'xlsx' && !canPdf);
          return (
            <li key={kind}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => run(kind)}
                data-testid={`export-${kind}`}
                data-primary={kind === 'client' ? 'true' : undefined}
                className={`${CARD} ${kind === 'client' ? PRIMARY : NEUTRAL}`}
              >
                <Icon size={28} className="text-neutral-400" />
                <span className="min-w-0 flex-1">
                  <span className={`block text-base font-semibold ${kind === 'client' ? 'text-brand' : ''}`}>
                    {busy === kind ? t('pdf.generating') : t(label)}
                  </span>
                  <span className="block text-xs text-neutral-400">{t(hint)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {onSync && (
        <button
          type="button"
          disabled={syncing || Boolean(busy)}
          onClick={() => {
            onSync(); // runs in the background (a toast tells the progress): the sheet closes and the user keeps working
            onClose();
          }}
          data-testid="export-drive"
          className={`mt-3 ${CARD} ${NEUTRAL}`}
        >
          <CloudUploadIcon size={28} className="text-neutral-400" />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold">{syncing ? t('dossier.syncing') : t('ws.export.drive')}</span>
            <span className="block text-xs text-neutral-400">{t('ws.export.driveHint')}</span>
          </span>
        </button>
      )}
      {error && (
        <p role="alert" data-testid="export-error" className="mt-3 text-sm font-semibold text-red-400">
          {t('ws.export.error')}
        </p>
      )}
    </BottomSheet>
  );
}
