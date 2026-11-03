import { createContext, useContext } from 'react';

/**
 * The state of the invisible backup, for the passive cloud badge of the headers. App provides it (no prop drilling through every screen):
 *   { enabled, status, reason, dirty, at, held }   (the same fields as createDriveSync().getState(), plus `enabled`)
 * Without a provider (tests of single screens) the badge simply does not exist.
 */
export const BackupStatusContext = createContext(null);
export const useBackupStatus = () => useContext(BackupStatusContext);

/**
 * 'synced' (everything is in Drive) | 'syncing' (a change is on its way up) | 'pending' (it could not go up yet: offline / needs Google / error)
 * | null (nothing to say: backup is off, held for a restore, or no copy was ever made).
 */
export function backupBadgeState(s) {
  if (!s || !s.enabled || s.held) return null;
  if (s.status === 'syncing' || (s.dirty && s.status !== 'pending')) return 'syncing';
  if (s.status === 'pending') return 'pending';
  if (s.status === 'synced' || Number(s.at) > 0) return 'synced';
  return null;
}
