import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { sanitizeEmail, sanitizeEmailInput, sanitizePhone, sanitizeTaxId, sanitizeTextInput } from '../lib/sanitize.js';
import { EMPTY_COMPANY, companyEntity, normalizeCompany, professionalEntity } from '../lib/draft.js';
import { exportSignature, SignatureError } from '../lib/signature.js';
import { compressLogo, LOGO_LIMITS } from '../lib/logo.js';
import { PhotoError } from '../lib/photos.js';
import { MapPinIcon } from './workspace/icons.jsx';
import { Button, TextField } from './ui.jsx';
import { EditToggle } from './EditControls.jsx';
import { Line, MailIcon, PhoneIcon } from './squadra/WorkerCard.jsx';
import ProSignature from './ProSignature.jsx';

const initialOf = (c) => ((c.name || c.proName || '?').trim().slice(0, 1).toUpperCase() || '?');

/**
 * READ-ONLY identity card ("Zero Stress"): two blocks told apart by margins, type size and ONE hairline between them.
 *   Empresa      -> name (large), tax ID, place, email, phone
 *   Profesional  -> name, title, register number, and the digital signature floating at the end of the card
 * The stored signature is black ink on transparent, so on the OLED ground it is inverted to pure white.
 */
function ProfileRead({ company, logo, regionCode }) {
  const { t } = useI18n();
  const co = companyEntity(company);
  const pro = professionalEntity(company);
  const proName = [pro.name, pro.lastName].filter(Boolean).join(' ');
  const place = [co.address, co.city].filter(Boolean).join(', ');
  const hasPro = Boolean(proName || pro.title || pro.license || pro.id || pro.signature);
  return (
    <div className="px-4 py-5 pr-14 sm:px-5 sm:pr-16" data-testid="settings-profile-card">
      <section className="space-y-3" data-testid="settings-profile-company">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl p-1" data-testid="settings-profile-logo">
            {logo ? <img src={logo} alt="" className="max-h-full max-w-full object-contain" /> : <span aria-hidden="true" className="text-3xl font-medium text-neutral-500">{initialOf(company)}</span>}
          </span>
          <span className={`min-w-0 flex-1 break-words text-2xl font-semibold leading-tight tracking-tight ${co.name ? 'text-neutral-100' : 'text-neutral-500'}`} data-testid="settings-profile-name">
            {co.name || t('settings.profile.empty')}
          </span>
        </div>
        {co.taxId && (
          <p className="text-lg tabular-nums text-neutral-300" data-testid="settings-profile-tax">
            {t(`company.taxId.${regionCode}`)} {co.taxId}
          </p>
        )}
        <Line icon={<MapPinIcon size={18} />} label={t('profile.address')} testId="settings-profile-address">
          {place}
        </Line>
        <Line icon={<MailIcon size={18} />} label={t('company.email')} testId="settings-profile-email">
          {co.email}
        </Line>
        <Line icon={<PhoneIcon size={18} />} label={t('company.phone')} testId="settings-profile-phone">
          {co.phone}
        </Line>
      </section>

      {/* the ONLY line of the card: an almost invisible hairline, strictly between the company and the professional */}
      {hasPro && <hr data-testid="settings-profile-divider" className="my-6 border-neutral-800/50" />}
      {hasPro && (
        <section className="space-y-1" data-testid="settings-profile-professional">
          <p className="pb-1 text-sm font-medium text-neutral-500">{t('setup.pro')}</p>
          {proName && (
            <p className="break-words text-xl text-neutral-100" data-testid="settings-profile-pro">
              {proName}
            </p>
          )}
          {pro.title && (
            <p className="text-base text-brand" data-testid="settings-profile-title">
              {pro.title}
            </p>
          )}
          {pro.license && (
            <p className="text-sm text-neutral-400" data-testid="settings-profile-license">
              {pro.license}
            </p>
          )}
          {pro.id && (
            <p className="text-sm tabular-nums text-neutral-400" data-testid="settings-profile-proid">
              {t(`company.taxId.${regionCode}`)} {pro.id}
            </p>
          )}
          {pro.signature && (
            <div className="flex justify-end pt-8">
              <img src={pro.signature} alt={t('profile.sign.label')} data-testid="settings-profile-signature" className="h-16 max-w-[65%] object-contain invert" />
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Ajustes > Empresa y profesional. One card, one state machine (the same `isEditing` of the worker card):
 *   read  -> the two blocks above + a single pencil at the top right
 *   edit  -> ONE fluid form (company + professional + signature canvas), Save / Cancel at the bottom
 * Nothing is written while editing: Save persists once and returns to the refreshed read card; Cancel (or folding the accordion) drops the
 * draft and the stored data, signature included, is exactly as it was.
 */
export default function ProfileCard({ company, logo, onSave, open = true }) {
  const { t, region } = useI18n();
  const regionCode = region?.code || 'CL';
  const [current, setCurrent] = useState(() => ({ company: normalizeCompany(company), logo: logo || '' }));
  const incoming = JSON.stringify({ company: normalizeCompany(company), logo: logo || '' });
  useEffect(() => setCurrent(JSON.parse(incoming)), [incoming]);

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState(() => ({ ...EMPTY_COMPANY }));
  const [pic, setPic] = useState('');
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState(false);
  const [busy, setBusy] = useState(false);
  const logoRef = useRef(null);
  const sigRef = useRef(null);

  useEffect(() => {
    if (!open) setIsEditing(false); // folding the accordion drops the draft: it is back to the read card next time
  }, [open]);

  const startEdit = () => {
    setForm({ ...EMPTY_COMPANY, ...current.company });
    setPic(current.logo);
    setError('');
    setEmailError(false);
    setIsEditing(true);
  };
  const cancelEdit = () => {
    setIsEditing(false); // the draft (and the pad) are simply dropped: the stored profile is untouched
    setError('');
    setEmailError(false);
  };
  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key === 'email') setEmailError(false);
  };

  const onLogoFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      setPic(await compressLogo(file));
    } catch (err) {
      setError(t(`company.logo.err.${err instanceof PhotoError ? err.code : 'decode'}`));
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (busy || !onSave) return;
    const email = String(form.email || '').trim();
    if (email && !sanitizeEmail(email)) {
      setEmailError(true);
      return;
    }
    let signature = current.company.signature || null; // untouched pad: the previous signature is kept as it was
    const sig = sigRef.current?.result() ?? { status: 'keep' };
    if (sig.status === 'removed') signature = null;
    if (sig.status === 'new') {
      try {
        signature = exportSignature(sig.strokes); // cropped transparent PNG, <= 480x220 px and <= 60 000 chars: always fits in localStorage
      } catch (err) {
        setError(t(err instanceof SignatureError && err.code === 'empty' ? 'sign.err.empty' : 'sign.err.store'));
        return;
      }
    }
    const cleaned = normalizeCompany({ ...form, email, signature });
    setBusy(true);
    setError('');
    try {
      await onSave({ ...cleaned, logo: pic });
      setCurrent({ company: cleaned, logo: pic }); // the refreshed read card, also when the parent keeps its own state
      setIsEditing(false);
    } catch {
      setError(t('profile.err.save'));
    } finally {
      setBusy(false);
    }
  };

  if (!isEditing) {
    return (
      <div className="relative">
        <div className="absolute right-1 top-1 z-10">
          <EditToggle active={false} onToggle={startEdit} disabled={!onSave} label={t('settings.profile.edit')} doneLabel={t('crew.edit.done')} testId="settings-profile-edit" />
        </div>
        <ProfileRead company={current.company} logo={current.logo} regionCode={regionCode} />
      </div>
    );
  }

  const text = (key, label, extra = {}) => (
    <TextField label={label} value={form[key]} onChange={set(key)} sanitize={(v) => sanitizeTextInput(v, extra.maxLength || 60)} maxLength={extra.maxLength || 60} {...extra} />
  );
  return (
    <form onSubmit={save} noValidate className="space-y-10 px-4 pb-5 pt-5 sm:px-5" data-testid="settings-profile-form">
      <section className="space-y-4" data-testid="settings-form-company">
        <p className="text-sm font-medium text-neutral-400">{t('setup.company')}</p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => logoRef.current?.click()}
              data-testid="settings-logo"
              aria-label={t(pic ? 'company.logo.replace' : 'company.logo.add')}
              className="group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl bg-transparent p-1.5 transition"
            >
              {pic ? <img src={pic} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs font-medium text-neutral-500">LOGO</span>}
              <span aria-hidden="true" className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/70 py-1 text-xs font-medium text-neutral-200 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                {t('settings.logo.edit')}
              </span>
            </button>
            <input ref={logoRef} type="file" accept={LOGO_LIMITS.types.join(',')} className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="settings-logo-input" onChange={onLogoFile} />
          </div>
          <div className="min-w-0 flex-1">{text('name', t('company.name'), { maxLength: 80, testId: 'settings-company-name', placeholder: t('company.name.ph') })}</div>
        </div>
        <TextField
          label={t(`company.taxId.${regionCode}`)}
          value={form.taxId}
          onChange={set('taxId')}
          testId="settings-company-tax"
          maxLength={20}
          optional={t('common.optional')}
          sanitize={sanitizeTaxId}
          placeholder={t(`company.taxId.ph.${regionCode}`)}
        />
        {text('address', t('profile.address'), { maxLength: 100, testId: 'settings-company-address', optional: t('common.optional'), placeholder: t('profile.address.ph') })}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {text('city', t('company.city'), { testId: 'settings-company-city', optional: t('common.optional'), placeholder: t('company.city.ph') })}
          <div>
            <TextField label={t('company.email')} value={form.email} onChange={set('email')} testId="settings-company-email" maxLength={120} optional={t('common.optional')} sanitize={sanitizeEmailInput} placeholder="name@company.com" />
            {emailError && (
              <p role="alert" className="mt-1.5 text-sm font-medium text-red-400" data-testid="settings-email-error">
                {t('company.emailInvalid')}
              </p>
            )}
          </div>
        </div>
        <TextField label={t('company.phone')} value={form.phone} onChange={set('phone')} testId="settings-company-phone" type="tel" inputMode="tel" maxLength={32} optional={t('common.optional')} sanitize={sanitizePhone} placeholder="+56 9 1234 5678" />
      </section>

      <section className="space-y-4" data-testid="settings-form-professional">
        <p className="text-sm font-medium text-neutral-400">{t('setup.pro')}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {text('proName', t('profile.pro.firstName'), { testId: 'settings-pro-name', placeholder: t('setup.pro.namePh') })}
          {text('proLastName', t('profile.pro.lastName'), { testId: 'settings-pro-lastname' })}
        </div>
        {text('proTitle', t('profile.pro.title'), { testId: 'settings-pro-title', optional: t('common.optional'), placeholder: t('profile.pro.titlePh') })}
        <TextField
          label={t('setup.pro.taxId', { label: t(`company.taxId.${regionCode}`) })}
          value={form.proTaxId}
          onChange={set('proTaxId')}
          testId="settings-pro-id"
          maxLength={20}
          optional={t('common.optional')}
          sanitize={sanitizeTaxId}
          placeholder={t(`company.taxId.ph.${regionCode}`)}
        />
        {text('proLicense', t('profile.pro.license'), { maxLength: 40, testId: 'settings-pro-license', optional: t('common.optional'), placeholder: t('profile.pro.licensePh') })}
        <ProSignature ref={sigRef} value={current.company.signature} />
      </section>

      {error && (
        <p role="alert" className="text-sm font-medium text-red-400" data-testid="settings-profile-error">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button variant="ghost" onClick={cancelEdit} className="flex-1" data-testid="settings-profile-cancel">
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy} className="flex-1" data-testid="settings-profile-save">
          {t('company.save')}
        </Button>
      </div>
    </form>
  );
}
