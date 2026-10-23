import { useI18n } from '../lib/i18n.jsx';

const Icon = ({ children }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/**
 * Main navigation anchored to the bottom of the screen (one-handed use): Proyectos | Contabilidad Global | Ajustes.
 * "Nuevo proyecto" is not here any more: it is the floating button of the dashboard.
 */
export default function BottomNav({ active, onProjects, onAccounting, onSettings }) {
  const { t } = useI18n();
  const item = (id, label, onClick, icon) => (
    <button
      key={id}
      type="button"
      onClick={onClick}
      data-testid={`nav-${id}`}
      aria-current={active === id ? 'page' : undefined}
      className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-bold leading-tight transition ${
        active === id ? 'text-brand' : 'text-neutral-300 hover:text-white'
      }`}
    >
      {icon}
      <span className="line-clamp-2 max-w-full px-1 text-center">{label}</span>
    </button>
  );
  return (
    <nav
      aria-label={t('nav.main')}
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black px-2 pt-2 [padding-bottom:max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto grid max-w-lg grid-cols-3 items-center gap-1">
        {item('projects', t('nav.projects'), onProjects, (
          <Icon>
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </Icon>
        ))}
        {item('accounting', t('nav.accounting'), onAccounting, (
          <Icon>
            <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
          </Icon>
        ))}
        {item('settings', t('nav.settings'), onSettings, (
          <Icon>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </Icon>
        ))}
      </div>
    </nav>
  );
}
