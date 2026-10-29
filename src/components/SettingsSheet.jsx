import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { sanitizeEmail, sanitizeEmailInput, sanitizePhone, sanitizeTaxId, sanitizeText } from '../lib/sanitize.js';
import { EMPTY_COMPANY } from '../lib/draft.js';
import { googleConfigured } from '../lib/auth.js';
import { BACKUP_FOLDER } from '../lib/drive.js';
import { backupAge } from '../lib/driveSync.js';
import { compressLogo, LOGO_LIMITS } from '../lib/logo.js';
import { PhotoError } from '../lib/photos.js';
import ProQaTag from './ProQaTag.jsx';
import { Button, Switch, TextField } from './ui.jsx';
import GoogleButton from './GoogleButton.jsx';
import BottomSheet from './BottomSheet.jsx';
import LangSelect from './LangSelect.jsx';
import RegionCombobox from './RegionCombobox.jsx';
import InstallButton from './InstallButton.jsx';
import ContractorSignatureSheet from './ContractorSignatureSheet.jsx';

/**
 * Ajustes as three OLED cards (black + white/10):
 *   1. Perfil de Empresa  — logo (tap to change) + name / professional / email / phone
 *   2. Idioma y País      — language and country side by side
 *   3. Google Drive       — the cloud command centre (toggle, account, backup / restore)
 * Advanced profile (tax IDs, signature) stays one tap away via "Editar".
 */
export default function SettingsSheet({
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
  onClose,
  backup = null,
  onBackupNow = null,
  onRestore = null,
}) {
  const { t, lang, region } = useI18n();
  const [phase, setPhase] = useState('idle'); // idle | confirming | syncing | failed (sign-out)
  const [working, setWorking] = useState(''); // '' | 'backup' | 'restore' | 'connect'
  const [note, setNote] = useState('');
  const [form, setForm] = useState(() => ({ ...EMPTY_COMPANY, ...company }));
  const [pic, setPic] = useState(logo || '');
  const [emailError, setEmailError] = useState(false);
  const [logoError, setLogoError] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);
  const [signing, setSigning] = useState(false); // only the signature canvas (never the old profile modal)
  const [savedFlash, setSavedFlash] = useState(false); // "Guardado" after a successful autosave
  const logoRef = useRef(null);
  const saving = useRef(null);
  const formRef = useRef(form);
  const picRef = useRef(pic);
  const dirty = useRef(false);
  // do NOT write `formRef.current = form` on every render: a parent re-render would wipe a value just typed
  // before React has committed setForm, and blur / debounce would persist the empty previous profile
  useEffect(() => {
    if (!savedFlash) return undefined;
    const id = setTimeout(() => setSavedFlash(false), 2000);
    return () => clearTimeout(id);
  }, [savedFlash]);
  const cloud = Boolean(backup?.enabled);
  const busy = phase === 'syncing';

  // keep the card in sync when Ajustes re-opens with a newer profile (e.g. after ProfileSheet)
  const baseline = useRef('');
  useEffect(() => {
    const key = JSON.stringify({ company, logo: logo || '' });
    if (key === baseline.current) return; // our own save: the card already has these values
    baseline.current = key;
    const next = { ...EMPTY_COMPANY, ...company };
    formRef.current = next;
    picRef.current = logo || '';
    setForm(next);
    setPic(logo || '');
  }, [company, logo]);

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
    if (r && r.ok === false) setPhase('failed');
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

  // persist company + logo (email / phone included) without leaving Ajustes; signature and tax IDs stay as they are
  const persist = async (nextForm, nextLogo) => {
    if (!onSaveProfile) return;
    const email = String(nextForm.email || '').trim();
    if (email && !sanitizeEmail(email)) {
      setEmailError(true);
      return;
    }
    setEmailError(false);
    const payload = { ...nextForm, email, logo: nextLogo, drive };
    const job = Promise.resolve(onSaveProfile(payload))
      .then(() => {
        baseline.current = JSON.stringify({ company: { ...EMPTY_COMPANY, ...nextForm, email }, logo: nextLogo || '' });
        setSavedFlash(true);
      })
      .catch(() => setLogoError(t('company.logo.err.store')));
    saving.current = job;
    await job;
  };
  const setField = (key) => (value) => {
    // update the ref BEFORE setState: blur can fire in the same tick and must see what was just typed
    const next = { ...formRef.current, [key]: value };
    formRef.current = next;
    dirty.current = true;
    setForm(next);
    if (key === 'email') setEmailError(false);
  };
  const commitField = () => persist(formRef.current, picRef.current);
  useEffect(() => {
    if (!dirty.current || !onSaveProfile) return undefined;
    const id = setTimeout(() => {
      dirty.current = false;
      // mark baseline so the sync-from-props effect does not treat our own write as an external change
      const payload = { ...formRef.current, logo: picRef.current, drive };
      persist(formRef.current, picRef.current).then(() => {
        baseline.current = JSON.stringify({ company: { ...EMPTY_COMPANY, ...formRef.current }, logo: picRef.current || '' });
      });
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, pic]);

  const onLogoFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoBusy(true);
    setLogoError('');
    try {
      const next = await compressLogo(file);
      picRef.current = next;
      setPic(next);
      await persist(formRef.current, next);
    } catch (err) {
      setLogoError(t(`company.logo.err.${err instanceof PhotoError ? err.code : 'decode'}`));
    } finally {
      setLogoBusy(false);
    }
  };

  const googleUser = user?.provider === 'google';
  const accountRow = (
    <div className="flex items-center gap-3" data-testid="settings-account">
      {user?.picture ? (
        <img src={user.picture} alt="" className="h-10 w-10 shrink-0 rounded-full border border-white/10 object-cover" />
      ) : (
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-bold text-[#E0E0E0]/70">
          {(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{user?.name}</span>
        {user?.email && <span className="block truncate text-sm text-[#E0E0E0]/60">{user.email}</span>}
      </span>
    </div>
  );

  if (signing) {
    return (
      <ContractorSignatureSheet
        value={form.signature}
        onSave={(ink) => {
          const next = { ...formRef.current, signature: ink };
          formRef.current = next;
          dirty.current = true;
          setForm(next);
          setSigning(false);
          persist(next, picRef.current);
        }}
        onClose={() => setSigning(false)}
      />
    );
  }

  return (
    <BottomSheet title={t('settings.title')} onClose={onClose}>
      <div className="mt-3 space-y-4">
        <ProQaTag className="block text-center" />

        {/* ---- 1. Perfil de Empresa ---------------------------------------------------------------------------------- */}
        <section className="card relative space-y-4" aria-labelledby="settings-profile-title" data-testid="settings-profile">
          <div className="flex items-center justify-between gap-3">
            <h2 id="settings-profile-title" className="text-lg font-bold">
              {t('settings.profile')}
            </h2>
            <span
              aria-live="polite"
              data-testid="settings-saved"
              className={`text-xs font-semibold text-brand transition-opacity duration-500 ${savedFlash ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            >
              {t('settings.saved')}
            </span>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => logoRef.current?.click()}
                disabled={logoBusy || !onSaveProfile}
                data-testid="settings-logo"
                aria-label={t(pic ? 'company.logo.replace' : 'company.logo.add')}
                className="group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white p-1.5 transition hover:border-brand disabled:opacity-60"
              >
                {pic ? <img src={pic} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] font-bold text-black/50">LOGO</span>}
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/70 py-1 text-[10px] font-bold text-[#E0E0E0] opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                  {t('settings.logo.edit')}
                </span>
              </button>
              <input ref={logoRef} type="file" accept={LOGO_LIMITS.types.join(',')} className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="settings-logo-input" onChange={onLogoFile} />
              {logoError && (
                <p role="alert" className="mt-1.5 max-w-[5rem] text-xs font-semibold text-red-400">
                  {logoError}
                </p>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <TextField label={t('company.name')} value={form.name} onChange={setField('name')} onBlur={commitField} testId="settings-company-name" sanitize={(v) => sanitizeText(v, 80)} placeholder={t('company.name.ph')} />
              <TextField label={t('setup.pro.name')} value={form.proName} onChange={setField('proName')} onBlur={commitField} testId="settings-pro-name" maxLength={60} sanitize={(v) => sanitizeText(v, 60)} placeholder={t('setup.pro.namePh')} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <TextField label={t('company.email')} value={form.email} onChange={setField('email')} onBlur={commitField} testId="settings-company-email" maxLength={120} optional={t('common.optional')} sanitize={sanitizeEmailInput} placeholder="name@company.com" />
              {emailError && (
                <p role="alert" className="mt-1.5 text-sm font-semibold text-red-400">
                  {t('company.emailInvalid')}
                </p>
              )}
            </div>
            <TextField
              label={t('company.phone')}
              value={form.phone}
              onChange={setField('phone')}
              onBlur={commitField}
              testId="settings-company-phone"
              type="tel"
              inputMode="tel"
              maxLength={32}
              optional={t('common.optional')}
              sanitize={sanitizePhone}
              placeholder="+56 9 1234 5678"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              label={t(`company.taxId.${region?.code || 'CL'}`)}
              value={form.taxId}
              onChange={setField('taxId')}
              onBlur={commitField}
              testId="settings-company-tax"
              maxLength={20}
              optional={t('common.optional')}
              sanitize={sanitizeTaxId}
              placeholder={t(`company.taxId.ph.${region?.code || 'CL'}`)}
            />
            <TextField label={t('company.city')} value={form.city} onChange={setField('city')} onBlur={commitField} testId="settings-company-city" maxLength={60} optional={t('common.optional')} sanitize={(v) => sanitizeText(v, 60)} placeholder={t('company.city.ph')} />
          </div>

          <button
            type="button"
            onClick={() => setSigning(true)}
            data-testid="settings-signature"
            className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl border border-white/10 px-4 text-left transition hover:border-brand"
          >
            <span className="min-w-0">
              <span className="block text-sm font-bold">{t('settings.sign')}</span>
              <span className="block truncate text-xs text-[#E0E0E0]/55">{t(form.signature ? 'sign.pro.change' : 'sign.pro.empty')}</span>
            </span>
            {form.signature ? (
              <span className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white px-1">
                <img src={form.signature.dataUrl} alt="" className="max-h-full max-w-full object-contain" />
              </span>
            ) : (
              <span aria-hidden="true" className="text-lg text-[#E0E0E0]/40">
                ›
              </span>
            )}
          </button>
        </section>

        {/* ---- 2. Idioma y País -------------------------------------------------------------------------------------- */}
        <section className="card space-y-3" aria-labelledby="settings-locale-title" data-testid="settings-locale">
          <h2 id="settings-locale-title" className="text-lg font-bold">
            {t('settings.locale')}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0" data-testid="settings-lang">
              <LangSelect onChange={onChangeLang} hideLabel={false} className="w-full !min-h-[52px] text-base" />
            </div>
            <div className="min-w-0" data-testid="settings-region">
              {onConfirmRegion ? (
                <RegionCombobox value={regionCode} onChange={onConfirmRegion} />
              ) : (
                <button type="button" onClick={onChangeRegion} className="flex min-h-[52px] w-full items-center justify-between gap-2 rounded-xl border-2 border-neutral-700 px-4 text-left font-bold hover:border-brand">
                  <span className="truncate">{t('settings.region.change')}</span>
                  <span aria-hidden="true">›</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* ---- 3. Google Drive y Respaldo ---------------------------------------------------------------------------- */}
        <section className="card space-y-3" aria-labelledby="settings-drive-title" data-testid="settings-cloud">
          <h2 id="settings-drive-title" className="sr-only">
            {t('settings.cloud')}
          </h2>
          <Switch checked={drive} onChange={toggleDrive} label={t('setup.drive')} className="!border-0 !bg-transparent !p-0" data-testid="settings-drive" />

          {googleUser && <div className="border-t border-white/10 pt-3">{accountRow}</div>}

          {backup && (
            <div className="space-y-3 border-t border-white/10 pt-3" data-testid="settings-backup" data-state={!backup.configured ? 'unconfigured' : !backup.enabled ? 'off' : backup.linked ? 'connected' : 'disconnected'}>
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
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-black px-3 text-sm font-bold text-brand hover:border-brand disabled:opacity-50"
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
                    <p className="min-w-0 flex-1 truncate font-semibold">{t('backup.connected')}</p>
                    {st?.status === 'synced' && (
                      <span className="shrink-0 text-xs font-semibold text-brand" data-testid="backup-synced-tag">
                        {t('backup.synced.short')}
                      </span>
                    )}
                  </div>
                  {!googleUser && (user?.email || user?.name) && (
                    <p className="truncate text-sm text-[#E0E0E0]/80" data-testid="backup-account">
                      {user.name}
                      {user.email && user.name ? ' · ' : ''}
                      {user.email}
                    </p>
                  )}
                  {googleUser && <span className="sr-only" data-testid="backup-account">{[user.name, user.email].filter(Boolean).join(' · ')}</span>}
                  <p className="truncate text-[11px] text-[#E0E0E0]/50" data-testid="backup-folder">
                    {t('backup.folder', { name: BACKUP_FOLDER })}
                  </p>
                  <p className={`text-sm ${st?.status === 'pending' ? 'text-[#e8c35f]' : 'text-[#E0E0E0]/70'}`} role="status" data-testid="backup-status" data-status={st?.status}>
                    {st?.status === 'synced' && st.at ? t('backup.last', { when: agoText(st.at) }) : statusText}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={backupNow} disabled={Boolean(working)} data-testid="backup-now" className="min-h-[44px] rounded-lg bg-brand px-3 text-sm font-bold text-black hover:bg-brand-light disabled:opacity-50">
                      {working === 'backup' ? t('backup.status.syncing') : t('backup.now')}
                    </button>
                    <button type="button" onClick={restore} disabled={Boolean(working)} data-testid="backup-restore" className="min-h-[44px] rounded-lg border border-white/10 px-3 text-sm font-bold hover:border-brand disabled:opacity-50">
                      {working === 'restore' ? t('restore.title') : t('backup.restore')}
                    </button>
                  </div>
                </>
              )}
              {backup.configured && backup.held && (
                <div data-testid="backup-held">
                  <p className="text-xs leading-snug text-[#e8c35f]">{t('backup.held')}</p>
                  {!(backup.enabled && backup.linked) && (
                    <button type="button" onClick={restore} disabled={Boolean(working)} data-testid="backup-restore" className="mt-2 min-h-[44px] w-full rounded-lg border border-white/10 px-3 text-sm font-bold hover:border-brand disabled:opacity-50">
                      {working === 'restore' ? t('restore.title') : t('backup.restore')}
                    </button>
                  )}
                </div>
              )}
              {note && (
                <p className="text-sm text-[#E0E0E0]/80" role="status" data-testid="backup-note">
                  {note}
                </p>
              )}
            </div>
          )}
        </section>

        <InstallButton pwa={pwa} />

        {/* Local account (Google account lives inside the Drive card when connected) */}
        {!googleUser && (
          <section className="card space-y-3" aria-labelledby="settings-account-title">
            <h2 id="settings-account-title" className="text-sm font-bold text-[#E0E0E0]/70">
              {t('settings.account')}
            </h2>
            {accountRow}
            {googleConfigured && (
              <div className="rounded-xl border border-white/10 p-3" data-testid="settings-google-link">
                <p className="mb-2 text-center text-sm text-[#E0E0E0]/60">{t('settings.account.link')}</p>
                <GoogleButton onUser={onSignIn} />
              </div>
            )}
          </section>
        )}

        <div className="border-t border-white/10 pt-4">
          {phase !== 'idle' && (
            <p className={`mb-3 rounded-xl border px-4 py-3 text-sm ${phase === 'failed' ? 'border-amber-400/50 text-amber-200' : 'border-red-500/40 text-red-300'}`} role="alert" data-testid="logout-warning">
              {phase === 'failed' ? t('settings.logout.fail') : t(cloud ? 'settings.logout.warn.backup' : 'settings.logout.warn')}
            </p>
          )}
          {phase === 'idle' ? (
            <button type="button" onClick={() => setPhase('confirming')} data-testid="logout-button" className="min-h-[52px] w-full rounded-xl bg-red-600 text-base font-bold text-white transition hover:bg-red-500 active:scale-[0.98]">
              {t('settings.logout')}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Button variant="ghost" onClick={() => setPhase('idle')} disabled={busy} data-testid="logout-cancel">
                  {t('common.cancel')}
                </Button>
                <button type="button" disabled={busy} onClick={() => leave()} data-testid="logout-confirm" className="min-h-[52px] rounded-xl bg-red-600 px-3 text-sm font-bold text-white transition hover:bg-red-500 active:scale-[0.98] disabled:opacity-60">
                  {busy ? (cloud ? t('settings.logout.syncing') : t('settings.logout.working')) : phase === 'failed' ? t('settings.logout.retry') : t(cloud ? 'settings.logout' : 'settings.logout.confirm')}
                </button>
              </div>
              {phase === 'failed' && (
                <button type="button" onClick={() => leave({ force: true })} data-testid="logout-force" className="min-h-[44px] w-full rounded-xl border border-red-500/60 px-3 text-sm font-bold text-red-300 hover:bg-red-500/10">
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
