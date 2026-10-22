import { useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { LOGO_LIMITS, compressLogo } from '../lib/logo.js';
import { PhotoError } from '../lib/photos.js';
import { Button } from './ui.jsx';

/**
 * Light logo picker shared by the company profile and the welcome screen. The chosen image is compressed
 * on the device (max 256 px, transparency kept) and handed back as a base64 data URL.
 */
export default function LogoField({ value, onChange, onBusy, externalError = '' }) {
  const { t } = useI18n();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setWorking = (v) => {
    setBusy(v);
    onBusy?.(v);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setWorking(true);
    setError('');
    try {
      onChange(await compressLogo(file));
    } catch (err) {
      setError(t(`company.logo.err.${err instanceof PhotoError ? err.code : 'decode'}`));
    } finally {
      setWorking(false);
    }
  };

  const shownError = error || externalError;

  return (
    <div>
      <p className="label">{t('company.logo')}</p>
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white p-1.5" data-testid="logo-preview">
          {value ? <img src={value} alt={t('company.logo')} className="max-h-full max-w-full object-contain" decoding="async" /> : <span className="text-xs font-bold text-black/50">LOGO</span>}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Button variant="secondary" className="!min-h-[48px] text-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {t(value ? 'company.logo.replace' : 'company.logo.add')}
          </Button>
          {value && (
            <Button variant="ghost" className="!min-h-[44px] text-sm" onClick={() => onChange('')}>
              {t('company.logo.remove')}
            </Button>
          )}
        </div>
      </div>
      <input ref={fileRef} type="file" accept={LOGO_LIMITS.types.join(',')} className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="logo-input" onChange={onFile} />
      <p className="mt-2 text-xs text-neutral-400">{t('company.logo.hint')}</p>
      {shownError && (
        <p role="alert" className="mt-1.5 text-sm font-semibold text-red-400">
          {shownError}
        </p>
      )}
    </div>
  );
}
