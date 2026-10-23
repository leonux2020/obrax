// Sign out = deep clean. Everything this app keeps on the device is erased so the next entry starts from zero:
//   - localStorage + sessionStorage (user, settings, company/profile, drafts, PRO simulation, OAuth state/tokens)
//   - every IndexedDB database (projects, photos, company logo, signatures)
//   - the Google "auto sign-in" memory of this page
// Each step is isolated: one failing never stops the others. The caller then reloads the page (see App.jsx) so no
// in-memory state can write anything back.

import { DB_NAME } from './db.js';
import { clearDriveToken } from './driveToken.js';

const attempt = async (fn) => {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
};

/** Delete one IndexedDB database. A blocked delete (another tab) resolves after `waitMs` instead of hanging. */
function deleteDatabase(factory, name, waitMs = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, waitMs);
    let req;
    try {
      req = factory.deleteDatabase(name);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
      return;
    }
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve();
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error);
    };
    // onblocked: keep waiting; open connections close themselves on `versionchange` (see db.js)
  });
}

/**
 * Erase all local user data.
 * @returns {Promise<{storage: boolean, indexedDb: boolean, google: boolean}>} which steps succeeded
 */
export async function wipeLocalData({
  local = typeof localStorage === 'undefined' ? null : localStorage,
  session = typeof sessionStorage === 'undefined' ? null : sessionStorage,
  factory = typeof indexedDB === 'undefined' ? null : indexedDB,
  google = typeof window === 'undefined' ? null : window.google,
} = {}) {
  const storage = await attempt(() => {
    clearDriveToken({ storage: session }); // the in-memory copy of the Drive token too
    local?.clear();
    session?.clear();
  });
  const indexedDb = await attempt(async () => {
    if (!factory) return;
    let names = [DB_NAME];
    if (typeof factory.databases === 'function') {
      const listed = await factory.databases();
      names = [...new Set([DB_NAME, ...listed.map((d) => d.name).filter(Boolean)])];
    }
    await Promise.all(names.map((n) => deleteDatabase(factory, n)));
  });
  const goog = await attempt(() => google?.accounts?.id?.disableAutoSelect?.());
  return { storage, indexedDb, google: goog };
}
