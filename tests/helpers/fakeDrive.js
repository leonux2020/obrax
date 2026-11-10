// A tiny in-memory imitation of the parts of the Google Drive v3 REST API the CUBRAX backup uses
// (list / create folder / multipart create / media update / media download / get parents / move) and of the Google Sheets v4 API the live
// rendición Spreadsheets use (create, read the tabs, addSheet / updateSheetProperties, values:batchUpdate / batchClear). It enforces the bearer token.
// Like the real Sheets API: a spreadsheet is created in the ROOT of the Drive; a write outside the grid of a tab is refused (400); with
// `state.noSheetsScope` the token lacks the spreadsheets scope (403 ACCESS_TOKEN_SCOPE_INSUFFICIENT).
export function createFakeDrive({ token: initialToken = 'tok-valid-123456' } = {}) {
  let token = initialToken; // the token Drive accepts; rotate() = the old one expired
  const files = new Map(); // id -> { id, name, mimeType, parents, body, modifiedTime }
  const calls = [];
  let n = 0;
  let clock = 1_000;
  const state = { offline: false, failNext: 0, status: 0, noSheetsScope: false, failNextSheets: 0 };
  const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
  const grids = new Map(); // spreadsheet id -> [{ sheetId, title, rowCount, columnCount, rows: [][] }]
  const res = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

  const parseRange = (range) => {
    const m = /^'((?:[^']|'')*)'(?:!A(\d+))?$/.exec(String(range));
    return m ? { title: m[1].replace(/''/g, "'"), row: m[2] ? Number(m[2]) : 1 } : null;
  };
  const tabOf = (id, title) => (grids.get(id) || []).find((t) => t.title === title);

  const sheetsApi = (method, u, init) => {
    if (state.noSheetsScope) return res({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Request had insufficient authentication scopes.', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }, 403);
    if (state.failNextSheets > 0) {
      state.failNextSheets -= 1;
      return res({ error: 'x' }, state.status || 500);
    }
    const body = init.body ? JSON.parse(init.body) : {};
    if (method === 'POST' && u.pathname === '/v4/spreadsheets') {
      n += 1;
      const f = { id: `sht${n}xxxxxxxxxxxxxxxx`, name: body.properties?.title || 'Untitled spreadsheet', mimeType: SHEET_MIME, parents: ['root'], body: '', modifiedTime: (clock += 1) };
      files.set(f.id, f);
      const tabs = (body.sheets?.length ? body.sheets : [{ properties: { title: 'Sheet1' } }]).map((sh, i) => ({
        sheetId: i + 1,
        title: sh.properties?.title || `Sheet${i + 1}`,
        rowCount: sh.properties?.gridProperties?.rowCount || 1000,
        columnCount: sh.properties?.gridProperties?.columnCount || 26,
        rows: [],
      }));
      grids.set(f.id, tabs);
      return res({ spreadsheetId: f.id });
    }
    const m = /^\/v4\/spreadsheets\/([^/:]+)(\/values)?(?::(\w+))?$/.exec(u.pathname);
    const f = m && files.get(m[1]);
    if (!f || f.mimeType !== SHEET_MIME) return res({ error: 'not found' }, 404);
    const tabs = grids.get(f.id);
    if (method === 'GET' && !m[2] && !m[3]) return res({ sheets: tabs.map((t) => ({ properties: { sheetId: t.sheetId, title: t.title, gridProperties: { rowCount: t.rowCount, columnCount: t.columnCount } } })) });
    if (method === 'POST' && !m[2] && m[3] === 'batchUpdate') {
      for (const r of body.requests || []) {
        if (r.addSheet) {
          if (tabOf(f.id, r.addSheet.properties.title)) return res({ error: 'duplicate tab' }, 400);
          const g = r.addSheet.properties.gridProperties || {};
          tabs.push({ sheetId: Math.max(0, ...tabs.map((t) => t.sheetId)) + 1, title: r.addSheet.properties.title, rowCount: g.rowCount || 1000, columnCount: g.columnCount || 26, rows: [] });
        } else if (r.updateSheetProperties) {
          const t = tabs.find((x) => x.sheetId === r.updateSheetProperties.properties.sheetId);
          if (!t) return res({ error: 'no such sheet' }, 400);
          Object.assign(t, r.updateSheetProperties.properties.gridProperties);
        } else return res({ error: 'unsupported request' }, 400);
      }
      return res({ spreadsheetId: f.id });
    }
    if (method === 'POST' && m[2] && m[3] === 'batchClear') {
      for (const range of body.ranges || []) {
        const r = parseRange(range);
        const t = r && tabOf(f.id, r.title);
        if (!t) return res({ error: 'bad range' }, 400);
        t.rows = [];
      }
      return res({ spreadsheetId: f.id });
    }
    if (method === 'POST' && m[2] && m[3] === 'batchUpdate') {
      if (body.valueInputOption !== 'RAW') return res({ error: 'values must be RAW' }, 400);
      for (const d of body.data || []) {
        const r = parseRange(d.range);
        const t = r && tabOf(f.id, r.title);
        if (!t) return res({ error: 'bad range' }, 400);
        const cols = d.values.reduce((x, row) => Math.max(x, row.length), 0);
        if (r.row - 1 + d.values.length > t.rowCount || cols > t.columnCount) return res({ error: { message: `Range exceeds grid limits. Max rows: ${t.rowCount}, max columns: ${t.columnCount}` } }, 400);
        d.values.forEach((row, i) => {
          t.rows[r.row - 1 + i] = row;
        });
      }
      f.modifiedTime = clock += 1;
      return res({ spreadsheetId: f.id });
    }
    return res({ error: 'unhandled' }, 400);
  };

  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    // binary bodies (Uint8Array) are kept byte for byte as a latin1 string: `size` is then the real number of bytes
    const raw = init.body;
    const text = raw instanceof Uint8Array ? new TextDecoder('latin1').decode(raw) : raw;
    init = { ...init, body: text };
    calls.push({ method, url: String(url), body: text });
    if (state.offline) throw new TypeError('Failed to fetch');
    if (state.failNext > 0) {
      state.failNext -= 1;
      return res({ error: 'x' }, state.status || 500);
    }
    if ((init.headers?.Authorization || '') !== `Bearer ${token}`) return res({ error: 'unauthorized' }, 401);
    const u = new URL(url);
    if (u.hostname === 'sheets.googleapis.com') return sheetsApi(method, u, init);
    const mediaUpload = u.pathname.startsWith('/upload/drive/v3/files');
    const id = u.pathname.split('/').pop();

    if (method === 'GET' && u.pathname === '/drive/v3/files') {
      const q = u.searchParams.get('q') || '';
      const name = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, '$1');
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const notFolder = q.includes('mimeType!=');
      const isFolder = !notFolder && q.includes('google-apps.folder');
      const onlySheets = q.includes(`mimeType='${SHEET_MIME}'`);
      const out = [...files.values()]
        .filter((f) => !onlySheets || f.mimeType === SHEET_MIME)
        .filter((f) => (!name || f.name === name) && (!parent || f.parents.includes(parent)) && (isFolder ? f.mimeType.includes('folder') : !f.mimeType.includes('folder')))
        .sort((a, b) => b.modifiedTime - a.modifiedTime)
        .map(({ id: fid, name: nm, modifiedTime, body }) => ({ id: fid, name: nm, size: String(String(body ?? '').length), modifiedTime: new Date(modifiedTime).toISOString() }));
      return res({ files: out });
    }
    if (method === 'POST' && u.pathname === '/drive/v3/files') {
      const meta = JSON.parse(init.body);
      n += 1;
      const f = { id: `fld${n}xxxxxx`, name: meta.name, mimeType: meta.mimeType, parents: meta.parents || [], body: '', modifiedTime: (clock += 1) };
      files.set(f.id, f);
      return res({ id: f.id, modifiedTime: new Date(f.modifiedTime).toISOString() });
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
      return res({ id: f.id, modifiedTime: new Date(f.modifiedTime).toISOString() });
    }
    if (method === 'GET' && !mediaUpload && u.pathname.startsWith('/drive/v3/files/') && u.searchParams.get('alt') !== 'media') {
      const f = files.get(id);
      return f ? res({ id: f.id, parents: f.parents }) : res({ error: 'not found' }, 404);
    }
    if (method === 'PATCH' && !mediaUpload && u.pathname.startsWith('/drive/v3/files/')) {
      const f = files.get(id);
      if (!f) return res({ error: 'not found' }, 404);
      const add = (u.searchParams.get('addParents') || '').split(',').filter(Boolean);
      const drop = (u.searchParams.get('removeParents') || '').split(',').filter(Boolean);
      if (!add.every((pid) => files.has(pid) || pid === 'root')) return res({ error: 'parent not found' }, 404);
      f.parents = [...f.parents.filter((pid) => !drop.includes(pid)), ...add.filter((pid) => !f.parents.includes(pid))];
      return res({ id: f.id });
    }
    if (method === 'GET' && u.searchParams.get('alt') === 'media') {
      const f = files.get(id);
      return f ? res(f.body) : res({ error: 'not found' }, 404);
    }
    return res({ error: 'unhandled' }, 400);
  };

  return {
    get token() {
      return token;
    },
    rotate: (next) => {
      token = next;
    },
    files,
    calls,
    state,
    fetchImpl,
    /** A created Spreadsheet: { id, title, parents, tabs: { <tab name>: rows[][] } } (null when there is none by that title). */
    sheet: (title) => {
      const f = [...files.values()].find((x) => x.mimeType === SHEET_MIME && x.name === title);
      return f ? { id: f.id, title: f.name, parents: f.parents, tabs: Object.fromEntries(grids.get(f.id).map((t) => [t.title, t.rows.map((r) => r || [])])), grids: grids.get(f.id) } : null;
    },
    spreadsheets: () => [...files.values()].filter((f) => f.mimeType === SHEET_MIME),
    backupFiles: () => [...files.values()].filter((f) => !f.mimeType.includes('folder')),
    folders: () => [...files.values()].filter((f) => f.mimeType.includes('folder')),
  };
}
