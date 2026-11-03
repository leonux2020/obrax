import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { GOOGLE_CLIENT_ID, googleConfigured, loadGsi, userFromCredential } from '../lib/auth.js';
import { startSignInRedirect } from '../lib/oauthCallback.js';
import { isStandalone } from '../pwa/installPrompt.js';

/**
 * Official "Sign in with Google" button (Google Identity Services), rendered only when
 * VITE_GOOGLE_CLIENT_ID is a valid client id. On success it hands a validated user object to `onUser`;
 * it never throws and never blocks the screen: if Google cannot load (offline, blocked) a short message
 * is shown and the rest of the screen (local profile) keeps working.
 */
export default function GoogleButton({ onUser, clientId = GOOGLE_CLIENT_ID, enabled = googleConfigured, text = 'continue_with', redirect = isStandalone() }) {
  const { t } = useI18n();
  const host = useRef(null);
  const onUserRef = useRef(onUser);
  onUserRef.current = onUser;
  const [status, setStatus] = useState('loading'); // loading | ready | offline | failed

  useEffect(() => {
    if (!enabled || redirect) return undefined; // installed app: no pop-up button (see below)
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
  }, [enabled, redirect, clientId, text]);

  if (!enabled) return null;
  if (redirect) {
    // INSTALLED APP: Google's pop-up opens blank in a PWA and never comes back. The sign-in is a full-page trip to Google and back (oauthCallback),
    // so the screen can never be left white; local data stays untouched on the device while the browser is away.
    return (
      <div data-testid="google-login" data-mode="redirect" className="flex flex-col items-center gap-2">
        <button
          type="button"
          data-testid="google-redirect"
          onClick={() => startSignInRedirect({ clientId })}
          className="flex min-h-[44px] w-[280px] max-w-full items-center justify-center gap-2 rounded-full border border-white/20 bg-black px-4 text-sm font-medium text-neutral-200 active:border-white/50"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.4Z" />
            <path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21.4 7.6 24 12 24Z" />
            <path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.7l3.8-3.1Z" />
            <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.5 11.5 0 0 0 12 0C7.6 0 3.7 2.6 1.8 6.4l3.8 3c.9-2.7 3.4-4.6 6.4-4.6Z" />
          </svg>
          {t('login.google.redirect')}
        </button>
      </div>
    );
  }
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
