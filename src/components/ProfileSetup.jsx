import { useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { regionName } from '../lib/regions.js';
import { EMPTY_COMPANY } from '../lib/draft.js';
import { connectDrive, saveSetupDraft, takeSetupDraft } from '../lib/oauthCallback.js';
import { SignatureError, exportSignature } from '../lib/signature.js';
import { Button } from './ui.jsx';
import ProfileFields from './ProfileFields.jsx';
import SignaturePad from './SignaturePad.jsx';

/**
 * The ONE configuration screen of the first run (after "Iniciar"):
 *   company form + country / currency (detected silently, shown as a chip) + signature canvas + the Google Drive
 *   request (Google's own OAuth consent: this app never has a field for a password) + "Continuar".
 * Later edits do NOT happen here: they live in Ajustes (see ProfileSheet).
 */
export default function ProfileSetup({ onSave, onChangeRegion = null, requestDrive = connectDrive, returned = null }) {
  const { t, region, lang } = useI18n();
  // `returned`: the answer Google sent back after a full-page redirect ({granted} | {error}); the typed form is restored
  const [form, setForm] = useState(() => ({ ...EMPTY_COMPANY, ...(returned ? takeSetupDraft() : null) }));
  const [logo, setLogo] = useState('');
  const [drive, setDrive] = useState(Boolean(returned?.granted)); // true only once Google confirmed the consent
  const [driveState, setDriveState] = useState(returned ? (returned.granted ? 'ok' : 'denied') : 'idle'); // idle | asking | ok | not_configured | offline | denied
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inked, setInked] = useState(false);
  const pad = useRef(null);

  const connectDrive = async () => {
    if (driveState === 'asking') return;
    setDriveState('asking');
    try {
      saveSetupDraft(form); // kept in case the browser has to leave to Google and come back
      await requestDrive();
      takeSetupDraft(); // no redirect happened: the saved copy is not needed
      setDrive(true);
      setDriveState('ok');
    } catch (err) {
      if (err?.code === 'redirect') return; // the page is going to Google: keep "waiting"
      setDrive(false);
      setDriveState(['not_configured', 'offline', 'denied'].includes(err?.code) ? err.code : 'denied');
    }
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    if (!form.name.trim() && !form.proName.trim() && !logo) return setError(t('setup.required'));
    setBusy(true);
    setError('');
    try {
      let signature = form.signature;
      if (pad.current?.hasInk()) {
        const ink = exportSignature(pad.current.getStrokes());
        signature = { dataUrl: ink.dataUrl, w: ink.w, h: ink.h };
      }
      await onSave({ ...form, signature, logo, drive }); // App stores everything and lands on the dashboard
    } catch (err) {
      setError(t(err instanceof SignatureError ? 'sign.err.store' : 'setup.err.store'));
      setBusy(false);
    }
    return undefined;
  };

  const clearError = () => setError('');

  return (
    <>
      <main className="mx-auto w-full max-w-lg px-4 pb-44 pt-6" aria-labelledby="setup-title" data-testid="setup">
        <h1 id="setup-title" className="mb-4 text-3xl font-extrabold leading-tight">
          {t('setup.title')}
        </h1>
        <form onSubmit={submit} className="space-y-4">
          {/* country + currency: detected from the device, nothing to answer; a tap corrects it */}
          {region && (
            <button
              type="button"
              data-testid="setup-region"
              onClick={onChangeRegion || undefined}
              disabled={!onChangeRegion}
              className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-white/10 px-4 text-left transition enabled:hover:border-brand"
            >
              <span className="text-2xl" aria-hidden="true">
                {region.flag}
              </span>
              <span className="min-w-0 flex-1 truncate font-bold">{regionName(region, lang)}</span>
              <span className="shrink-0 text-sm font-bold text-neutral-300" data-testid="setup-currency">
                {region.currency}
              </span>
              {onChangeRegion && (
                <span aria-hidden="true" className="text-xl text-neutral-400">
                  ›
                </span>
              )}
            </button>
          )}

          <ProfileFields
            showDrive={false}
            form={form}
            setForm={(fn) => {
              setForm(fn);
              clearError();
            }}
            logo={logo}
            setLogo={(v) => {
              setLogo(v);
              clearError();
            }}
            onBusy={setBusy}
            drive={drive}
            setDrive={setDrive}
          />

          <section aria-labelledby="setup-sign" className="card space-y-3">
            <h2 id="setup-sign" className="text-lg font-bold">
              {t('setup.sign')}
            </h2>
            <SignaturePad ref={pad} label={t('sign.pad')} placeholder={t('sign.pad.ph')} onInkChange={(v) => setInked(v)} className="!h-40 sm:!h-44" />
            {inked && (
              <div className="flex justify-end">
                <Button variant="ghost" className="!min-h-[44px] text-sm" onClick={() => pad.current?.clear()} data-testid="setup-sign-clear">
                  {t('sign.clear')}
                </Button>
              </div>
            )}
          </section>

          <section aria-labelledby="setup-drive-title" className="card space-y-3">
            <h2 id="setup-drive-title" className="text-lg font-bold">
              {t('setup.driveTitle')}
            </h2>
            <Button
              variant={driveState === 'ok' ? 'ghost' : 'secondary'}
              className="w-full"
              onClick={connectDrive}
              disabled={driveState === 'asking'}
              data-testid="setup-drive"
              aria-pressed={driveState === 'ok'}
            >
              {driveState === 'ok' ? `✓ ${t('setup.drive.ok')}` : driveState === 'asking' ? t('setup.drive.asking') : t('setup.drive.connect')}
            </Button>
            {['not_configured', 'offline', 'denied'].includes(driveState) && (
              <p role="status" data-testid="setup-drive-note" data-code={driveState} className="text-sm text-neutral-300">
                {t(`setup.drive.err.${driveState}`)}
              </p>
            )}
          </section>
        </form>
      </main>

      <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-lg space-y-2 px-4 pt-3">
          {error && (
            <p role="alert" className="text-sm font-semibold text-red-400" data-testid="setup-error">
              {error}
            </p>
          )}
          <Button className="w-full" disabled={busy} onClick={submit} data-testid="setup-save">
            {t('setup.continue')}
          </Button>
        </div>
      </div>
    </>
  );
}
