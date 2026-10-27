// Feature flags (local, no server, no build-time env: the client reads a single env var, the Google client id).
// The project workspace (single-screen SPA) is the default: a new or opened project lands in it and never leaves it.
// The classic project screen + wizard stay in the code only as an emergency fallback: open the app with  ?workspace=0
// to bring them back (remembered on this device) and  ?workspace=1  to return to the workspace.

const KEY = 'cp.flag.workspace';
export const DEFAULT_WORKSPACE = true;

export function workspaceEnabled() {
  try {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('workspace') : null;
    if (q === '1') localStorage.setItem(KEY, '1');
    else if (q === '0') localStorage.setItem(KEY, '0');
    const stored = localStorage.getItem(KEY);
    return stored === null ? DEFAULT_WORKSPACE : stored === '1';
  } catch {
    return DEFAULT_WORKSPACE;
  }
}
