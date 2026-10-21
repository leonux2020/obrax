import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import {
  GOOGLE_CLIENT_ID,
  googleConfigured,
  loadGsi,
  userFromCredential,
  demoUser,
  guestUser,
} from '../lib/auth.js';
import { Button, Logo } from './ui.jsx';

const GoogleG = () => (
  <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
    <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

export default function Login({ onLogin }) {
  const { t } = useI18n();
  const btnRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!googleConfigured) return undefined;
    let cancelled = false;
    loadGsi()
      .then((google) => {
        if (cancelled || !btnRef.current) return;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (resp) => {
            try {
              onLogin(userFromCredential(resp.credential));
            } catch {
              setError(t('login.failed'));
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        google.accounts.id.renderButton(btnRef.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: 280,
        });
      })
      .catch(() => !cancelled && setError(t('login.offline')));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-8 text-center">
      <Logo size={112} className="mx-auto mb-6" />
      <h1 className="text-3xl font-extrabold">{t('app.name')}</h1>
      <p className="mt-1 text-neutral-300">{t('app.tagline')}</p>

      <div className="card mt-8 text-left">
        <h2 className="text-xl font-bold">{t('login.title')}</h2>
        <p className="mb-5 mt-1 text-sm text-neutral-300">{t('login.subtitle')}</p>

        {googleConfigured ? (
          <div ref={btnRef} className="flex min-h-[44px] justify-center" />
        ) : (
          <>
            <Button variant="ghost" className="w-full !bg-white !text-black hover:!bg-neutral-200" onClick={() => onLogin(demoUser())}>
              <GoogleG />
              {t('login.googleDemo')}
            </Button>
            <p className="mt-2 text-xs text-neutral-400">{t('login.demoNote')}</p>
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-red-400">
            {error}
          </p>
        )}

        <Button variant="secondary" className="mt-4 w-full" onClick={() => onLogin(guestUser())}>
          {t('login.guest')}
        </Button>
      </div>
    </main>
  );
}
