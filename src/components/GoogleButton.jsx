import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { GOOGLE_CLIENT_ID, googleConfigured, loadGsi, userFromCredential } from '../lib/auth.js';

/**
 * Official "Sign in with Google" button (Google Identity Services), rendered only when
 * VITE_GOOGLE_CLIENT_ID is a valid client id. On success it hands a validated user object to `onUser`;
 * it never throws and never blocks the screen: if Google cannot load (offline, blocked) a short message
 * is shown and the rest of the screen (local profile) keeps working.
 */
export default function GoogleButton({ onUser, clientId = GOOGLE_CLIENT_ID, enabled = googleConfigured, text = 'continue_with' }) {
  const { t } = useI18n();
  const host = useRef(null);
  const onUserRef = useRef(onUser);
  onUserRef.current = onUser;
  const [status, setStatus] = useState('loading'); // loading | ready | offline | failed

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    loadGsi()
      .then((google) => {
        if (cancelled || !host.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp) => {
            try {
              onUserRef.current(userFromCredential(resp?.credential, { clientId }));
            } catch {
              setStatus('failed');
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        google.accounts.id.renderButton(host.current, { theme: 'filled_black', size: 'large', shape: 'pill', text, width: 280 });
        setStatus('ready');
      })
      .catch(() => !cancelled && setStatus('offline'));
    return () => {
      cancelled = true;
    };
  }, [enabled, clientId, text]);

  if (!enabled) return null;
  return (
    <div data-testid="google-login" className="flex flex-col items-center gap-2">
      <div ref={host} className="flex min-h-[44px] w-full justify-center" />
      {status === 'loading' && <p className="text-xs text-neutral-400">{t('login.google.loading')}</p>}
      {status === 'offline' && (
        <p role="status" data-testid="google-offline" className="text-center text-sm text-neutral-300">
          {t('login.google.offline')}
        </p>
      )}
      {status === 'failed' && (
        <p role="alert" data-testid="google-error" className="text-center text-sm font-semibold text-red-400">
          {t('login.failed')}
        </p>
      )}
    </div>
  );
}
