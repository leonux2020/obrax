import { useI18n } from '../lib/i18n.jsx';

/** Status banners of the app shell: offline and "new version ready" (the brand lives in the Dashboard's top bar; the sections in the bottom navigation). */
export default function Header({ pwa }) {
  const { t } = useI18n();
  return (
    <>
      {!pwa.online && (
        <div role="status" className="no-print border-b border-[#e8c35f]/40 bg-black px-4 py-1.5 text-center text-sm font-semibold text-[#e8c35f]">
          {t('pwa.offline')}
        </div>
      )}
      {pwa.updateReady && (
        <div role="status" className="no-print flex items-center justify-center gap-3 bg-brand px-4 py-2 text-sm font-semibold text-black">
          {t('pwa.update')}
          <button type="button" onClick={pwa.applyUpdate} className="rounded-lg bg-black px-3 py-1.5 text-neutral-200">
            {t('pwa.updateBtn')}
          </button>
        </div>
      )}
    </>
  );
}
