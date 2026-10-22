import { useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { sanitizeText, sanitizeTaxId, sanitizePhone, sanitizeEmail, sanitizeEmailInput } from '../lib/sanitize.js';
import { EMPTY_COMPANY } from '../lib/draft.js';
import { LOGO_LIMITS, compressLogo } from '../lib/logo.js';
import { PhotoError } from '../lib/photos.js';
import { Button, TextField } from './ui.jsx';
import BottomSheet from './BottomSheet.jsx';

/**
 * Global company profile (always editable): name, tax ID, contact data and logo. The logo is compressed
 * on the device (max 256 px) and kept as base64 in IndexedDB. Each NEW project copies these values.
 */
export default function CompanyProfile({ company, logo: initialLogo, onSave, onClose }) {
  const { t, region } = useI18n();
  const [form, setForm] = useState({ ...EMPTY_COMPANY, ...company });
  const [logo, setLogo] = useState(initialLogo || '');
  const [emailError, setEmailError] = useState(false);
  const [logoError, setLogoError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key === 'email') setEmailError(false);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setLogoError('');
    try {
      setLogo(await compressLogo(file));
    } catch (err) {
      setLogoError(t(`company.logo.err.${err instanceof PhotoError ? err.code : 'decode'}`));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const email = form.email.trim();
    if (email && !sanitizeEmail(email)) return setEmailError(true);
    try {
      await onSave({ ...form, logo });
    } catch {
      setLogoError(t('company.logo.err.store'));
    }
    return undefined;
  };

  const taxLabel = t(`company.taxId.${region.code}`);

  return (
    <BottomSheet title={t('company.title')} subtitle={t('company.subtitle')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <p className="label">{t('company.logo')}</p>
          <div className="flex items-center gap-3">
            <div
              className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white p-1.5"
              data-testid="logo-preview"
            >
              {logo ? <img src={logo} alt={t('company.logo')} className="max-h-full max-w-full object-contain" decoding="async" /> : <span className="text-xs font-bold text-black/50">LOGO</span>}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Button variant="secondary" className="!min-h-[48px] text-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                {t(logo ? 'company.logo.replace' : 'company.logo.add')}
              </Button>
              {logo && (
                <Button variant="ghost" className="!min-h-[44px] text-sm" onClick={() => setLogo('')}>
                  {t('company.logo.remove')}
                </Button>
              )}
            </div>
          </div>
          <input ref={fileRef} type="file" accept={LOGO_LIMITS.types.join(',')} className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="logo-input" onChange={onFile} />
          <p className="mt-2 text-xs text-neutral-400">{t('company.logo.hint')}</p>
          {logoError && (
            <p role="alert" className="mt-1.5 text-sm font-semibold text-red-400">
              {logoError}
            </p>
          )}
        </div>

        <TextField label={t('company.name')} value={form.name} onChange={set('name')} sanitize={(v) => sanitizeText(v, 80)} placeholder={t('company.name.ph')} />
        <TextField label={taxLabel} value={form.taxId} onChange={set('taxId')} maxLength={20} sanitize={sanitizeTaxId} placeholder={t(`company.taxId.ph.${region.code}`)} />
        <TextField label={t('company.phone')} value={form.phone} onChange={set('phone')} maxLength={24} sanitize={sanitizePhone} placeholder="+00 000 000 000" />
        <div>
          <TextField label={t('company.email')} value={form.email} onChange={set('email')} maxLength={120} sanitize={sanitizeEmailInput} placeholder="name@company.com" />
          {emailError && (
            <p role="alert" className="mt-1.5 text-sm font-semibold text-red-400">
              {t('company.emailInvalid')}
            </p>
          )}
        </div>
        <TextField label={t('company.city')} value={form.city} onChange={set('city')} maxLength={60} sanitize={(v) => sanitizeText(v, 60)} placeholder={t('company.city.ph')} />

        <p className="text-xs text-neutral-400">{t('company.snapshot')}</p>
        <p className="text-xs text-neutral-400">{t('company.privacy')}</p>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button type="submit" disabled={busy} data-testid="company-save">
            {t('company.save')}
          </Button>
        </div>
        <Button
          variant="danger"
          className="w-full !min-h-[44px] text-sm"
          onClick={() => {
            setForm({ ...EMPTY_COMPANY });
            setLogo('');
            setEmailError(false);
          }}
        >
          {t('company.clear')}
        </Button>
      </form>
    </BottomSheet>
  );
}
