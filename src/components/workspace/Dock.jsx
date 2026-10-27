import { useI18n } from '../../lib/i18n.jsx';

const ITEMS = [
  ['log', '🎙️', 'ws.dock.log'],
  ['camera', '📸', 'ws.dock.camera'],
  ['scan', '🧾', 'ws.dock.scan'],
  ['export', '📄', 'ws.dock.export'],
];

/** ZONE C: the bottom dock, four thumb-sized actions. `queued` = receipts waiting for a connection (badge on the scanner). */
export default function Dock({ onOpen, queued = 0 }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t('ws.dock')} data-testid="ws-zone-c" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-black [padding-bottom:env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-3xl grid-cols-4">
        {ITEMS.map(([id, icon, key]) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onOpen(id)}
              data-testid={`dock-${id}`}
              className="relative flex min-h-[64px] w-full flex-col items-center justify-center gap-0.5 text-[#E0E0E0] transition active:scale-95 active:text-brand"
            >
              <span aria-hidden="true" className="text-2xl leading-none">
                {icon}
              </span>
              <span className="text-[11px] font-bold">{t(key)}</span>
              {id === 'scan' && queued > 0 && (
                <span data-testid="dock-queued" aria-label={t('q.pending')} className="absolute right-[22%] top-1.5 rounded-full border border-[#d4af37] px-1.5 text-[10px] font-extrabold leading-4 text-[#e8c35f]">
                  {queued}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
