import { createContext, useContext } from 'react';

/**
 * The state of the invisible backup, for the passive cloud badge of the headers. App provides it (no prop drilling through every screen):
 *   { enabled, status, reason, pullError, dirty, at, held }   (the same fields as createDriveSync().getState(), plus `enabled`)
 * Without a provider (tests of single screens) the badge simply does not exist.
 */
export const BackupStatusContext = createContext(null);
export const useBackupStatus = () => useContext(BackupStatusContext);

/**
 * 'synced' (everything is in Drive) | 'syncing' (a change is on its way up) | 'pending' (it could not go up yet: offline / needs Google / error)
 * | null (nothing to say: backup is off, held for a restore, or no copy was ever made).
 */
/** True while the daemon is actually working (uploading or downloading): the cloud spins. Waiting for the debounce is not "working". */
export const backupBadgeBusy = (s) => Boolean(s?.enabled && !s.held && (s.status === 'syncing' || s.pulling));

export function backupBadgeState(s) {
  if (!s || !s.enabled || s.held) return null;
  if (s.status === 'syncing' || s.pulling || (s.dirty && s.status !== 'pending' && !s.pullError)) return 'syncing';
  if (s.status === 'pending' || s.pullError) return 'pending'; // an upload that waits OR a download / merge that could not run: never silent
  if (s.status === 'synced' || Number(s.at) > 0) return 'synced';
  return null;
}

/** Why the cloud waits: the upload's reason, else the failed pull's. 'offline' | 'auth' | 'quota' | 'error' */
export const backupBadgeReason = (s) => (s?.status === 'pending' && s.reason ? s.reason : s?.pullError || s?.reason || 'error');
/** Amber = it will fix itself or needs a tap (no signal, Google asks again); red = something is really wrong (Drive refused, quota, unknown error). */
export const backupBadgeTone = (reason) => (reason === 'offline' || reason === 'auth' ? 'amber' : 'red');
