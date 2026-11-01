import { AlertTriangleIcon } from './icons.jsx';

/**
 * "Bandeja de Alertas": the end of Zone B, under every module. Exception-based UI: the modules stay quiet and anything that needs
 * attention (a rented machine due back, ...) surfaces here, in amber, with a warning icon.
 *
 * TEMPORARY MOCKUP: the single alert below is static text so the layout can be judged. Later this tray renders conditionally: one row
 * per real exception (e.g. `rentalsDue(project)`), and nothing at all when there are none.
 */
const MOCK_ALERTS = Object.freeze([{ id: 'mock-rental', text: 'RESTITUZIONE MACCHINARIO: ESCAVATORE (SCADE OGGI)' }]);

export default function AlertTray({ alerts = MOCK_ALERTS }) {
  return (
    <section aria-label="Alertas" data-testid="ws-alerts" className="space-y-2">
      {alerts.map((a) => (
        <div
          key={a.id}
          role="alert"
          data-testid="ws-alert"
          className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-black px-3 py-3 text-amber-500"
        >
          <AlertTriangleIcon size={22} />
          <p className="min-w-0 flex-1 text-sm font-semibold uppercase leading-snug tracking-wider">{a.text}</p>
        </div>
      ))}
    </section>
  );
}
