import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { regionName } from '../lib/regions.js';
import { googleConfigured } from '../lib/auth.js';
import { BACKUP_FOLDER } from '../lib/drive.js';
import { backupAge } from '../lib/driveSync.js';
import ProQaTag from './ProQaTag.jsx';
import { Button, Switch } from './ui.jsx';
import GoogleButton from './GoogleButton.jsx';
import BottomSheet from './BottomSheet.jsx';
import LangSelect from './LangSelect.jsx';
import InstallButton from './InstallButton.jsx';

/** Language, default country for new projects, PWA install and local profile switch. */
export default function SettingsSheet({ user, company, logo, regionCode, pwa, drive, onDriveChange, onConnect = async () => ({ ok: false }), onEditProfile, onSignIn, onChangeLang, onChangeRegion, onLogout, onClose, backup = null, onBackupNow = null, onRestore = null }) {
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
  const agoText = (at) => {
    const age = backupAge(at);
    return age ? t(age.key, { n: age.n }) : '';
  };
  const connect = async () => {
    setWorking('connect');
    setNote('');
    const r = await onConnect();
    setWorking('');
    if (r && r.ok === false && r.reason !== 'redirect') setNote(connectError(r.reason));
  };
  const connectError = (reason) => t(['not_configured', 'offline', 'denied'].includes(reason) ? `setup.drive.err.${reason}` : 'setup.drive.err.denied');
  // the toggle: switching it ON for an account that is not linked yet opens Google's own authorization at once
  const toggleDrive = async (on) => {
    setNote('');
    if (on && backup?.configured && !backup?.linked) setWorking('connect');
    const r = await onDriveChange(on);
    setWorking('');
    if (on && r && r.ok === false && r.reason !== 'redirect') setNote(connectError(r.reason));
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
        <ProQaTag className="block text-center" />
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

        {/* FREE feature: Google Drive backup. One card tells the state without doubt: not configured (admin diagnostic), not connected
            (big connect button) or connected (account, exclusive folder, last backup, "Respaldar ahora"). */}
        <Switch checked={drive} onChange={toggleDrive} label={t('setup.drive')} description={t('setup.drive.desc')} data-testid="settings-drive" />

        {backup && (
          <div className="rounded-xl border border-white/10 bg-black px-4 py-3" data-testid="settings-backup" data-state={!backup.configured ? 'unconfigured' : !backup.enabled ? 'off' : backup.linked ? 'connected' : 'disconnected'}>
            {!backup.configured ? (
              <>
                <p className="font-semibold">{t('backup.title')}</p>
                <p className="mt-1 text-xs leading-snug text-[#e8c35f]" role="status" data-testid="backup-config-diagnostic" data-config={backup.configStatus || 'missing'}>
                  {t(backup.configStatus === 'invalid' ? 'backup.cfg.invalid' : 'backup.cfg.missing')}
                </p>
              </>
            ) : !backup.enabled ? (
              <>
                <p className="font-semibold">{t('backup.title')}</p>
                <p className="mt-1 text-sm text-[#E0E0E0]/60">{t('backup.off')}</p>
              </>
            ) : !backup.linked ? (
              <>
                <p className="font-semibold">{t('backup.title')}</p>
                <p className="mt-1 text-sm text-[#E0E0E0]/60">{t('backup.connect.hint')}</p>
                <button
                  type="button"
                  onClick={connect}
                  disabled={Boolean(working)}
                  data-testid="backup-connect"
                  className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-black px-3 text-sm font-bold text-brand hover:border-brand disabled:opacity-50"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.4" />
                    <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.33-1.3" />
                  </svg>
                  {working === 'connect' ? t('backup.connecting') : t('backup.connect')}
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2" data-testid="backup-connected">
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-brand" />
                  <p className="min-w-0 flex-1 truncate font-semibold">{t('backup.connected')}</p>
                  {st?.status === 'synced' && (
                    <span className="shrink-0 text-xs font-semibold text-brand" data-testid="backup-synced-tag">
                      {t('backup.synced.short')}
                    </span>
                  )}
                </div>
                {(user?.email || user?.name) && (
                  <p className="mt-1 truncate text-sm text-[#E0E0E0]/80" data-testid="backup-account">
                    {user.name}
                    {user.email && user.name ? ' · ' : ''}
                    {user.email}
                  </p>
                )}
                <p className="mt-2 inline-block max-w-full truncate rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-[#E0E0E0]/60" data-testid="backup-folder">
                  {t('backup.folder', { name: BACKUP_FOLDER })}
                </p>
                <p className={`mt-2 text-sm ${st?.status === 'pending' ? 'text-[#e8c35f]' : 'text-[#E0E0E0]/70'}`} role="status" data-testid="backup-status" data-status={st?.status}>
                  {st?.status === 'synced' && st.at ? t('backup.last', { when: agoText(st.at) }) : statusText}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={backupNow}
                    disabled={Boolean(working)}
                    data-testid="backup-now"
                    className="min-h-[44px] rounded-lg bg-brand px-3 text-sm font-bold text-black hover:bg-brand-light disabled:opacity-50"
                  >
                    {working === 'backup' ? t('backup.status.syncing') : t('backup.now')}
                  </button>
                  <button type="button" onClick={restore} disabled={Boolean(working)} data-testid="backup-restore" className="min-h-[44px] rounded-lg border border-white/10 px-3 text-sm font-bold hover:border-brand disabled:opacity-50">
                    {working === 'restore' ? t('restore.title') : t('backup.restore')}
                  </button>
                </div>
              </>
            )}
            {backup.configured && backup.held && (
              <div className="mt-3" data-testid="backup-held">
                <p className="text-xs leading-snug text-[#e8c35f]">{t('backup.held')}</p>
                {!(backup.enabled && backup.linked) && (
                  <button type="button" onClick={restore} disabled={Boolean(working)} data-testid="backup-restore" className="mt-2 min-h-[44px] w-full rounded-lg border border-white/10 px-3 text-sm font-bold hover:border-brand disabled:opacity-50">
                    {working === 'restore' ? t('restore.title') : t('backup.restore')}
                  </button>
                )}
              </div>
            )}
            {note && (
              <p className="mt-2 text-sm text-[#E0E0E0]/80" role="status" data-testid="backup-note">
                {note}
              </p>
            )}
          </div>
        )}

        <InstallButton pwa={pwa} />

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
