import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import BottomSheet from '../BottomSheet.jsx';

const OPTIONS = [
  ['client', '📄', 'ws.export.client', 'ws.export.clientHint'],
  ['tech', '🛠️', 'ws.export.tech', 'ws.export.techHint'],
  ['xlsx', '📊', 'ws.export.xlsx', 'ws.export.xlsxHint'],
];

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
        {OPTIONS.map(([kind, icon, label, hint]) => {
          const disabled = Boolean(busy) || (kind !== 'xlsx' && !canPdf);
          return (
            <li key={kind}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => run(kind)}
                data-testid={`export-${kind}`}
                className="flex min-h-[72px] w-full items-center gap-3 rounded-2xl border border-white/15 px-4 text-left transition active:scale-[0.99] active:border-white/50 disabled:opacity-40"
              >
                <span aria-hidden="true" className="text-3xl">
                  {icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-extrabold">{busy === kind ? t('pdf.generating') : t(label)}</span>
                  <span className="block text-xs text-neutral-300">{t(hint)}</span>
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
          className="mt-3 flex min-h-[72px] w-full items-center gap-3 rounded-2xl border border-white/15 px-4 text-left transition active:scale-[0.99] active:border-brand disabled:opacity-40"
        >
          <span aria-hidden="true" className="text-3xl">
            ☁️
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-extrabold text-brand">{syncing ? t('dossier.syncing') : t('ws.export.drive')}</span>
            <span className="block text-xs text-neutral-300">{t('ws.export.driveHint')}</span>
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
