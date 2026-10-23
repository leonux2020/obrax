// A tiny in-memory imitation of the parts of the Google Drive v3 REST API the CUBRAX backup uses
// (list / create folder / multipart create / media update / media download). It enforces the bearer token.
export function createFakeDrive({ token = 'tok-valid-123456' } = {}) {
  const files = new Map(); // id -> { id, name, mimeType, parents, body, modifiedTime }
  const calls = [];
  let n = 0;
  let clock = 1_000;
  const state = { offline: false, failNext: 0, status: 0 };
  const res = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url: String(url), body: init.body });
    if (state.offline) throw new TypeError('Failed to fetch');
    if (state.failNext > 0) {
      state.failNext -= 1;
      return res({ error: 'x' }, state.status || 500);
    }
    if ((init.headers?.Authorization || '') !== `Bearer ${token}`) return res({ error: 'unauthorized' }, 401);
    const u = new URL(url);
    const mediaUpload = u.pathname.startsWith('/upload/drive/v3/files');
    const id = u.pathname.split('/').pop();

    if (method === 'GET' && u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q') || '';
      const name = /name='([^']+)'/.exec(q)?.[1];
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const isFolder = q.includes('google-apps.folder');
      const out = [...files.values()]
        .filter((f) => (!name || f.name === name) && (!parent || f.parents.includes(parent)) && (isFolder ? f.mimeType.includes('folder') : !f.mimeType.includes('folder')))
        .sort((a, b) => b.modifiedTime - a.modifiedTime)
        .map(({ id: fid, name: nm, modifiedTime }) => ({ id: fid, name: nm, modifiedTime: new Date(modifiedTime).toISOString() }));
      return res({ files: out });
    }
    if (method === 'POST' && u.pathname === '/drive/v3/files') {
      const meta = JSON.parse(init.body);
      n += 1;
      const f = { id: `fld${n}xxxxxx`, name: meta.name, mimeType: meta.mimeType, parents: [], body: '', modifiedTime: (clock += 1) };
      files.set(f.id, f);
      return res({ id: f.id });
    }
    if (method === 'POST' && mediaUpload && u.searchParams.get('uploadType') === 'multipart') {
      const parts = String(init.body).split(/--cubrax[a-z0-9]+/).filter((p) => p.includes('Content-Type'));
      const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].replace(/\r\n$/, ''));
      const body = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
      if (!meta.parents?.every((pid) => files.has(pid))) return res({ error: 'parent not found' }, 404);
      n += 1;
      const f = { id: `fil${n}xxxxxx`, name: meta.name, mimeType: meta.mimeType, parents: meta.parents, body, modifiedTime: (clock += 1) };
      files.set(f.id, f);
      return res({ id: f.id });
    }
    if (method === 'PATCH' && mediaUpload) {
      const f = files.get(id);
      if (!f) return res({ error: 'not found' }, 404);
      f.body = String(init.body);
      f.modifiedTime = clock += 1;
      return res({ id: f.id });
    }
    if (method === 'GET' && u.searchParams.get('alt') === 'media') {
      const f = files.get(id);
      return f ? res(f.body) : res({ error: 'not found' }, 404);
    }
    return res({ error: 'unhandled' }, 400);
  };

  return {
    token,
    files,
    calls,
    state,
    fetchImpl,
    backupFiles: () => [...files.values()].filter((f) => !f.mimeType.includes('folder')),
    folders: () => [...files.values()].filter((f) => f.mimeType.includes('folder')),
  };
}
