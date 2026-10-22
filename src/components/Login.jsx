import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { googleConfigured, localUser } from '../lib/auth.js';
import { sanitizeText } from '../lib/sanitize.js';
import { Button, Logo, TextField } from './ui.jsx';
import GoogleButton from './GoogleButton.jsx';

/**
 * Main access screen. Google sign-in (VITE_GOOGLE_CLIENT_ID) comes first when it is configured; the LOCAL
 * PROFILE (name optional, nothing leaves the device) is always available below it, so the app never
 * depends on an OAuth client or on being online. Any successful sign-in calls `onLogin(user)`.
 */
export default function Login({ onLogin }) {
  const { t } = useI18n();
  const [name, setName] = useState('');

  const enter = (e) => {
    e.preventDefault();
    onLogin(localUser(name));
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-8 text-center">
      <Logo size={96} className="mx-auto mb-5" />
      <h1 className="text-3xl font-extrabold">{t('app.name')}</h1>
      <p className="mt-1 text-neutral-300">{t('app.tagline')}</p>

      {googleConfigured && (
        <section className="mt-7 rounded-2xl border border-white/10 bg-black p-4" data-testid="login-google-card">
          <GoogleButton onUser={onLogin} />
          <p className="mt-3 text-center text-xs text-neutral-400">{t('login.google.note')}</p>
        </section>
      )}

      <form onSubmit={enter} className={`card text-left ${googleConfigured ? 'mt-4' : 'mt-7'}`} data-testid="login-local">
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
      </form>
    </main>
  );
}
