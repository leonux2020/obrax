import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { sanitizeText, sanitizeTaxId, sanitizePhone, sanitizeEmail, sanitizeEmailInput } from '../lib/sanitize.js';
import { EMPTY_COMPANY } from '../lib/draft.js';
import { Button, TextField } from './ui.jsx';
import BottomSheet from './BottomSheet.jsx';
import LogoField from './LogoField.jsx';

/**
 * Global company profile (always editable): name, tax ID, contact data and logo. The logo is compressed
 * on the device (max 256 px) and kept as base64 in IndexedDB. Each NEW project copies these values.
 */
export default function CompanyProfile({ company, logo: initialLogo, onSave, onClose }) {
  const { t, region } = useI18n();
  const [form, setForm] = useState({ ...EMPTY_COMPANY, ...company });
  const [logo, setLogo] = useState(initialLogo || '');
  const [emailError, setEmailError] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key === 'email') setEmailError(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    const email = form.email.trim();
    if (email && !sanitizeEmail(email)) return setEmailError(true);
    setSaveError('');
    try {
      await onSave({ ...form, logo });
    } catch {
      setSaveError(t('company.logo.err.store'));
    }
    return undefined;
  };

  const taxLabel = t(`company.taxId.${region.code}`);

  return (
    <BottomSheet title={t('company.title')} subtitle={t('company.subtitle')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <LogoField value={logo} onChange={setLogo} onBusy={setBusy} externalError={saveError} />

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
