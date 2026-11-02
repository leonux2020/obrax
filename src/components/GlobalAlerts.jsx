import { useBackLayer } from '../lib/backStack.js';
import { useI18n } from '../lib/i18n.jsx';
import { AlertTriangleIcon } from './workspace/icons.jsx';

/**
 * The morning "Action Center" (opened by the bell of the Dashboard header): every exception of every open project in one place.
 * Exception-based UI: with none, only a quiet centred line. Device Back closes it (back layer); the ✕ does the same.
 *
 * `alerts`: [{ id, projectId, project, text }]. Tapping a row opens that project.
 */
export default function GlobalAlerts({ alerts = [], onOpen, onClose }) {
  const { t } = useI18n();
  useBackLayer(onClose);
  return (
    <div role="dialog" aria-modal="true" aria-label={t('ws.alerts.title')} data-testid="global-alerts" className="fixed inset-0 z-50 flex flex-col bg-black text-[#E0E0E0]">
      <header className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pt-4">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-normal">{t('ws.alerts.title')}</h1>
        <button type="button" onClick={onClose} aria-label={t('common.close')} data-testid="global-alerts-close" className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 text-xl text-white/60 active:border-white/50">
          ✕
        </button>
      </header>
      {alerts.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <p data-testid="global-alerts-empty" className="text-center text-base text-neutral-500">
            {t('ws.alerts.none')}
          </p>
        </div>
      ) : (
        <ul className="mx-auto w-full max-w-3xl space-y-2 overflow-y-auto px-4 pb-8 pt-6" data-testid="global-alerts-list">
          {alerts.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onOpen?.(a.projectId)}
                data-testid="global-alert"
                data-kind={a.kind}
                className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-amber-500/30 bg-black px-3 py-3 text-left text-amber-500 active:border-amber-500/70"
              >
                <AlertTriangleIcon size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-neutral-400">{a.project}</span>
                  <span className="block text-sm font-semibold uppercase leading-snug tracking-wider">{a.text}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
