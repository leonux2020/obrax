import { useI18n } from '../lib/i18n.jsx';
import { regionName } from '../lib/regions.js';
import { Button } from './ui.jsx';
import BottomSheet from './BottomSheet.jsx';
import LangSelect from './LangSelect.jsx';

/** Language, default country for new projects, PWA install and local profile switch. */
export default function SettingsSheet({ user, regionCode, pwa, onChangeLang, onChangeRegion, onLogout, onClose }) {
  const { t, lang, region } = useI18n();
  const shown = regionCode ? { flag: region?.flag, name: region ? regionName(region, lang) : '' } : null;
  return (
    <BottomSheet title={t('settings.title')} onClose={onClose}>
      <div className="mt-3 space-y-5">
        <div>
          <p className="label">{t('lang.label')}</p>
          <LangSelect onChange={onChangeLang} className="w-full !min-h-[52px] text-base" />
        </div>

        <div>
          <p className="label">{t('settings.region')}</p>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3">
            <span className="min-w-0 truncate font-semibold">
              <span aria-hidden="true">{shown?.flag}</span> {shown?.name}
            </span>
            <button type="button" onClick={onChangeRegion} className="min-h-[44px] shrink-0 rounded-lg border border-white/10 px-3 text-sm font-bold hover:border-brand">
              {t('settings.region.change')}
            </button>
          </div>
        </div>

        {pwa.canInstall && (
          <Button variant="secondary" className="w-full" onClick={pwa.install}>
            {t('pwa.install')}
          </Button>
        )}

        <div>
          <p className="label">{t('settings.account')}</p>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3">
            <span className="min-w-0 truncate font-semibold">{user.name}</span>
            <button type="button" onClick={onLogout} className="min-h-[44px] shrink-0 rounded-lg border border-white/10 px-3 text-sm font-bold hover:border-red-500">
              {t('login.switch')}
            </button>
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
