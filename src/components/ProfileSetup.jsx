import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { EMPTY_COMPANY } from '../lib/draft.js';
import { Button } from './ui.jsx';
import ProfileFields from './ProfileFields.jsx';

/**
 * First-run configuration (after the splash): company (name, ID, logo), professional (name, personal ID)
 * and the Google Drive switch. "Guardar y Entrar" is fixed to the bottom of the screen (thumb reach).
 * Later edits do NOT happen here: they live in Ajustes (see ProfileSheet).
 */
export default function ProfileSetup({ onSave, onBack }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ ...EMPTY_COMPANY });
  const [logo, setLogo] = useState('');
  const [drive, setDrive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    if (!form.name.trim() && !form.proName.trim() && !logo) return setError(t('setup.required'));
    setBusy(true);
    setError('');
    try {
      await onSave({ ...form, logo, drive }); // App stores everything and lands on the dashboard
    } catch {
      setError(t('setup.err.store'));
      setBusy(false);
    }
    return undefined;
  };

  return (
    <>
      <main className="mx-auto w-full max-w-lg px-4 pb-40 pt-6" aria-labelledby="setup-title" data-testid="setup">
        <h1 id="setup-title" className="text-3xl font-extrabold leading-tight">
          {t('setup.title')}
        </h1>
        <p className="mb-5 mt-2 text-neutral-300">{t('setup.subtitle')}</p>
        <form onSubmit={submit}>
          <ProfileFields
            form={form}
            setForm={(fn) => {
              setForm(fn);
              setError('');
            }}
            logo={logo}
            setLogo={(v) => {
              setLogo(v);
              setError('');
            }}
            onBusy={setBusy}
            drive={drive}
            setDrive={setDrive}
          />
        </form>
      </main>

      <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-lg space-y-2 px-4 pt-3">
          {error && (
            <p role="alert" className="text-sm font-semibold text-red-400" data-testid="setup-error">
              {error}
            </p>
          )}
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <Button variant="ghost" onClick={onBack} aria-label={t('common.back')} className="px-5">
              ←
            </Button>
            <Button className="w-full" disabled={busy} onClick={submit} data-testid="setup-save">
              {t('setup.save')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
