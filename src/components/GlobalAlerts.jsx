import { useI18n } from '../lib/i18n.jsx';
import BottomSheet from './BottomSheet.jsx';
import { AlertTriangleIcon } from './workspace/icons.jsx';

/**
 * The morning "Action Center" (opened by the bell of the Dashboard header): every exception of every open project in one place.
 * Exception-based UI: with none, only a quiet centred line. A full-screen sheet like the rest: no x, it closes with the device Back or a swipe down.
 *
 * `alerts`: [{ id, projectId, project, text }]. Tapping a row opens that project.
 */
export default function GlobalAlerts({ alerts = [], onOpen, onClose }) {
  const { t } = useI18n();
  return (
    <BottomSheet fullscreen autoFocus={false} title={t('ws.alerts.title')} onClose={onClose}>
      <div data-testid="global-alerts" className="text-neutral-200">
        {alerts.length === 0 ? (
          <div className="flex items-center justify-center px-6 py-16">
            <p data-testid="global-alerts-empty" className="text-center text-base text-neutral-500">
              {t('ws.alerts.none')}
            </p>
          </div>
        ) : (
          <ul className="space-y-2 pt-4" data-testid="global-alerts-list">
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
                    <span className="block text-sm font-semibold uppercase leading-snug">{a.text}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}
