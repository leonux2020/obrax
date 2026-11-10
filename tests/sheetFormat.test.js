// @vitest-environment happy-dom
// The "Zero-Stress" design of the live Google Sheet (sheetFormat.js): a batchUpdate with the exact Sheets v4 structure, sent right AFTER the data,
// and silent by contract: it can never fail the export.
import { describe, it, expect, vi } from 'vitest';
import { createDriveClient } from '../src/lib/drive.js';
import { WIDTH, buildFormatPayloads, currencyFormat, formatSpreadsheet, layoutRequests, moneyRequests, widthPx } from '../src/lib/sheetFormat.js';
import { toValueSheets } from '../src/lib/sheetData.js';
import { buildRenditionData, buildRenditionSheets } from '../src/lib/rendition.js';
import { newProject } from '../src/lib/projects.js';
import { normalizeAdvances, normalizeExpenses, normalizeLogbook, normalizePayments } from '../src/lib/ledger.js';
import { makeI18n } from '../src/lib/i18n.jsx';
import { createFakeDrive } from './helpers/fakeDrive.js';

const ID = 'sht1xxxxxxxxxxxxxxxx';
const URL_OF = (id) => `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`;
const make = (drive, opts = {}) => createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl, ...opts });
const folderOf = (client) => client.ensureFolderPath(['Proyectos', 'Casa']);
const path = (c) => `${c.method} ${new URL(c.url).pathname}`;

describe('1. the payload has the exact structure the Sheets v4 API asks for', () => {
  const meta = [{ sheetId: 7, widths: [14, 36, 14, 14], moneyCols: [2, 3] }];

  it('A. freeze: updateSheetProperties -> gridProperties.frozenRowCount 1, with its field mask', () => {
    const [freeze] = layoutRequests(meta[0]);
    expect(freeze).toEqual({ updateSheetProperties: { properties: { sheetId: 7, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } });
  });

  it('B. headers: repeatCell on row 1 (index 0) with bold + CENTER and the exact fields mask', () => {
    const header = layoutRequests(meta[0])[1];
    expect(header).toEqual({
      repeatCell: {
        range: { sheetId: 7, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
      },
    });
  });

  it('C. widths: updateDimensionProperties COLUMNS with pixelSize, startIndex inclusive / endIndex exclusive; equal neighbours share one request', () => {
    const dims = layoutRequests(meta[0]).filter((r) => r.updateDimensionProperties);
    expect(dims).toEqual([
      { updateDimensionProperties: { range: { sheetId: 7, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: widthPx(14) }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: 7, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: widthPx(36) }, fields: 'pixelSize' } },
      { updateDimensionProperties: { range: { sheetId: 7, dimension: 'COLUMNS', startIndex: 2, endIndex: 4 }, properties: { pixelSize: widthPx(14) }, fields: 'pixelSize' } }, // columns 3 and 4 share the width
    ]);
    expect(widthPx(14)).toBe(14 * WIDTH.perChar + WIDTH.pad);
    expect(widthPx(0)).toBeGreaterThanOrEqual(WIDTH.minPx);
    expect(widthPx(NaN)).toBe(widthPx(12));
    expect(widthPx(9999)).toBe(WIDTH.maxPx);
  });

  it('D. currency: repeatCell on the amount columns (adjacent ones in one range), CURRENCY + pattern, from row 2 down', () => {
    const [m] = moneyRequests(meta[0], currencyFormat('EUR'));
    expect(m).toEqual({
      repeatCell: {
        range: { sheetId: 7, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 4 },
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '[$€]#,##0.00' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
    expect(moneyRequests({ sheetId: 7, moneyCols: [1, 4] }, currencyFormat('EUR'))).toHaveLength(2); // not adjacent: two ranges
  });

  it('layout (A-C) and money (D) are two separate batchUpdates: a number format Google refuses can never take the layout with it', () => {
    const p = buildFormatPayloads(meta, 'CLP');
    expect(Object.keys(p.layout)).toEqual(['requests']);
    expect(p.layout.requests.every((r) => !r.repeatCell?.cell?.userEnteredFormat?.numberFormat)).toBe(true);
    expect(p.money.requests.every((r) => r.repeatCell.fields === 'userEnteredFormat.numberFormat')).toBe(true);
    expect(buildFormatPayloads([{ sheetId: 1, widths: [10] }], 'CLP').money).toBeNull(); // a tab without amounts: nothing to send
  });

  it('sheetId 0 is a valid id (the first tab of many Sheets); garbage metadata is skipped, never thrown on', () => {
    expect(layoutRequests({ sheetId: 0, widths: [10] }).length).toBeGreaterThan(0);
    expect(buildFormatPayloads([null, 7, 'x', { sheetId: '3' }, { sheetId: -1 }, { sheetId: 1.5 }, {}], 'CLP').layout.requests).toEqual([]);
    expect(buildFormatPayloads(undefined, 'CLP').layout.requests).toEqual([]);
    expect(layoutRequests({ sheetId: 2, widths: 'nope' })).toHaveLength(2); // freeze + headers still go
  });
});

describe('2. the currency of the amounts: symbol and decimals of the local money', () => {
  it('EUR / USD two decimals, CLP / JPY none; never a wrong symbol', () => {
    expect(currencyFormat('EUR')).toEqual({ type: 'CURRENCY', pattern: '[$€]#,##0.00' });
    expect(currencyFormat('usd')).toEqual({ type: 'CURRENCY', pattern: '[$$]#,##0.00' });
    expect(currencyFormat('CLP')).toEqual({ type: 'CURRENCY', pattern: '[$$]#,##0' });
    expect(currencyFormat('JPY').pattern).toBe('[$¥]#,##0');
    expect(currencyFormat(' brl ').pattern).toMatch(/^\[\$R\$\]#,##0\.00$/);
  });

  it('no currency (consolidated rendición of several), junk or null: a plain number with thousands separators', () => {
    for (const bad of ['', null, undefined, 'EURO', '€', 12, 'x1', {}]) expect(currencyFormat(bad), String(bad)).toEqual({ type: 'NUMBER', pattern: '#,##0.00' });
  });

  it('the pattern never carries a character that would break the [$...] token', () => {
    for (const code of ['EUR', 'CLP', 'USD', 'CHF', 'PEN', 'MXN', 'ARS', 'COP', 'BRL', 'GBP', 'XAF', 'XXX']) {
      const { pattern } = currencyFormat(code);
      expect(pattern, code).toMatch(/^\[\$[^[\]"';-]+\]#,##0(\.0+)?$/);
    }
  });
});

describe('3. formatSpreadsheet NEVER throws and never touches the data', () => {
  const meta = [{ sheetId: 1, widths: [10], moneyCols: [1] }];

  it('POSTs to /v4/spreadsheets/{id}:batchUpdate: layout first, then money', async () => {
    const post = vi.fn(async () => ({}));
    const out = await formatSpreadsheet({ post }, ID, meta, 'CLP');
    expect(out).toEqual({ layout: true, money: true });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0]).toBe(URL_OF(ID));
    expect(post.mock.calls[1][0]).toBe(URL_OF(ID));
    expect(Object.keys(post.mock.calls[0][1])).toEqual(['requests']);
    expect(post.mock.calls[0][1].requests[0].updateSheetProperties).toBeTruthy();
    expect(post.mock.calls[1][1].requests[0].repeatCell.cell.userEnteredFormat.numberFormat.type).toBe('CURRENCY');
  });

  it('a failing network, a 4xx / 5xx, a bad id, no client, bad metadata: resolves, never rejects', async () => {
    const boom = { post: vi.fn(async () => { throw new Error('offline'); }) };
    await expect(formatSpreadsheet(boom, ID, meta, 'CLP')).resolves.toEqual({ layout: false, money: false });
    await expect(formatSpreadsheet({ post: async () => ({}) }, '../etc', meta, 'CLP')).resolves.toEqual({ layout: false, money: false });
    await expect(formatSpreadsheet({ post: async () => ({}) }, ID, null, 'CLP')).resolves.toEqual({ layout: false, money: false });
    await expect(formatSpreadsheet(null, ID, meta, 'CLP')).resolves.toEqual({ layout: false, money: false });
    await expect(formatSpreadsheet(undefined, undefined, undefined, undefined)).resolves.toEqual({ layout: false, money: false });
    await expect(formatSpreadsheet({ post: async () => ({}) }, ID, [{ sheetId: 1, get widths() { throw new Error('getter'); } }], 'CLP')).resolves.toEqual({ layout: false, money: false });
  });

  it('a currency pattern Google refuses: the layout is already in, and the amounts fall back to a plain number format', async () => {
    const sent = [];
    const post = vi.fn(async (_url, body) => {
      sent.push(body);
      if (JSON.stringify(body).includes('CURRENCY')) throw new Error('400 invalid pattern');
      return {};
    });
    const out = await formatSpreadsheet({ post }, ID, meta, 'CLP');
    expect(out).toEqual({ layout: true, money: true });
    expect(post).toHaveBeenCalledTimes(3);
    expect(sent[2].requests[0].repeatCell.cell.userEnteredFormat.numberFormat).toEqual({ type: 'NUMBER', pattern: '#,##0.00' });
  });

  it('a failing layout does not stop the amounts, and vice versa', async () => {
    const post = vi.fn(async (_url, body) => {
      if (body.requests[0].updateSheetProperties) throw new Error('x');
      return {};
    });
    expect(await formatSpreadsheet({ post }, ID, meta, 'CLP')).toEqual({ layout: false, money: true });
  });
});

describe('4. integrated in upsertSpreadsheet: right after the data, silent', () => {
  const TABS = () => [
    { name: 'Resumen', rows: [['Concepto', 'Monto'], ['Total', 100]], widths: [30, 14], moneyCols: [1], currency: 'CLP' },
    { name: 'Gastos', rows: [['Fecha', 'Monto'], ['2026-10-02', 30000]], widths: [14, 14], moneyCols: [1], currency: 'CLP' },
  ];

  it('create: the design is the LAST call, after values:batchUpdate; the tabs carry the frozen row, header, widths and currency format', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    drive.calls.length = 0;
    const out = await client.upsertSpreadsheet(folder, { title: 'rendicion-Casa', sheets: TABS() });
    expect(out.created).toBe(true);
    const seq = drive.calls.map(path);
    const iValues = seq.indexOf(`POST /v4/spreadsheets/${out.id}/values:batchUpdate`);
    const designs = seq.map((p, i) => (p === `POST /v4/spreadsheets/${out.id}:batchUpdate` ? i : -1)).filter((i) => i >= 0);
    expect(iValues).toBeGreaterThan(-1);
    expect(designs).toHaveLength(2); // layout + money
    expect(designs.every((i) => i > iValues)).toBe(true);
    expect(seq.at(-1)).toBe(`POST /v4/spreadsheets/${out.id}:batchUpdate`);

    const sheet = drive.sheet('rendicion-Casa');
    for (const g of sheet.grids) {
      expect(g.frozenRowCount, g.title).toBe(1);
      expect(g.dims.map((d) => d.properties.pixelSize), g.title).toEqual(g.title === 'Resumen' ? [widthPx(30), widthPx(14)] : [widthPx(14)]); // Gastos: [14, 14] is one range
      const header = g.format.find((f) => f.range.startRowIndex === 0);
      expect(header.cell.userEnteredFormat).toEqual({ textFormat: { bold: true }, horizontalAlignment: 'CENTER' });
      const money = g.format.find((f) => f.range.startColumnIndex === 1);
      expect(money.cell.userEnteredFormat.numberFormat).toEqual({ type: 'CURRENCY', pattern: '[$$]#,##0' });
    }
    expect(sheet.tabs.Gastos).toEqual([['Fecha', 'Monto'], ['2026-10-02', 30000]]); // the data is exactly what was sent
  });

  it('the design is applied with the sheetId Google gave each tab (not the position)', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    const out = await client.upsertSpreadsheet(folder, { title: 'rendicion-Casa', sheets: TABS() });
    const sheet = drive.sheet('rendicion-Casa');
    const layout = JSON.parse(drive.calls.filter((c) => c.url.endsWith(`${out.id}:batchUpdate`))[0].body);
    expect(layout.requests.filter((r) => r.updateSheetProperties).map((r) => r.updateSheetProperties.properties.sheetId)).toEqual(sheet.grids.map((g) => g.sheetId));
  });

  it('refresh: the design is re-asserted; a tab added now is designed with the sheetId Google answered', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    await client.upsertSpreadsheet(folder, { title: 'rendicion-Casa', sheets: [TABS()[0]] });
    const out = await client.upsertSpreadsheet(folder, { title: 'rendicion-Casa', sheets: TABS() });
    expect(out.created).toBe(false);
    const sheet = drive.sheet('rendicion-Casa');
    expect(sheet.grids).toHaveLength(2);
    for (const g of sheet.grids) expect(g.frozenRowCount, g.title).toBe(1);
    expect(sheet.grids[1].title).toBe('Gastos');
    expect(sheet.grids[1].format.length).toBeGreaterThan(0); // the new tab got its design too
  });

  it('SILENT: every request of the design fails -> the export is still a success and the data is all there', async () => {
    const drive = createFakeDrive();
    const failing = async (url, init = {}) => {
      if (String(url).endsWith(':batchUpdate') && JSON.parse(init.body || '{}').requests?.some((r) => r.repeatCell || (r.updateSheetProperties && r.updateSheetProperties.properties.gridProperties?.frozenRowCount) || r.updateDimensionProperties)) {
        return { ok: false, status: 500, json: async () => ({ error: 'boom' }), text: async () => 'boom' };
      }
      return drive.fetchImpl(url, init);
    };
    const client = createDriveClient({ getToken: async () => drive.token, fetchImpl: failing });
    const folder = await folderOf(client);
    const out = await client.upsertSpreadsheet(folder, { title: 'rendicion-Casa', sheets: TABS() });
    expect(out.created).toBe(true);
    const sheet = drive.sheet('rendicion-Casa');
    expect(sheet.tabs.Resumen).toEqual([['Concepto', 'Monto'], ['Total', 100]]);
    expect(sheet.grids[0].frozenRowCount).toBeUndefined(); // plain, but complete
  });

  it('SILENT: the network dies right after the data -> the call resolves (nothing to queue offline, the values are in the Sheet)', async () => {
    const drive = createFakeDrive();
    let dataWritten = false;
    const dying = async (url, init = {}) => {
      if (dataWritten) throw new TypeError('Failed to fetch');
      const res = await drive.fetchImpl(url, init);
      if (String(url).includes('values:batchUpdate')) dataWritten = true;
      return res;
    };
    const client = createDriveClient({ getToken: async () => drive.token, fetchImpl: dying });
    const folder = await folderOf(client);
    await expect(client.upsertSpreadsheet(folder, { title: 'rendicion-Casa', sheets: TABS() })).resolves.toMatchObject({ created: true });
    expect(drive.sheet('rendicion-Casa').tabs.Gastos).toHaveLength(2);
  });

  it('a refused currency pattern still leaves the layout, and a plain number format on the amounts', async () => {
    const drive = createFakeDrive();
    drive.state.rejectCurrency = true;
    const client = make(drive);
    const folder = await folderOf(client);
    await client.upsertSpreadsheet(folder, { title: 'rendicion-Casa', sheets: TABS() });
    const g = drive.sheet('rendicion-Casa').grids[1];
    expect(g.frozenRowCount).toBe(1);
    expect(g.format.find((f) => f.range.startColumnIndex === 1).cell.userEnteredFormat.numberFormat.type).toBe('NUMBER');
  });

  it('a tab with no widths / amount columns (the logbook): freeze + header only; the rest of the tabs are not affected', async () => {
    const drive = createFakeDrive();
    const client = make(drive);
    const folder = await folderOf(client);
    await client.upsertSpreadsheet(folder, { title: 'bitacora', sheets: [{ name: 'Bitácora', rows: [['Fecha', 'Entrada'], ['hoy', 'texto']] }] });
    const g = drive.sheet('bitacora').grids[0];
    expect(g.frozenRowCount).toBe(1);
    expect(g.dims).toBeUndefined();
    expect(g.format).toHaveLength(1);
  });
});

describe('5. the rendición tells the design which columns are money', () => {
  const { t } = makeI18n('es', 'CL');
  const NOW = new Date(2026, 9, 22, 12, 0, 0).getTime();
  const project = (name, regionCode = 'CL') => {
    const p = newProject({ regionCode, name, client: 'Cliente', now: NOW });
    p.payments = normalizePayments([{ amount: 600 }]);
    p.expenses = normalizeExpenses([{ amount: 1190, category: 'material', supplier: 'Sur', description: 'Cemento', quantity: 2, unitPrice: 595, netAmount: 1000, taxAmount: 190 }]);
    p.advances = normalizeAdvances([{ worker: 'Juan', amount: 50 }]);
    p.logbook = normalizeLogbook([{ text: 'Día 1', at: NOW }]);
    return p;
  };
  /** Columns that really hold a money cell in the rich sheet (what the builders mark with { money: true }). */
  const realMoneyCols = (sheet) => [...new Set(sheet.rows.flatMap((r) => r.map((c, i) => (c && typeof c === 'object' && c.money ? i : -1)).filter((i) => i >= 0)))].sort((a, b) => a - b);

  it('the declared amount columns are EXACTLY the columns that hold money cells (single project)', () => {
    const p = project('Casa');
    const sheets = buildRenditionSheets([p], new Map([[p.id, 5000]]), { t, locale: 'es', currency: 'CLP' });
    for (const s of sheets) expect(s.moneyCols ?? [], s.name).toEqual(realMoneyCols(s));
    expect(sheets.map((s) => s.currency)).toEqual(['CLP', 'CLP', 'CLP', 'CLP', undefined]); // the logbook has no amounts
  });

  it('...and in the consolidated one, shifted by the project column', () => {
    const a = project('Uno');
    const b = project('Dos');
    const sheets = buildRenditionSheets([a, b], new Map([[a.id, 1000], [b.id, 2000]]), { t, locale: 'es', currency: 'CLP' });
    for (const s of sheets) expect(s.moneyCols ?? [], s.name).toEqual(realMoneyCols(s));
  });

  it('the header of every amount column is an amount header; widths line up with the columns', () => {
    const p = project('Casa');
    const [, expenses, payments] = buildRenditionSheets([p], new Map([[p.id, 5000]]), { t, locale: 'es', currency: 'CLP' });
    expect(expenses.moneyCols.map((c) => expenses.rows[0][c].v)).toEqual([t('xl.unitPrice'), t('xl.net'), t('xl.tax'), t('xl.grossTotal')]);
    expect(payments.moneyCols.map((c) => payments.rows[0][c].v)).toEqual([t('xl.amount')]);
    for (const s of [expenses, payments]) expect(s.widths).toHaveLength(s.rows[0].length);
  });

  it('they survive the cleaning that only lets pure values through (and the offline queue, which uses the same cleaning)', () => {
    const p = project('Casa');
    const data = buildRenditionData([p], new Map([[p.id, 5000]]), { t, locale: 'es', currency: 'CLP' });
    expect(data[1].moneyCols).toEqual([8, 9, 10, 11]);
    expect(data[1].currency).toBe('CLP');
    expect(toValueSheets(JSON.parse(JSON.stringify(data)))).toEqual(data); // IndexedDB round trip
    expect(data[4].moneyCols).toBeUndefined();
  });

  it('toValueSheets: untrusted moneyCols / currency are sanitized (integers in range, unique, ISO code), and absent when empty', () => {
    const [s] = toValueSheets([{ name: 'A', rows: [], moneyCols: [3, 1, 1, -2, 2.5, 'x', 999, '4', null], currency: ' eur ' }]);
    expect(s.moneyCols).toEqual([1, 3, 4]);
    expect(s.currency).toBe('EUR');
    const [clean] = toValueSheets([{ name: 'B', rows: [], moneyCols: 'nope', currency: 'euro' }]);
    expect(clean).toEqual({ name: 'B', rows: [] });
  });

  it('a consolidated rendición of several currencies: no symbol (plain number), everything else the same', () => {
    const a = project('Uno');
    const c = project('Tres', 'PE');
    const data = buildRenditionData([a, c], new Map([[a.id, 1], [c.id, 1]]), { t, locale: 'es', currency: '' });
    expect(data[1].currency).toBeUndefined();
    expect(buildFormatPayloads([{ sheetId: 1, moneyCols: data[1].moneyCols }], data[1].currency).money.requests[0].repeatCell.cell.userEnteredFormat.numberFormat.type).toBe('NUMBER');
  });
});
