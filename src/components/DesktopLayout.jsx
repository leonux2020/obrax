import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { isClosed, projectClient, projectTitle, sortProjects } from '../lib/projects.js';
import { Wordmark } from './ui.jsx';
import AgentChat from './AgentChat.jsx';
import { AccountingIcon, ProjectsIcon, SettingsIcon } from './BottomNav.jsx';

const Chevron = ({ flip = false }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-outline-icon="true" data-icon="chevron" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

const SparkIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-outline-icon="true" data-icon="spark">
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M19 16v4M17 18h4" />
  </svg>
);

const navClass = (on) =>
  `flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition active:scale-95 active:opacity-70 disabled:pointer-events-none disabled:opacity-40 ${
    on ? 'bg-white/5 font-normal text-brand' : 'font-light text-neutral-200 hover:text-neutral-100'
  }`;

/**
 * CUBRAX Studio: the desktop frame (>= 1024 px). On a big monitor pure black against white text "halates" (eye strain in long sessions), so the desktop
 * floor is ANTHRACITE (neutral-900) and the three columns are floating cards (neutral-800, a soft shadow, no lines): the air between them does the grouping.
 * The phone keeps the pure OLED black. `studio-surface` (index.css) maps the black of the screens drawn inside to the card tone and lifts the faint greys,
 * so the existing screens are untouched and the contrast stays high.
 *   LEFT   (250 px, fixed)   the sections, the active projects and the way to a new one.
 *   CENTRE (fluid)           the work panel: whatever screen the app is on (list, project, accounting, settings) is drawn here, untouched.
 *   RIGHT  (300 px)          the Copilot (AgentChat); it folds into a slim rail when the table needs the room.
 * The centre is its own scroll area and its own "containing block": the bottom sheets and the project dock (`position: fixed`) stay INSIDE the work panel
 * instead of covering the menu and the copilot.
 * @param locked  a new project (draft) is being written: the menu waits, the draft has its own save / discard bar
 * @param viewKey changes with the screen shown: the work panel returns to its top
 * @param banner  the app's status banners (offline / update), drawn on top of the work panel
 * @param copilotReply  the agent behind the Copilot (see lib/copilot.js); without one the panel answers with the "Analizando..." echo
 */
export default function DesktopLayout({ projects = [], openId = null, tab = 'projects', viewKey = '', locked = false, banner = null, copilotReply = undefined, onProjects, onAccounting, onSettings, onOpenProject, onNew, children }) {
  const { t } = useI18n();
  const [copilotOpen, setCopilotOpen] = useState(true);
  const scroller = useRef(null);

  useEffect(() => {
    scroller.current?.scrollTo?.({ top: 0 }); // a new screen starts at its top, never at the scroll the previous one left
  }, [viewKey]);

  // the open jobs, most urgent first (the same order as the phone's list); a closed job lives in the History of the list
  const active = useMemo(() => sortProjects((Array.isArray(projects) ? projects : []).filter((p) => p && !isClosed(p)), Date.now()), [projects]);
  const onList = !openId && tab === 'projects';

  return (
    <div data-testid="desktop-layout" className="studio-surface flex h-[100dvh] w-full gap-3 overflow-hidden bg-neutral-900 p-3 text-neutral-100">
      <aside aria-label={t('studio.sidebar')} data-testid="desktop-sidebar" className="no-print flex w-[250px] shrink-0 flex-col gap-5 overflow-y-auto rounded-2xl bg-neutral-800 px-3 py-5 shadow-md">
        <div className="px-2 pb-1">
          <Wordmark height={22} />
        </div>

        <nav aria-label={t('nav.main')} className="space-y-1">
          <button type="button" onClick={onProjects} disabled={locked} aria-current={onList ? 'page' : undefined} data-testid="side-projects" className={navClass(onList)}>
            <ProjectsIcon />
            {t('nav.projects')}
          </button>
          <button type="button" onClick={onAccounting} disabled={locked} aria-current={!openId && tab === 'accounting' ? 'page' : undefined} data-testid="side-accounting" className={navClass(!openId && tab === 'accounting')}>
            <AccountingIcon />
            {t('nav.accountingShort')}
          </button>
        </nav>

        <section aria-label={t('studio.active')} className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-xs font-light text-neutral-300">{t('studio.active')}</h2>
            <button
              type="button"
              onClick={onNew}
              disabled={locked}
              aria-label={t('dash.new')}
              title={t('dash.new')}
              data-testid="side-new"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-lg font-light leading-none text-neutral-200 transition active:scale-95 active:opacity-70 disabled:pointer-events-none disabled:opacity-40"
            >
              +
            </button>
          </div>
          {active.length === 0 ? (
            <p className="px-2 pt-3 text-sm font-light text-neutral-300" data-testid="side-empty">
              {t('studio.noProjects')}
            </p>
          ) : (
            <ul className="mt-2 space-y-1 overflow-y-auto" data-testid="side-projects-list">
              {active.map((p) => {
                const on = p.id === openId;
                const client = projectClient(p);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onOpenProject(p.id)}
                      disabled={locked}
                      aria-current={on ? 'page' : undefined}
                      data-testid={`side-project-${p.id}`}
                      className={`flex min-h-[44px] w-full flex-col justify-center rounded-xl px-3 py-1.5 text-left transition active:scale-95 active:opacity-70 disabled:pointer-events-none disabled:opacity-40 ${on ? 'bg-white/5' : ''}`}
                    >
                      <span className={`truncate text-sm ${on ? 'font-normal text-brand' : 'font-light text-neutral-200'}`}>{projectTitle(p) || t('proj.untitled')}</span>
                      {client && <span className="truncate text-xs font-light text-neutral-300">{client}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <button type="button" onClick={onSettings} disabled={locked} aria-current={!openId && tab === 'settings' ? 'page' : undefined} data-testid="side-settings" className={navClass(!openId && tab === 'settings')}>
          <SettingsIcon />
          {t('nav.settings')}
        </button>
      </aside>

      <div data-testid="desktop-center" className="relative min-w-0 flex-1 overflow-hidden rounded-2xl bg-neutral-800 shadow-md [transform:translateZ(0)]">
        <div ref={scroller} data-testid="desktop-scroll" className="flex h-full flex-col overflow-y-auto overscroll-contain">
          {banner}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>

      <aside
        aria-label={t('studio.copilot')}
        data-testid="desktop-copilot"
        data-open={copilotOpen ? 'true' : 'false'}
        className={`no-print flex shrink-0 flex-col overflow-hidden rounded-2xl bg-neutral-800 shadow-md transition-[width] duration-200 ${copilotOpen ? 'w-[300px]' : 'w-14'}`}
      >
        <div className={`flex min-h-[64px] shrink-0 items-center gap-2 px-3 ${copilotOpen ? 'justify-between' : 'justify-center'}`}>
          {copilotOpen && (
            <div className="flex min-w-0 items-center gap-2 px-1 text-neutral-200">
              <span className="text-brand">
                <SparkIcon />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-normal">{t('studio.copilot')}</h2>
                <p className="truncate text-xs font-light text-neutral-300">{t('studio.copilot.sub')}</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCopilotOpen((v) => !v)}
            aria-expanded={copilotOpen}
            aria-label={copilotOpen ? t('studio.copilot.hide') : t('studio.copilot.show')}
            title={copilotOpen ? t('studio.copilot.hide') : t('studio.copilot.show')}
            data-testid="copilot-toggle"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-neutral-400 transition active:scale-95 active:opacity-70"
          >
            {copilotOpen ? <Chevron /> : <Chevron flip />}
          </button>
        </div>
        {/* always mounted: folding the panel keeps the conversation */}
        <AgentChat reply={copilotReply} className={copilotOpen ? 'flex-1' : 'hidden'} />
      </aside>
    </div>
  );
}
