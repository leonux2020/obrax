import { useI18n } from '../../lib/i18n.jsx';
import { AlertTriangleIcon } from './icons.jsx';

/**
 * "Bandeja de Alertas": the end of Zone B, under every module. Exception-based UI: the modules stay quiet and anything that needs
 * attention (a rented machine due back, ...) surfaces here, in amber, with a warning icon.
 *
 * It renders ONLY when the project has real exceptions (`alerts`, see lib/alerts.js): with none it returns null (absolute visual silence).
 */
export default function AlertTray({ alerts }) {
  const { t } = useI18n();
  if (!(alerts?.length > 0)) return null;
  return (
    <section aria-label={t('ws.alerts.title')} data-testid="ws-alerts" className="space-y-2">
      {alerts.map((a) => (
        <div
          key={a.id}
          role="alert"
          data-testid="ws-alert"
          data-kind={a.kind}
          data-level={a.level}
          className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-black px-3 py-3 text-amber-500"
        >
          <AlertTriangleIcon size={22} />
          <p className="min-w-0 flex-1 text-sm font-semibold uppercase leading-snug">{a.text}</p>
        </div>
      ))}
    </section>
  );
}
