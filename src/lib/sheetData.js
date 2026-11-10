// The DATA of a spreadsheet, as pure values: what goes to the Google Sheets API (drive.js, upsertSpreadsheet) and what the offline queue keeps
// until it can go. Pure: no network, no React, no styles.
//
//   sheet  = { name: string, rows: (string | number)[][], widths?: number[] }
//   cell   = a string or a finite number. Blank cells are ''.
//
// The accounting builders (rendition.js) still describe their cells with presentation hints ({ v, bold, head, title, money }); toValueSheets()
// strips every one of them, so only values reach the API. Everything is sent as RAW values (never parsed): a text that starts with "=" is DATA and
// can never run as a formula in the user's Sheet.

export const SHEET_LIMITS = Object.freeze({
  maxTabs: 12,
  maxRows: 20_000,
  maxCols: 40,
  maxText: 5_000, // Google allows 50 000 chars per cell: a receipt line never needs more than a few hundred
  maxTitle: 80,
});

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffe\uffff]/g; // tabs / line feeds are kept: they are legitimate text

/** A cell (a value, or a legacy { v, ...style } object) -> a clean string or a finite number; anything else is a blank ''. */
export function cleanCell(cell) {
  const v = cell !== null && typeof cell === 'object' && !Array.isArray(cell) ? cell.v : cell;
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  if (typeof v === 'string') return v.replace(CONTROL, '').slice(0, SHEET_LIMITS.maxText);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return '';
}

/** 0 -> A, 25 -> Z, 26 -> AA ... */
export function columnName(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Tab names: <= 31 chars, none of []:*?/\ , unique (case-insensitive) within the spreadsheet. */
export function sheetNames(names) {
  const used = new Set();
  return names.map((raw, i) => {
    const base = String(raw || `Sheet${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    let k = 2;
    while (used.has(name.toLowerCase())) {
      const tail = ` (${k})`;
      name = base.slice(0, 31 - tail.length) + tail;
      k += 1;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** Trailing blank cells of a row carry no information. */
const trimRow = (row) => {
  let end = row.length;
  while (end > 0 && row[end - 1] === '') end -= 1;
  return end === row.length ? row : row.slice(0, end);
};

/**
 * Any untrusted list of sheets (the builders' rich cells, or a row read back from IndexedDB) -> clean value sheets.
 * Bounded (tabs, rows, columns, text) and always with unique, valid tab names. Never throws; garbage gives [].
 */
export function toValueSheets(sheets) {
  if (!Array.isArray(sheets)) return [];
  const list = sheets.filter((s) => s && typeof s === 'object').slice(0, SHEET_LIMITS.maxTabs);
  const names = sheetNames(list.map((s) => s.name));
  return list.map((s, i) => {
    const rows = (Array.isArray(s.rows) ? s.rows : []).slice(0, SHEET_LIMITS.maxRows).map((row) => trimRow((Array.isArray(row) ? row : []).slice(0, SHEET_LIMITS.maxCols).map(cleanCell)));
    const widths = (Array.isArray(s.widths) ? s.widths : []).slice(0, SHEET_LIMITS.maxCols).map((w) => (Number.isFinite(Number(w)) ? Math.max(4, Math.min(80, Math.round(Number(w)))) : 12));
    return { name: names[i], rows, ...(widths.length ? { widths } : {}) };
  });
}

/** Grid a tab needs: the data plus a little room (a living sheet: the user keeps typing under the last row). */
export function gridFor(sheet) {
  const cols = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
  return { rowCount: Math.max(100, sheet.rows.length + 50), columnCount: Math.max(10, cols) };
}

/** Safe name stem: letters / digits / dash / underscore only. */
export const fileStem = (text, fallback = 'cubrax') =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || fallback;

/** The title of a spreadsheet in Drive: one line of plain text. */
export const sheetTitle = (text, fallback = 'Rendicion') => String(text ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, SHEET_LIMITS.maxTitle) || fallback;

/** How much space the values take once serialized (the offline queue refuses absurd payloads). */
export const sheetsSize = (sheets) => {
  try {
    return JSON.stringify(sheets).length;
  } catch {
    return Infinity;
  }
};
