import { useI18n } from '../../lib/i18n.jsx';

/**
 * Outline icons (24 px grid, 1.5 px line, round caps): thin, quiet, one neutral colour (they follow the text colour, smoke #E0E0E0).
 * Same drawing language as Lucide's Mic / Camera / Receipt / FileUp (no icon package is installed, so they are inlined: ~1 KB).
 */
const Outline = ({ children }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-dock-icon="outline">
    {children}
  </svg>
);
const ICONS = {
  log: (
    <Outline>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </Outline>
  ),
  camera: (
    <Outline>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
      <circle cx="12" cy="13" r="3" />
    </Outline>
  ),
  scan: (
    <Outline>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </Outline>
  ),
  export: (
    <Outline>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M12 18v-6" />
      <path d="m9 15 3-3 3 3" />
    </Outline>
  ),
};

const ITEMS = [
  ['log', 'ws.dock.log'],
  ['camera', 'ws.dock.camera'],
  ['scan', 'ws.dock.scan'],
  ['export', 'ws.dock.export'],
];

/** ZONE C: the bottom dock, four thumb-sized actions. `queued` = receipts waiting for a connection (badge on the scanner). */
export default function Dock({ onOpen, queued = 0 }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t('ws.dock')} data-testid="ws-zone-c" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-black [padding-bottom:env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-3xl grid-cols-4">
        {ITEMS.map(([id, key]) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onOpen(id)}
              data-testid={`dock-${id}`}
              className="relative flex min-h-[64px] w-full flex-col items-center justify-center gap-0.5 text-[#E0E0E0] transition active:scale-95 active:text-brand"
            >
              {ICONS[id]}
              <span className="text-[11px] font-semibold">{t(key)}</span>
              {id === 'scan' && queued > 0 && (
                <span data-testid="dock-queued" aria-label={t('q.pending')} className="absolute right-[22%] top-1.5 rounded-full border border-[#d4af37] px-1.5 text-[10px] font-semibold leading-4 text-[#e8c35f]">
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
