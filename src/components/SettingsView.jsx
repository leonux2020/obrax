import { useState } from 'react';
import BackupBadge from './BackupBadge.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { googleConfigured } from '../lib/auth.js';
import { BACKUP_FOLDER } from '../lib/drive.js';
import { useBackLayer } from '../lib/backStack.js';
import { CloudUploadIcon, GlobeIcon, Outline, ReceiptIcon, SmartphoneIcon, UserIcon, UsersIcon } from './workspace/icons.jsx';
import { Button, Switch } from './ui.jsx';
import GoogleButton from './GoogleButton.jsx';
import { LocaleRows } from './SettingsRows.jsx';
import InstallButton from './InstallButton.jsx';
import ProfileCard from './ProfileCard.jsx';
import SquadraSheet from './squadra/SquadraSheet.jsx';
import { GeminiKeyField } from './GeminiKey.jsx';

/** An open accordion is a back-stack layer: the device's Back folds it (one per press, the last opened first) and Ajustes stays on screen. */
function OpenLayer({ onClose }) {
  useBackLayer(onClose);
  return null;
}

/** One collapsible block of Ajustes (closed by default). `open` is kept by the parent. */
function Accordion({ testId, titleId, icon: Icon, title, open, onToggle, children, bodyClassName = '' }) {
  return (
    <details
      open={open}
      onToggle={(e) => e.currentTarget.open !== open && onToggle(e.currentTarget.open)}
      className="card !p-0"
      data-testid={testId}
    >
      <summary data-testid={`${testId}-summary`} className="flex min-h-[64px] cursor-pointer list-none items-center gap-3 px-4 sm:px-5 [&::-webkit-details-marker]:hidden">
        <Icon size={22} className="text-neutral-400" />
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-lg font-light tracking-[0.02em] text-neutral-300">
          {title}
        </h2>
      </summary>
      <div className={`border-t border-white/10 ${bodyClassName}`}>{children}</div>
    </details>
  );
}

/**
 * Ajustes: a top-level, full-screen view wired to the bottom navigation tab (never a floating sheet: no close button, no drag;
 * you leave it by tapping another tab). Three OLED cards (black + white/10):
 *   1. Perfil de Empresa  — logo (tap to change) + name / professional / email / phone
 *   2. Idioma y País      — language and country side by side
 *   3. Google Drive       — the cloud command centre (toggle, account, backup / restore)
 * The identity card (company + professional) is the dual read/edit ProfileCard.
 */
export default function SettingsView({
  user,
  company,
  logo,
  regionCode,
  pwa,
  drive,
  onDriveChange,
  onConnect = async () => ({ ok: false }),
  onSaveProfile,
  onSignIn,
  onChangeLang,
  onChangeRegion, // legacy: opens the full-screen picker (kept for callers that still pass it)
  onConfirmRegion = null, // preferred: change country in place without leaving Ajustes
  onLogout,
  onSwitchAccount = null, // drops ONLY the Drive connection (token + flags); the local data is never touched
  backup = null,
  projects = [], // every stored project: the financial history of a worker (Squadra) reads them
}) {
  const { t, lang, region } = useI18n();
  const [phase, setPhase] = useState('idle'); // idle | confirming | syncing | failed (sign-out)
  const [working, setWorking] = useState(''); // '' | 'connect'
  const [note, setNote] = useState('');
  const [openAcc, setOpenAcc] = useState({ profile: false, ops: false, locale: false }); // everything starts closed: a nearly empty screen
  const toggleAcc = (key) => (isOpen) => setOpenAcc((o) => ({ ...o, [key]: isOpen }));
  const [editingAccount, setEditingAccount] = useState(false); // the account row is read-only until its pencil is tapped
  const [squadra, setSquadra] = useState(false); // the global directory of workers (full-screen sheet over Ajustes)
  const cloud = Boolean(backup?.enabled);
  const busy = phase === 'syncing';

  const when = (at) => {
    try {
      return new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(at));
    } catch {
      return new Date(at).toISOString();
    }
  };
  const st = backup?.state;
  // why the cloud waits (an upload that could not go, or a download that could not run): 'offline' | 'auth' | 'quota' | 'error' | ''
  const waitReason = st?.status === 'pending' ? st.reason || 'error' : st?.pullError || '';

  const leave = async (opts) => {
    setPhase('syncing');
    const r = await onLogout(opts);
    if (r && r.ok === false) setPhase('failed');
  };
  const connect = async () => {
    setWorking('connect');
    setNote('');
    const r = await onConnect();
    setWorking('');
    if (r && r.ok === false && r.reason !== 'redirect') setNote(connectError(r.reason));
  };
  const connectError = (reason) => t(['not_configured', 'offline', 'denied'].includes(reason) ? `setup.drive.err.${reason}` : 'setup.drive.err.denied');
  const toggleDrive = async (on) => {
    setNote('');
    if (on && backup?.configured && !backup?.linked) setWorking('connect');
    const r = await onDriveChange(on);
    setWorking('');
    if (on && r && r.ok === false && r.reason !== 'redirect') setNote(connectError(r.reason));
  };
  const googleUser = user?.provider === 'google';
  const canSwitch = googleUser && Boolean(onSwitchAccount);
  const accountRow = (
    <div>
      <div className="flex items-center gap-3" data-testid="settings-account">
        {user?.picture ? (
          <img src={user.picture} alt="" className="h-10 w-10 shrink-0 rounded-full border border-white/10 object-cover" />
        ) : (
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-medium text-neutral-400">
            {(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{user?.name}</span>
          {user?.email && <span className="block truncate text-sm text-neutral-400">{user.email}</span>}
        </span>
        {/* progressive disclosure: the row only offers a quiet pencil; the real action lives one tap deeper, away from the thumb's first reach */}
        {canSwitch && (
          <button
            type="button"
            onClick={() => setEditingAccount((v) => !v)}
            data-testid="edit-account"
            aria-expanded={editingAccount}
            aria-controls="account-edit-panel"
            aria-label={t('settings.account.edit')}
            title={t('settings.account.edit')}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95 active:opacity-70 ${editingAccount ? 'bg-white/10 text-neutral-200' : 'text-neutral-400'}`}
          >
            <Outline size={20} icon="pencil">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </Outline>
          </button>
        )}
      </div>
      {canSwitch && editingAccount && (
        <div id="account-edit-panel" data-testid="account-edit-panel" className="mt-5 space-y-5 pb-2 pl-[52px]">
          <p className="text-xs font-light leading-relaxed text-white/50" data-testid="account-unlink-desc">
            {t('settings.account.unlink_desc')}
          </p>
          <button
            type="button"
            onClick={() => {
              setEditingAccount(false);
              onSwitchAccount();
            }}
            data-testid="switch-account"
            className="flex min-h-[48px] w-full items-center justify-center rounded-full bg-white/5 px-6 text-sm font-normal text-neutral-200 transition active:scale-95 active:bg-white/10 active:opacity-70"
          >
            {t('settings.account.switch')}
          </button>
        </div>
      )}
    </div>
  );

  // One back-stack layer per open accordion: the device's Back folds the last opened first
  const layers = ['profile', 'ops', 'locale'].filter((k) => openAcc[k]).map((k) => <OpenLayer key={k} onClose={() => toggleAcc(k)(false)} />);

  return (
    <>
    {layers}
    <div className="min-h-screen bg-black" data-testid="settings-view">
      <main className="mx-auto w-full max-w-3xl space-y-4 px-3 pb-44 pt-4 sm:px-4">
        {/* no visible page title: the bottom nav already says where you are. The heading stays for screen readers. */}
        <h1 className="sr-only" data-testid="settings-title">
          {t('settings.title')}
        </h1>
        <div className="flex items-center justify-end gap-2">
          <BackupBadge size={22} />
        </div>

        {/* ---- 1. Perfil de Empresa ---------------------------------------------------------------------------------- */}
        <Accordion testId="settings-profile" titleId="settings-profile-title" icon={UserIcon} title={t('settings.profile')} open={openAcc.profile} onToggle={toggleAcc('profile')}>
          <ProfileCard open={openAcc.profile} company={company} logo={logo} onSave={onSaveProfile ? (data) => onSaveProfile({ ...data, drive }) : null} />
        </Accordion>

        {/* ---- 2. Operaciones y Sincronización: solo Drive y respaldo (la firma vive en la tarjeta del profesional) ---------------------------------------- */}
        <Accordion testId="settings-ops" titleId="settings-ops-title" icon={SmartphoneIcon} title={t('settings.ops')} open={openAcc.ops} onToggle={toggleAcc('ops')} bodyClassName="px-4 sm:px-5">
        {/* ---- Google Drive y Respaldo ---------------------------------------------------------------------------- */}
        <div className="space-y-3 py-2" data-testid="settings-cloud">
          <h2 id="settings-drive-title" className="sr-only">
            {t('settings.cloud')}
          </h2>
          <div className="flex items-center gap-3">
            <CloudUploadIcon size={22} className="text-neutral-400" />
            <Switch
              checked={drive}
              onChange={toggleDrive}
              label={t('settings.driveSync')}
              description={t('settings.driveSync.sub')}
              labelClassName="text-base font-light tracking-[0.02em] text-neutral-300"
              className="min-w-0 flex-1 !border-0 !bg-transparent !p-0"
              data-testid="settings-drive"
            />
          </div>

          {drive && googleUser && <div className="pt-1">{accountRow}</div>}

          {backup && (drive || !backup.configured) && (
            <div className="space-y-3 pt-1" data-testid="settings-backup" data-state={!backup.configured ? 'unconfigured' : !backup.enabled ? 'off' : backup.linked ? 'connected' : 'disconnected'}>
              {!backup.configured ? (
                <p className="text-xs leading-snug text-[#e8c35f]" role="status" data-testid="backup-config-diagnostic" data-config={backup.configStatus || 'missing'}>
                  {t(backup.configStatus === 'invalid' ? 'backup.cfg.invalid' : 'backup.cfg.missing')}
                </p>
              ) : !backup.enabled ? null : !backup.linked ? (
                <button
                  type="button"
                  onClick={connect}
                  disabled={Boolean(working)}
                  data-testid="backup-connect"
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-black hover:bg-brand-light disabled:opacity-50"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.4" />
                    <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.33-1.3" />
                  </svg>
                  {working === 'connect' ? t('backup.connecting') : t('backup.connect')}
                </button>
              ) : (
                <>
                  <div className="flex items-center gap-2" data-testid="backup-connected">
                    <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-brand" />
                    <p className="min-w-0 flex-1 truncate font-medium">{t('backup.connected')}</p>
                    {st?.status === 'synced' && (
                      <span className="shrink-0 text-xs font-medium text-brand" data-testid="backup-synced-tag">
                        {t('backup.synced.short')}
                      </span>
                    )}
                  </div>
                  {!googleUser && (user?.email || user?.name) && (
                    <p className="truncate text-sm text-neutral-300" data-testid="backup-account">
                      {user.name}
                      {user.email && user.name ? ' · ' : ''}
                      {user.email}
                    </p>
                  )}
                  {googleUser && <span className="sr-only" data-testid="backup-account">{[user.name, user.email].filter(Boolean).join(' · ')}</span>}
                  <p className="truncate text-sm text-neutral-500" data-testid="backup-folder">
                    {t('backup.folder', { name: BACKUP_FOLDER })}
                  </p>
                  {/* ZERO STRESS: no "save now" / "restore" buttons. The daemon syncs by itself (app comes back, signal returns, every change, debounced);
                      the only things to read here are that it is on and when it last succeeded. */}
                  <div role="status" data-testid="backup-status" data-status={st?.status}>
                    {waitReason && (
                      <p className="mb-1 text-sm text-[#e8c35f]" data-testid="backup-pending">
                        {t(`backup.status.pending.${waitReason}`)}
                      </p>
                    )}
                    <p className="text-sm leading-snug text-neutral-500" data-testid="backup-auto">
                      {t('backup.auto')}
                      {st?.at ? (
                        <>
                          {' · '}
                          <span data-testid="backup-last" data-at={st.at}>
                            {t('backup.auto.last', { when: when(st.at) })}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {/* the ONE case where the daemon needs the user: Google asks for a fresh consent (amber cloud). The way back is a single tap, shown only then. */}
                  {waitReason === 'auth' && (
                    <button
                      type="button"
                      onClick={connect}
                      disabled={Boolean(working)}
                      data-testid="backup-reconnect"
                      className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 text-sm font-semibold text-black hover:bg-brand-light disabled:opacity-50"
                    >
                      {working === 'connect' ? t('backup.connecting') : t('backup.connect')}
                    </button>
                  )}
                </>
              )}
              {backup.configured && backup.held && (
                <div data-testid="backup-held">
                  <p className="text-xs leading-snug text-[#e8c35f]">{t('backup.held')}</p>
                </div>
              )}
              {note && (
                <p className="text-sm text-neutral-300" role="status" data-testid="backup-note">
                  {note}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ---- IA de lectura (Scontrino IA): la clave propia de Google AI Studio (BYOK), guardada solo en este dispositivo ---- */}
        <div className="space-y-3 pb-4 pt-5" data-testid="settings-ai">
          <div className="flex items-center gap-3">
            <ReceiptIcon size={22} className="text-neutral-400" />
            <h2 id="settings-ai-title" className="min-w-0 flex-1 truncate text-base font-light tracking-[0.02em] text-neutral-300">
              {t('settings.ai')}
            </h2>
          </div>
          <GeminiKeyField testId="settings-gemini-key" />
        </div>
        </Accordion>

        {/* ---- 3. Preferencias del sistema: Idioma y País -------------------------------------------------------------------------------------- */}
        <Accordion testId="settings-locale" titleId="settings-locale-title" icon={GlobeIcon} title={t('settings.locale')} open={openAcc.locale} onToggle={toggleAcc('locale')} bodyClassName="px-4 sm:px-5">
          <LocaleRows regionCode={regionCode} onChangeLang={onChangeLang} onConfirmRegion={onConfirmRegion} onChangeRegion={onChangeRegion} />
        </Accordion>

        <InstallButton pwa={pwa} quiet />

        {/* Local account (Google account lives inside the Drive card when connected) */}
        {!googleUser && (
          <section className="card space-y-3" aria-labelledby="settings-account-title">
            <h2 id="settings-account-title" className="text-sm font-medium text-neutral-400">
              {t('settings.account')}
            </h2>
            {accountRow}
            {googleConfigured && (
              <div className="rounded-xl border border-white/10 p-3" data-testid="settings-google-link">
                <p className="mb-2 text-center text-sm text-neutral-400">{t('settings.account.link')}</p>
                <GoogleButton onUser={onSignIn} />
              </div>
            )}
          </section>
        )}

        {/* ---- Squadra / Maestranze: the team directory. Its own card, clearly apart and ABOVE the logout, which stays the lowest thing of the menu ---- */}
        <button
          type="button"
          onClick={() => setSquadra(true)}
          data-testid="settings-squadra"
          className="card !py-0 mt-8 flex min-h-[64px] w-full items-center gap-3 px-4 text-left transition active:border-white/40 sm:px-5"
        >
          <UsersIcon size={22} className="text-neutral-400" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-light tracking-[0.02em] text-neutral-300">{t('squadra.title')}</span>
            <span className="block truncate text-xs text-neutral-400">{t('squadra.subtitle')}</span>
          </span>
        </button>

        <div className="mt-10 border-t border-white/10 pt-6" data-testid="settings-logout-zone">
          {phase !== 'idle' && (
            <p className={`mb-3 rounded-xl border px-4 py-3 text-sm ${phase === 'failed' ? 'border-amber-400/50 text-amber-200' : 'border-red-500/40 text-red-300'}`} role="alert" data-testid="logout-warning">
              {phase === 'failed' ? t('settings.logout.fail') : t(cloud ? 'settings.logout.warn.backup' : 'settings.logout.warn')}
            </p>
          )}
          {phase === 'idle' ? (
            <button type="button" onClick={() => setPhase('confirming')} data-testid="logout-button" className="min-h-[44px] w-full rounded-xl border border-white/10 bg-transparent text-sm font-medium text-neutral-500 transition hover:text-neutral-300 active:scale-[0.98]">
              {t('settings.logout')}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Button variant="ghost" onClick={() => setPhase('idle')} disabled={busy} data-testid="logout-cancel">
                  {t('common.cancel')}
                </Button>
                <button type="button" disabled={busy} onClick={() => leave()} data-testid="logout-confirm" className="min-h-[52px] rounded-xl border border-red-500/40 bg-transparent px-3 text-sm font-semibold text-red-300 transition hover:bg-red-500/10 active:scale-[0.98] disabled:opacity-60">
                  {busy ? (cloud ? t('settings.logout.syncing') : t('settings.logout.working')) : phase === 'failed' ? t('settings.logout.retry') : t(cloud ? 'settings.logout' : 'settings.logout.confirm')}
                </button>
              </div>
              {phase === 'failed' && (
                <button type="button" onClick={() => leave({ force: true })} data-testid="logout-force" className="min-h-[44px] w-full rounded-xl border border-red-500/60 px-3 text-sm font-semibold text-red-300 hover:bg-red-500/10">
                  {t('settings.logout.force')}
                </button>
              )}
            </div>
          )}
        </div>
      </main>
      {squadra && <SquadraSheet projects={projects} onClose={() => setSquadra(false)} />}
    </div>
    </>
  );
}
