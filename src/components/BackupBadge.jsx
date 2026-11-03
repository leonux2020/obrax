import { useI18n } from '../lib/i18n.jsx';
import { backupBadgeBusy, backupBadgeReason, backupBadgeState, backupBadgeTone, useBackupStatus } from '../lib/backupStatus.jsx';

const Cloud = ({ children, size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M17.5 19H7a5 5 0 1 1 1-9.9A6 6 0 0 1 19.6 11 4 4 0 0 1 17.5 19Z" />
    {children}
  </svg>
);

/**
 * PASSIVE peace-of-mind indicator of the invisible backup: a micro cloud in the header. A green check (text-brand-500) = everything is safe in
 * Drive; a soft pulse = a change is on its way up; an amber slash = it is waiting (no signal / Google wants the user). Never a button, never
 * a toast: it asks nothing from the contractor. Renders nothing when the backup is off or no copy exists yet.
 */
export default function BackupBadge({ size = 18, className = '' }) {
  const { t } = useI18n();
  const status = useBackupStatus();
  const state = backupBadgeState(status);
  const busy = backupBadgeBusy(status); // the daemon is uploading / downloading right now
  if (!state) return null;
  const reason = state === 'pending' ? backupBadgeReason(status) : '';
  const label = state === 'synced' ? t('backup.badge.synced') : state === 'syncing' ? t('backup.badge.syncing') : t(`backup.badge.pending.${reason === 'offline' || reason === 'auth' ? reason : 'error'}`);
  const tone = state === 'synced' ? 'text-brand-500' : state === 'syncing' ? (busy ? 'animate-spin text-neutral-300' : 'animate-pulse text-neutral-400') : backupBadgeTone(reason) === 'amber' ? 'text-amber-500' : 'text-red-500';
  return (
    <span role="img" aria-label={label} title={label} data-testid="backup-badge" data-state={state} data-busy={busy ? 'true' : undefined} data-reason={reason || undefined} className={`pointer-events-none inline-flex shrink-0 items-center justify-center ${tone} ${className}`}>
      <Cloud size={size}>
        {state === 'synced' && <path d="m9.2 14.2 2.1 2.1 3.9-4.1" />}
        {state === 'syncing' && <path d="M12 17v-5m0 0-2 2m2-2 2 2" />}
        {state === 'pending' && <path d="m5 5 14 14" />}
      </Cloud>
    </span>
  );
}
