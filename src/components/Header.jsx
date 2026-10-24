import { useI18n } from '../lib/i18n.jsx';
import { Logo, Wordmark } from './ui.jsx';

/** Slim top bar: brand only (language, country, company and profile live in the bottom navigation). */
export default function Header({ subtitle, pwa, bare = false }) {
  const { t } = useI18n();
  return (
    <>
      {!pwa.online && (
        <div role="status" className="no-print bg-white px-4 py-1.5 text-center text-sm font-bold text-black">
          {t('pwa.offline')}
        </div>
      )}
      {pwa.updateReady && (
        <div role="status" className="no-print flex items-center justify-center gap-3 bg-brand px-4 py-2 text-sm font-bold text-black">
          {t('pwa.update')}
          <button type="button" onClick={pwa.applyUpdate} className="rounded-lg bg-black px-3 py-1.5 text-white">
            {t('pwa.updateBtn')}
          </button>
        </div>
      )}
      {!bare && (
      <header className="no-print sticky top-0 z-20 border-b border-white/10 bg-black">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-2 sm:px-4">
          <Logo size={34} />
          <div className="min-w-0 leading-tight">
            <div className="flex items-center" data-testid="header-brand">
              <span className="sr-only">{t('app.name')}</span>
              <Wordmark height={15} />
            </div>
            {subtitle && <div className="truncate text-xs text-neutral-400">{subtitle}</div>}
          </div>
        </div>
      </header>
      )}
    </>
  );
}
