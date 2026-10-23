import { useI18n } from '../lib/i18n.jsx';
import { Logo } from './ui.jsx';

/** Shown while the backup is read from Drive and written to the device: the Dashboard only appears once it is done. */
export default function RestoreScreen() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center" role="status" aria-live="polite" data-testid="restore-screen">
      <Logo size={88} />
      <span className="h-8 w-8 animate-spin rounded-full border-4 border-white/10 border-t-brand" aria-hidden="true" />
      <h1 className="text-xl font-bold">{t('restore.title')}</h1>
      <p className="text-sm text-neutral-400">{t('restore.sub')}</p>
    </main>
  );
}
