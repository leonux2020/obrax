import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { sanitizeText, sanitizeTaxId } from '../lib/sanitize.js';
import { Button, TextField } from './ui.jsx';
import LogoField from './LogoField.jsx';

/**
 * First-run welcome (shown while there is no saved company profile). It asks for the company name,
 * tax ID and a light logo. The actions live in a bar fixed to the bottom of the screen (one-hand reach):
 * a highlighted primary button and a discreet text button underneath.
 *
 * "Protect my data with Google Drive" only saves the profile locally for now: the real cloud backup
 * arrives in Phase 4 (the hint under the button says so, so nothing is promised that does not happen).
 */
export default function WelcomeOnboarding({ onSave, onSkip }) {
  const { t, region } = useI18n();
  const [form, setForm] = useState({ name: '', taxId: '' });
  const [logo, setLogo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError('');
  };

  const protect = async () => {
    if (busy) return;
    if (!form.name.trim() && !logo) return setError(t('welcome.required'));
    setBusy(true);
    try {
      await onSave({ ...form, logo }); // App closes the welcome and lands on the dashboard
    } catch {
      setError(t('welcome.err.store'));
      setBusy(false);
    }
    return undefined;
  };

  return (
    <>
      <main className="mx-auto w-full max-w-lg px-4 pb-72 pt-6" aria-labelledby="welcome-title" data-testid="welcome">
        <h1 id="welcome-title" className="text-3xl font-extrabold leading-tight">
          {t('welcome.title')}
        </h1>
        <p className="mb-6 mt-2 text-neutral-300">{t('welcome.subtitle')}</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            protect();
          }}
          className="card space-y-4"
        >
          <LogoField value={logo} onChange={(v) => { setLogo(v); setError(''); }} onBusy={setBusy} />
          <TextField label={t('company.name')} value={form.name} onChange={set('name')} sanitize={(v) => sanitizeText(v, 80)} placeholder={t('company.name.ph')} />
          <TextField label={t(`company.taxId.${region.code}`)} value={form.taxId} onChange={set('taxId')} maxLength={20} sanitize={sanitizeTaxId} placeholder={t(`company.taxId.ph.${region.code}`)} />
          <p className="text-xs text-neutral-400">{t('company.snapshot')}</p>
        </form>
      </main>

      <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-lg px-4 pt-3">
          {error && (
            <p role="alert" className="mb-2 text-sm font-semibold text-red-400" data-testid="welcome-error">
              {error}
            </p>
          )}
          <Button variant="secondary" className="w-full" disabled={busy} onClick={protect} data-testid="welcome-drive">
            {t('welcome.drive')}
          </Button>
          <p className="mt-1.5 text-center text-xs text-neutral-400">{t('welcome.drive.hint')}</p>
          <button
            type="button"
            onClick={onSkip}
            data-testid="welcome-skip"
            className="mt-1 min-h-[48px] w-full text-sm font-semibold text-neutral-400 underline-offset-4 hover:text-white hover:underline"
          >
            {t('welcome.skip')}
          </button>
        </div>
      </div>
    </>
  );
}
