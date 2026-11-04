import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { sanitizeEmail } from '../lib/sanitize.js';
import { EMPTY_COMPANY } from '../lib/draft.js';
import { Button } from './ui.jsx';
import BottomSheet from './BottomSheet.jsx';
import ProfileFields from './ProfileFields.jsx';
import ContractorSignatureSheet from './ContractorSignatureSheet.jsx';

/**
 * Edit company + professional data and the backup switch. It is only reachable from Ajustes: the dashboard,
 * the bottom nav and the report no longer have any shortcut to edit the profile. Each NEW project copies
 * these values (projects already issued keep their own copy).
 */
export default function ProfileSheet({ company, logo: initialLogo, drive: initialDrive, onSave, onClose }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ ...EMPTY_COMPANY, ...company });
  const [logo, setLogo] = useState(initialLogo || '');
  const [drive, setDrive] = useState(initialDrive);
  const [emailError, setEmailError] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false); // the signing canvas replaces this sheet (never nested) and returns here

  const submit = async (e) => {
    e.preventDefault();
    const email = form.email.trim();
    if (email && !sanitizeEmail(email)) return setEmailError(true);
    setSaveError('');
    try {
      await onSave({ ...form, logo, drive });
    } catch {
      setSaveError(t('company.logo.err.store'));
    }
    return undefined;
  };

  if (signing) {
    return (
      <ContractorSignatureSheet
        value={form.signature}
        onSave={(ink) => {
          setForm((f) => ({ ...f, signature: ink }));
          setSigning(false);
        }}
        onClose={() => setSigning(false)}
      />
    );
  }

  return (
    <BottomSheet title={t('profile.title')} subtitle={t('profile.subtitle')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ProfileFields
          extended
          form={form}
          setForm={(fn) => {
            setForm(fn);
            setEmailError(false);
          }}
          logo={logo}
          setLogo={setLogo}
          onBusy={setBusy}
          drive={drive}
          setDrive={setDrive}
          emailError={emailError}
          logoError={saveError}
          onSign={() => setSigning(true)}
        />
        <p className="text-xs text-neutral-400">{t('company.privacy')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button type="submit" disabled={busy} data-testid="profile-save">
            {t('company.save')}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}
