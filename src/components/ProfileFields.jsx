import { useI18n } from '../lib/i18n.jsx';
import { sanitizeText, sanitizeTaxId, sanitizePhone, sanitizeEmailInput } from '../lib/sanitize.js';
import { Switch, TextField } from './ui.jsx';
import LogoField from './LogoField.jsx';

/**
 * Fields of the account profile, shared by the first-run setup and the edit sheet in Ajustes:
 * company (logo, name, tax ID; contact data when `extended`), professional (name + personal ID) and the
 * Google Drive backup switch. Fully controlled: the parent owns `form`, `logo` and `drive`.
 */
export default function ProfileFields({ form, setForm, logo, setLogo, onBusy, drive, setDrive, extended = false, emailError = false, logoError = '' }) {
  const { t, region } = useI18n();
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const idLabel = t(`company.taxId.${region.code}`);
  const idPh = t(`company.taxId.ph.${region.code}`);

  return (
    <div className="space-y-4">
      <section aria-labelledby="pf-company" className="card space-y-4">
        <h2 id="pf-company" className="text-lg font-bold">
          {t('setup.company')}
        </h2>
        <LogoField value={logo} onChange={setLogo} onBusy={onBusy} externalError={logoError} />
        <TextField label={t('company.name')} value={form.name} onChange={set('name')} sanitize={(v) => sanitizeText(v, 80)} placeholder={t('company.name.ph')} />
        <TextField label={idLabel} value={form.taxId} onChange={set('taxId')} maxLength={20} sanitize={sanitizeTaxId} placeholder={idPh} />
        {extended && (
          <>
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
          </>
        )}
      </section>

      <section aria-labelledby="pf-pro" className="card space-y-4">
        <h2 id="pf-pro" className="text-lg font-bold">
          {t('setup.pro')}
        </h2>
        <TextField label={t('setup.pro.name')} value={form.proName} onChange={set('proName')} maxLength={60} sanitize={(v) => sanitizeText(v, 60)} placeholder={t('setup.pro.namePh')} />
        <TextField label={t('setup.pro.taxId', { label: idLabel })} value={form.proTaxId} onChange={set('proTaxId')} maxLength={20} sanitize={sanitizeTaxId} placeholder={idPh} />
      </section>

      <Switch checked={drive} onChange={setDrive} label={t('setup.drive')} description={t('setup.drive.desc')} data-testid="setup-drive" />
      <p className="text-xs text-neutral-400">{t('company.snapshot')}</p>
    </div>
  );
}
