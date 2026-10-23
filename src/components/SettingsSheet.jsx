import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { regionName } from '../lib/regions.js';
import { googleConfigured } from '../lib/auth.js';
import { Button, Switch } from './ui.jsx';
import GoogleButton from './GoogleButton.jsx';
import BottomSheet from './BottomSheet.jsx';
import LangSelect from './LangSelect.jsx';

/** Language, default country for new projects, PWA install and local profile switch. */
export default function SettingsSheet({ user, company, logo, regionCode, pwa, drive, onDriveChange, onEditProfile, onSignIn, onChangeLang, onChangeRegion, onLogout, onClose, backup = null, onBackupNow = null, onRestore = null }) {
  const { t, lang, region } = useI18n();
  const [phase, setPhase] = useState('idle'); // idle | confirming | syncing | failed (sign-out)
  const [working, setWorking] = useState(''); // '' | 'backup' | 'restore'
  const [note, setNote] = useState(''); // result of the last manual backup / restore
  const cloud = Boolean(backup?.enabled); // sign-out waits for the Drive copy
  const busy = phase === 'syncing';

  const when = (at) => {
    try {
      return new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(at));
    } catch {
      return new Date(at).toISOString();
    }
  };
  const st = backup?.state;
  const statusText = !st
    ? ''
    : st.status === 'syncing'
      ? t('backup.status.syncing')
      : st.status === 'pending'
        ? t(`backup.status.pending.${st.reason || 'error'}`)
        : st.at
          ? t('backup.status.synced', { date: when(st.at) })
          : t('backup.status.idle');

  const leave = async (opts) => {
    setPhase('syncing');
    const r = await onLogout(opts);
    if (r && r.ok === false) setPhase('failed'); // nothing was erased: the user decides
  };
  const backupNow = async () => {
    setWorking('backup');
    setNote('');
    const r = await onBackupNow();
    setWorking('');
    setNote(r.ok ? '' : t(`backup.status.pending.${r.reason || 'error'}`));
  };
  const restore = async () => {
    setWorking('restore');
    setNote('');
    const r = await onRestore();
    setWorking('');
    setNote(!r.ok ? t('backup.restore.err') : r.restored ? t('backup.restore.done') : t('backup.restore.none'));
  };
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

        {/* FREE feature: Google Drive backup preference (the cloud copy itself is still to come). */}
        <Switch checked={drive} onChange={onDriveChange} label={t('setup.drive')} description={t('setup.drive.desc')} data-testid="settings-drive" />

        {backup && (
          <div className="rounded-xl border border-white/10 px-4 py-3" data-testid="settings-backup">
            <p className="font-semibold">{t('backup.title')}</p>
            {!backup.configured ? (
              <p className="mt-1 text-sm text-neutral-400">{t('backup.notConfigured')}</p>
            ) : !backup.enabled ? (
              <p className="mt-1 text-sm text-neutral-400">{t('backup.off')}</p>
            ) : (
              <>
                <p className={`mt-1 text-sm ${st?.status === 'pending' ? 'text-amber-300' : 'text-neutral-300'}`} role="status" data-testid="backup-status" data-status={st?.status}>
                  {statusText}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button type="button" onClick={backupNow} disabled={Boolean(working)} data-testid="backup-now" className="min-h-[44px] rounded-lg border border-white/10 px-3 text-sm font-bold hover:border-brand disabled:opacity-50">
                    {working === 'backup' ? t('backup.status.syncing') : t('backup.now')}
                  </button>
                  <button type="button" onClick={restore} disabled={Boolean(working)} data-testid="backup-restore" className="min-h-[44px] rounded-lg border border-white/10 px-3 text-sm font-bold hover:border-brand disabled:opacity-50">
                    {working === 'restore' ? t('restore.title') : t('backup.restore')}
                  </button>
                </div>
                {note && (
                  <p className="mt-2 text-sm text-neutral-300" role="status" data-testid="backup-note">
                    {note}
                  </p>
                )}
              </>
            )}
          </div>
        )}

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
          </div>
          {user.provider !== 'google' && googleConfigured && (
            <div className="mt-3 rounded-xl border border-white/10 p-3" data-testid="settings-google-link">
              <p className="mb-2 text-center text-sm text-neutral-300">{t('settings.account.link')}</p>
              <GoogleButton onUser={onSignIn} />
            </div>
          )}
        </div>

        {/* Sign out = deep clean of this device (see lib/session.js). With the Drive backup on it first uploads the
            current state ("Sincronizando…") and only erases once Drive has it; otherwise it asks once. */}
        <div className="border-t border-white/10 pt-5">
          {phase !== 'idle' && (
            <p
              className={`mb-3 rounded-xl border px-4 py-3 text-sm ${phase === 'failed' ? 'border-amber-400/50 text-amber-200' : 'border-red-500/40 text-red-300'}`}
              role="alert"
              data-testid="logout-warning"
            >
              {phase === 'failed' ? t('settings.logout.fail') : t(cloud ? 'settings.logout.warn.backup' : 'settings.logout.warn')}
            </p>
          )}
          {phase === 'idle' ? (
            <button
              type="button"
              onClick={() => setPhase('confirming')}
              data-testid="logout-button"
              className="min-h-[52px] w-full rounded-xl bg-red-600 text-base font-bold text-white transition hover:bg-red-500 active:scale-[0.98]"
            >
              {t('settings.logout')}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Button variant="ghost" onClick={() => setPhase('idle')} disabled={busy} data-testid="logout-cancel">
                  {t('common.cancel')}
                </Button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => leave()}
                  data-testid="logout-confirm"
                  className="min-h-[52px] rounded-xl bg-red-600 px-3 text-sm font-bold text-white transition hover:bg-red-500 active:scale-[0.98] disabled:opacity-60"
                >
                  {busy ? (cloud ? t('settings.logout.syncing') : t('settings.logout.working')) : phase === 'failed' ? t('settings.logout.retry') : t(cloud ? 'settings.logout' : 'settings.logout.confirm')}
                </button>
              </div>
              {phase === 'failed' && (
                <button
                  type="button"
                  onClick={() => leave({ force: true })}
                  data-testid="logout-force"
                  className="min-h-[44px] w-full rounded-xl border border-red-500/60 px-3 text-sm font-bold text-red-300 hover:bg-red-500/10"
                >
                  {t('settings.logout.force')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
