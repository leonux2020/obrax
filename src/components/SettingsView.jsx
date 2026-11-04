import { useEffect, useRef, useState } from 'react';
import BackupBadge from './BackupBadge.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { sanitizeEmail, sanitizeEmailInput, sanitizePhone, sanitizeTaxId, sanitizeText, sanitizeTextInput } from '../lib/sanitize.js';
import { EMPTY_COMPANY, normalizeCompany } from '../lib/draft.js';
import { googleConfigured } from '../lib/auth.js';
import { detectCurrentRegion } from '../lib/geo.js';
import { BACKUP_FOLDER } from '../lib/drive.js';
import { compressLogo, LOGO_LIMITS } from '../lib/logo.js';
import { PhotoError } from '../lib/photos.js';
import { useBackLayer } from '../lib/backStack.js';
import { CloudUploadIcon, FileSignatureIcon, GlobeIcon, SmartphoneIcon, UserIcon, UsersIcon } from './workspace/icons.jsx';
import { Button, Switch, TextField } from './ui.jsx';
import { EditToggle } from './EditControls.jsx';
import GoogleButton from './GoogleButton.jsx';
import LangSelect from './LangSelect.jsx';
import RegionCombobox from './RegionCombobox.jsx';
import InstallButton from './InstallButton.jsx';
import ContractorSignatureSheet from './ContractorSignatureSheet.jsx';
import SquadraSheet from './squadra/SquadraSheet.jsx';

/** An open accordion is a back-stack layer: the device's Back folds it (one per press, the last opened first) and Ajustes stays on screen. */
function OpenLayer({ onClose }) {
  useBackLayer(onClose);
  return null;
}

/** One collapsible block of Ajustes (closed by default). `open` is kept by the parent so it survives the signature canvas (which swaps the screen). */
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
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-lg font-semibold">
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
 * Advanced profile (tax IDs, signature) stays one tap away via "Editar".
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
  backup = null,
}) {
  const { t, lang, region } = useI18n();
  const [phase, setPhase] = useState('idle'); // idle | confirming | syncing | failed (sign-out)
  const [working, setWorking] = useState(''); // '' | 'connect'
  const [note, setNote] = useState('');
  const [form, setForm] = useState(() => ({ ...EMPTY_COMPANY, ...company }));
  const [pic, setPic] = useState(logo || '');
  const [emailError, setEmailError] = useState(false);
  const [logoError, setLogoError] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);
  const [openAcc, setOpenAcc] = useState({ profile: false, ops: false, locale: false }); // everything starts closed: a nearly empty screen
  const [editProfile, setEditProfile] = useState(false); // the company card is a passive business card; only the pencil turns it into the form
  const toggleAcc = (key) => (isOpen) => {
    setOpenAcc((o) => ({ ...o, [key]: isOpen }));
    if (key === 'profile' && !isOpen) setEditProfile(false); // folding the card puts it back to read-only
  };
  const [signing, setSigning] = useState(false); // only the signature canvas (never the old profile modal)
  const [squadra, setSquadra] = useState(false); // the global directory of workers (full-screen sheet over Ajustes)
  const logoRef = useRef(null);
  const saving = useRef(null);
  const formRef = useRef(form);
  const picRef = useRef(pic);
  const dirty = useRef(false);
  // do NOT write `formRef.current = form` on every render: a parent re-render would wipe a value just typed
  // before React has committed setForm, and blur / debounce would persist the empty previous profile
  const cloud = Boolean(backup?.enabled);
  const busy = phase === 'syncing';

  // keep the card in sync when Ajustes re-opens with a newer profile (e.g. after ProfileSheet)
  const baseline = useRef('');
  useEffect(() => {
    if (dirty.current) return; // typing / pending autosave: never rewrite the inputs (would eat the trailing space and jump the caret)
    const key = JSON.stringify({ company, logo: logo || '' });
    if (key === baseline.current) return; // our own save already matches what is on screen
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
  // persist: trim free-text ONLY here (never while typing). The local inputs keep trailing spaces so "Nombre Apellido" works.
  const persist = async (nextForm, nextLogo) => {
    if (!onSaveProfile) return;
    const email = String(nextForm.email || '').trim();
    if (email && !sanitizeEmail(email)) {
      setEmailError(true);
      return;
    }
    setEmailError(false);
    const cleaned = {
      ...nextForm,
      name: sanitizeText(nextForm.name, 80).trim(),
      proName: sanitizeText(nextForm.proName, 60).trim(),
      city: sanitizeText(nextForm.city || '', 60).trim(),
      email,
    };
    const payload = { ...cleaned, logo: nextLogo, drive };
    const stored = normalizeCompany(cleaned); // same shape App will put in state / localStorage
    const job = Promise.resolve(onSaveProfile(payload))
      .then(() => {
        baseline.current = JSON.stringify({ company: stored, logo: nextLogo || '' });
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
  const commitField = () => {
    const cur = formRef.current;
    const trimmed = {
      ...cur,
      name: sanitizeText(cur.name, 80).trim(),
      proName: sanitizeText(cur.proName, 60).trim(),
      city: sanitizeText(cur.city || '', 60).trim(),
    };
    formRef.current = trimmed;
    setForm(trimmed);
    return persist(trimmed, picRef.current);
  };
  useEffect(() => {
    if (!dirty.current || !onSaveProfile) return undefined;
    const id = setTimeout(() => {
      // leave dirty=true until the write settles: otherwise a trimmed company coming back from App rewrites the input and eats the space
      persist(formRef.current, picRef.current).finally(() => {
        dirty.current = false;
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
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-medium text-neutral-400">
          {(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{user?.name}</span>
        {user?.email && <span className="block truncate text-sm text-neutral-400">{user.email}</span>}
      </span>
    </div>
  );

  // the read-only business card shows only what is filled in
  const facts = [
    [t(`company.taxId.${region?.code || 'CL'}`), form.taxId, 'tax'],
    [t('company.email'), form.email, 'email'],
    [t('company.phone'), form.phone, 'phone'],
    [t('company.city'), form.city, 'city'],
  ].filter(([, v]) => v);

  // The layers live in a fragment OUTSIDE the swap below, so the signature canvas replacing the screen never remounts them (no stray history entries)
  const layers = ['profile', 'ops', 'locale'].filter((k) => openAcc[k]).map((k) => <OpenLayer key={k} onClose={() => toggleAcc(k)(false)} />);

  if (signing) {
    return (
      <>
        {layers}
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
      </>
    );
  }

  return (
    <>
    {layers}
    <div className="min-h-screen bg-black" data-testid="settings-view">
      <main className="mx-auto w-full max-w-3xl space-y-4 px-3 pb-44 pt-4 sm:px-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-medium" data-testid="settings-title">
            {t('settings.title')}
          </h1>
          <BackupBadge size={22} />
        </div>

        {/* ---- 1. Perfil de Empresa ---------------------------------------------------------------------------------- */}
        <Accordion testId="settings-profile" titleId="settings-profile-title" icon={UserIcon} title={t('settings.profile')} open={openAcc.profile} onToggle={toggleAcc('profile')}>
          <div className="relative">
          <div className="absolute right-1 top-1 z-10">
            <EditToggle active={editProfile} onToggle={() => setEditProfile((v) => !v)} label={t('settings.profile.edit')} doneLabel={t('crew.edit.done')} testId="settings-profile-edit" />
          </div>
          {!editProfile ? (
            <div className="px-4 py-5 pr-14 sm:px-5 sm:pr-16" data-testid="settings-profile-card">
              <div className="flex items-center gap-4">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 p-1.5" data-testid="settings-profile-logo">
                  {pic ? <img src={pic} alt="" className="max-h-full max-w-full object-contain" /> : <span aria-hidden="true" className="text-2xl font-medium text-neutral-500">{(form.name || form.proName || '?').trim().slice(0, 1).toUpperCase() || '?'}</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-xl font-medium tracking-tight ${form.name ? 'text-neutral-100' : 'text-neutral-500'}`} data-testid="settings-profile-name">
                    {form.name || t('settings.profile.empty')}
                  </span>
                  {form.proName && (
                    <span className="mt-0.5 block truncate text-sm text-neutral-400" data-testid="settings-profile-pro">
                      {form.proName}
                    </span>
                  )}
                </span>
              </div>
              {facts.length > 0 && (
                <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-white/10 pt-4 sm:grid-cols-2">
                  {facts.map(([label, value, key]) => (
                      <div key={key} className="min-w-0">
                        <dt className="text-xs font-medium text-neutral-500">{label}</dt>
                        <dd className="truncate text-base text-neutral-200" data-testid={`settings-profile-${key}`}>
                          {value}
                        </dd>
                      </div>
                  ))}
                </dl>
              )}
            </div>
          ) : (
          <div className="space-y-4 px-4 pb-4 pt-12 sm:px-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => logoRef.current?.click()}
                disabled={logoBusy || !onSaveProfile}
                data-testid="settings-logo"
                aria-label={t(pic ? 'company.logo.replace' : 'company.logo.add')}
                className="group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl bg-transparent p-1.5 transition disabled:opacity-60"
              >
                {pic ? <img src={pic} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs font-medium text-neutral-500">LOGO</span>}
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/70 py-1 text-xs font-medium text-neutral-200 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                  {t('settings.logo.edit')}
                </span>
              </button>
              <input ref={logoRef} type="file" accept={LOGO_LIMITS.types.join(',')} className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="settings-logo-input" onChange={onLogoFile} />
              {logoError && (
                <p role="alert" className="mt-1.5 max-w-[5rem] text-xs font-medium text-red-400">
                  {logoError}
                </p>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <TextField label={t('company.name')} value={form.name} onChange={setField('name')} onBlur={commitField} testId="settings-company-name" sanitize={(v) => sanitizeTextInput(v, 80)} placeholder={t('company.name.ph')} />
              <TextField label={t('setup.pro.name')} value={form.proName} onChange={setField('proName')} onBlur={commitField} testId="settings-pro-name" maxLength={60} sanitize={(v) => sanitizeTextInput(v, 60)} placeholder={t('setup.pro.namePh')} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <TextField label={t('company.email')} value={form.email} onChange={setField('email')} onBlur={commitField} testId="settings-company-email" maxLength={120} optional={t('common.optional')} sanitize={sanitizeEmailInput} placeholder="name@company.com" />
              {emailError && (
                <p role="alert" className="mt-1.5 text-sm font-medium text-red-400">
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
            <TextField label={t('company.city')} value={form.city} onChange={setField('city')} onBlur={commitField} testId="settings-company-city" maxLength={60} optional={t('common.optional')} sanitize={(v) => sanitizeTextInput(v, 60)} placeholder={t('company.city.ph')} />
          </div>
          </div>
          )}
          </div>
        </Accordion>

        {/* ---- 2. Operaciones y Sincronización: firma + Drive en UNA tarjeta ---------------------------------------- */}
        <Accordion testId="settings-ops" titleId="settings-ops-title" icon={SmartphoneIcon} title={t('settings.ops')} open={openAcc.ops} onToggle={toggleAcc('ops')} bodyClassName="divide-y divide-white/10 px-4 sm:px-5">
          <button
            type="button"
            onClick={() => setSigning(true)}
            data-testid="settings-signature"
            className="flex min-h-[64px] w-full items-center gap-3 py-4 text-left transition hover:text-neutral-200"
          >
            <FileSignatureIcon size={22} className="text-neutral-400" />
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-medium">{t('settings.sign')}</span>
              <span className="block truncate text-xs text-neutral-400">{t(form.signature ? 'sign.pro.change' : 'sign.pro.empty')}</span>
            </span>
            {form.signature ? (
              <span className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white px-1">
                <img src={form.signature.dataUrl} alt="" className="max-h-full max-w-full object-contain" />
              </span>
            ) : null}
          </button>

        {/* ---- Google Drive y Respaldo ---------------------------------------------------------------------------- */}
        <div className="space-y-3 py-4" data-testid="settings-cloud">
          <h2 id="settings-drive-title" className="sr-only">
            {t('settings.cloud')}
          </h2>
          <div className="flex items-center gap-3">
            <CloudUploadIcon size={22} className="text-neutral-400" />
            <Switch checked={drive} onChange={toggleDrive} label={t('settings.driveSync')} className="min-w-0 flex-1 !border-0 !bg-transparent !p-0" data-testid="settings-drive" />
          </div>

          {drive && googleUser && <div className="border-t border-white/10 pt-3">{accountRow}</div>}

          {backup && (drive || !backup.configured) && (
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
                  <p className="truncate text-xs text-neutral-500" data-testid="backup-folder">
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
                    <p className="text-xs leading-snug text-neutral-500" data-testid="backup-auto">
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
        </Accordion>

        {/* ---- 3. Preferencias del sistema: Idioma y País -------------------------------------------------------------------------------------- */}
        <Accordion testId="settings-locale" titleId="settings-locale-title" icon={GlobeIcon} title={t('settings.locale')} open={openAcc.locale} onToggle={toggleAcc('locale')} bodyClassName="px-4 py-4 sm:px-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0" data-testid="settings-lang">
              <LangSelect onChange={onChangeLang} hideLabel={false} className="w-full !min-h-[52px] text-base" />
            </div>
            <div className="min-w-0" data-testid="settings-region">
              {onConfirmRegion ? (
                <RegionCombobox value={regionCode || detectCurrentRegion()} onChange={onConfirmRegion} />
              ) : (
                <button type="button" onClick={onChangeRegion} className="flex min-h-[52px] w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-neutral-900 px-4 text-left font-medium hover:bg-white/10">
                  <span className="truncate">{t('settings.region.change')}</span>
                </button>
              )}
            </div>
          </div>
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
          className="card !p-0 mt-8 flex min-h-[64px] w-full items-center gap-3 px-4 text-left transition active:border-white/40 sm:px-5"
        >
          <UsersIcon size={22} className="text-neutral-400" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-semibold">{t('squadra.title')}</span>
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
      {squadra && <SquadraSheet onClose={() => setSquadra(false)} />}
    </div>
    </>
  );
}
