import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { GOOGLE_CLIENT_ID, googleConfigured, loadGsi, userFromCredential, localUser } from '../lib/auth.js';
import { sanitizeText } from '../lib/sanitize.js';
import { Button, Logo, TextField } from './ui.jsx';

/**
 * Entry screen. The default path is a LOCAL PROFILE (name optional, nothing leaves the device), so the
 * app never depends on an OAuth client being configured. Google sign-in is offered only when
 * VITE_GOOGLE_CLIENT_ID is set.
 */
export default function Login({ onLogin }) {
  const { t } = useI18n();
  const btnRef = useRef(null);
  const [name, setName] = useState('');
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
      .catch(() => {
        /* offline / blocked: the local profile below keeps working, so stay silent */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enter = (e) => {
    e.preventDefault();
    onLogin(localUser(name));
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-8 text-center">
      <Logo size={96} className="mx-auto mb-5" />
      <h1 className="text-3xl font-extrabold">{t('app.name')}</h1>
      <p className="mt-1 text-neutral-300">{t('app.tagline')}</p>

      <form onSubmit={enter} className="card mt-7 text-left">
        <h2 className="text-xl font-bold">{t('login.local.title')}</h2>
        <p className="mb-4 mt-1 text-sm text-neutral-300">{t('login.local.subtitle')}</p>
        <TextField
          label={t('login.local.name')}
          optional={t('common.optional')}
          placeholder={t('login.local.namePh')}
          maxLength={60}
          value={name}
          sanitize={(v) => sanitizeText(v, 60)}
          onChange={setName}
        />
        <Button type="submit" className="mt-4 w-full">
          {t('login.local.enter')}
        </Button>
        <p className="mt-2 text-xs text-neutral-400">{t('login.local.note')}</p>

        {googleConfigured && (
          <>
            <p className="my-4 text-center text-sm text-neutral-400">— {t('login.or')} —</p>
            <div ref={btnRef} className="flex min-h-[44px] justify-center" />
          </>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm font-semibold text-red-400">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
