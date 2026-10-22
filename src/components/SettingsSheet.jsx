import { useI18n } from '../lib/i18n.jsx';
import { regionName } from '../lib/regions.js';
import { googleConfigured } from '../lib/auth.js';
import { Button } from './ui.jsx';
import GoogleButton from './GoogleButton.jsx';
import HelmetIcon from './HelmetIcon.jsx';
import BottomSheet from './BottomSheet.jsx';
import LangSelect from './LangSelect.jsx';

/** Language, default country for new projects, PWA install and local profile switch. */
export default function SettingsSheet({ user, company, logo, regionCode, pwa, onEditProfile, onPro, onSignIn, onChangeLang, onChangeRegion, onLogout, onClose }) {
  const { t, lang, region } = useI18n();
  const shown = regionCode ? { flag: region?.flag, name: region ? regionName(region, lang) : '' } : null;
  return (
    <BottomSheet title={t('settings.title')} onClose={onClose}>
      <div className="mt-3 space-y-5">
        {/* The only place where the company / professional profile can be edited. */}
        <div>
          <p className="label">{t('settings.profile')}</p>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 px-4 py-3" data-testid="settings-profile">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white p-1">
              {logo ? <img src={logo} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] font-bold text-black/50">LOGO</span>}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{company?.name || company?.proName || t('settings.profile.empty')}</span>
              {company?.proName && company?.name && <span className="block truncate text-sm text-neutral-400">{company.proName}</span>}
            </span>
            <button type="button" onClick={onEditProfile} data-testid="settings-edit-profile" className="min-h-[44px] shrink-0 rounded-lg border border-white/10 px-3 text-sm font-bold hover:border-brand">
              {t('settings.profile.edit')}
            </button>
          </div>
        </div>

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

        {/* Locked feature: opens the PRO benefits screen. */}
        <button
          type="button"
          onClick={() => onPro('drive')}
          data-testid="settings-drive-pro"
          className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3 text-left hover:border-[#d4af37]/60"
        >
          <span className="min-w-0 font-semibold">{t('pro.b.drive')}</span>
          <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#d4af37]/60 px-2 py-0.5 text-[11px] font-extrabold tracking-wider text-[#e8c35f]">
            <HelmetIcon size={18} />
            PRO
          </span>
        </button>

        {pwa.canInstall && (
          <Button variant="secondary" className="w-full" onClick={pwa.install}>
            {t('pwa.install')}
          </Button>
        )}

        <div>
          <p className="label">{t(user.provider === 'google' ? 'settings.account.google' : 'settings.account')}</p>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3" data-testid="settings-account">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{user.name}</span>
              {user.email && <span className="block truncate text-sm text-neutral-400">{user.email}</span>}
            </span>
            <button type="button" onClick={onLogout} className="min-h-[44px] shrink-0 rounded-lg border border-white/10 px-3 text-sm font-bold hover:border-red-500">
              {t('login.switch')}
            </button>
          </div>
          {user.provider !== 'google' && googleConfigured && (
            <div className="mt-3 rounded-xl border border-white/10 p-3" data-testid="settings-google-link">
              <p className="mb-2 text-center text-sm text-neutral-300">{t('settings.account.link')}</p>
              <GoogleButton onUser={onSignIn} />
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
