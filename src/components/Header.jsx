import { useI18n } from '../lib/i18n.jsx';
import { regionName } from '../lib/regions.js';
import { Logo } from './ui.jsx';

export default function Header({ user, onChangeRegion, onToggleLang, onLogout, pwa }) {
  const { t, region, lang } = useI18n();
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
      <header className="no-print sticky top-0 z-20 border-b border-neutral-800 bg-black/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
          <Logo size={40} />
          <div className="mr-auto hidden min-w-0 leading-tight min-[460px]:block">
            <div className="truncate text-lg font-extrabold">{t('app.name')}</div>
            <div className="truncate text-xs text-neutral-400">{user.name}</div>
          </div>
          <div className="mr-auto min-[460px]:hidden" />

          {pwa.canInstall && (
            <button
              type="button"
              onClick={pwa.install}
              className="min-h-[44px] rounded-lg bg-brand px-3 text-sm font-bold text-black"
            >
              {t('pwa.install')}
            </button>
          )}
          <button
            type="button"
            onClick={onChangeRegion}
            aria-label={t('region.change')}
            title={t('region.change')}
            className="min-h-[44px] whitespace-nowrap rounded-lg border border-neutral-700 px-3 text-sm font-bold hover:border-brand"
          >
            {region.code}
            <span className="hidden sm:inline"> · {region.currency}</span>
            <span className="sr-only"> {regionName(region, lang)}</span>
          </button>
          <button
            type="button"
            onClick={onToggleLang}
            className="min-h-[44px] rounded-lg border border-neutral-700 px-3 text-sm font-bold uppercase hover:border-brand"
            aria-label={t('lang.switch')}
            title={t('lang.switch')}
          >
            {lang === 'es' ? 'EN' : 'ES'}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="min-h-[44px] rounded-lg border border-neutral-700 px-3 text-sm font-bold hover:border-red-500"
          >
            {t('login.logout')}
          </button>
        </div>
      </header>
    </>
  );
}
