// The "Zero-Stress" design of the live Google Sheet: what makes the document easy on the eyes, injected with the Sheets v4 `batchUpdate` endpoint
// (POST https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}:batchUpdate, body { requests: [...] }).
//
// Per tab:
//   A. FREEZE      updateSheetProperties  gridProperties.frozenRowCount = 1                    (the header never scrolls away)
//   B. HEADERS     repeatCell on row 1    textFormat.bold + horizontalAlignment CENTER         fields 'userEnteredFormat(textFormat,horizontalAlignment)'
//   C. WIDTHS      updateDimensionProperties COLUMNS, pixelSize                                (the widths of the rendición, in characters -> pixels)
//   D. CURRENCY    repeatCell on each money column  numberFormat { type: 'CURRENCY', pattern: '[$€]#,##0.00' }   (the symbol and decimals of the local currency)
//
// A..C go in one request and D in a second one: a batchUpdate is ATOMIC, so a number format Google did not like must never take the layout down with it.
//
// "Nice-to-have", never a risk: formatSpreadsheet() NEVER throws and never touches the data. The values are already in the Sheet (values:batchUpdate has
// finished); if any visual request fails, the document is just plain and the caller (and the offline queue) carries on as if nothing happened.
// Pure of the browser: the HTTP call is the injected `client.post(url, body)`.

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const ID_RE = /^[A-Za-z0-9_-]{5,200}$/;

/** characters -> pixels. The widths of the rendición are in characters (about 7 px each at the default font) plus the cell padding. */
export const WIDTH = Object.freeze({ perChar: 7, pad: 12, minPx: 40, maxPx: 640 });
export const widthPx = (chars) => {
  const n = Number(chars);
  const c = Number.isFinite(n) && n > 0 ? n : 12;
  return Math.max(WIDTH.minPx, Math.min(WIDTH.maxPx, Math.round(c * WIDTH.perChar + WIDTH.pad)));
};

const PLAIN = Object.freeze({ type: 'NUMBER', pattern: '#,##0.00' });

/**
 * numberFormat of the money columns for an ISO currency code: { type: 'CURRENCY', pattern: '[$€]#,##0.00' }.
 * The symbol and the decimals come from the currency itself (CLP "$" and 0 decimals, EUR "€" and 2, JPY "¥" and 0...).
 * No / unknown currency (a consolidated rendición of several currencies): a plain number with thousands separators; never a wrong symbol.
 */
export function currencyFormat(currency) {
  const code = String(currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return { ...PLAIN };
  try {
    const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' });
    const symbol = (nf.formatToParts(0).find((p) => p.type === 'currency')?.value || code).replace(/[[\]\\"';-]/g, '').trim() || code;
    const digits = Math.max(0, Math.min(4, nf.resolvedOptions().maximumFractionDigits ?? 2));
    return { type: 'CURRENCY', pattern: `[$${symbol}]#,##0${digits ? `.${'0'.repeat(digits)}` : ''}` };
  } catch {
    return { ...PLAIN };
  }
}

const isId = (v) => Number.isInteger(v) && v >= 0;

/** Consecutive equal values -> [{ from, to (exclusive), value }] : one request per run of columns, not one per column. */
const runs = (values) => {
  const out = [];
  values.forEach((value, i) => {
    const last = out[out.length - 1];
    if (last && last.value === value && last.to === i) last.to = i + 1;
    else out.push({ from: i, to: i + 1, value });
  });
  return out;
};

/** Layout requests (A, B, C) of ONE tab. `sheet` = { sheetId, widths? }. */
export function layoutRequests({ sheetId, widths = [] }) {
  if (!isId(sheetId)) return [];
  const requests = [
    // A. FREEZE: row 1 stays on screen
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    // B. HEADERS: bold and centred, the whole of row 1 (startRowIndex 0, no column bounds = every column)
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment)',
      },
    },
  ];
  // C. WIDTHS: exact pixels per column (neighbours with the same width share one request)
  for (const r of runs((Array.isArray(widths) ? widths : []).map(widthPx))) {
    requests.push({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: r.from, endIndex: r.to }, properties: { pixelSize: r.value }, fields: 'pixelSize' } });
  }
  return requests;
}

/** Money requests (D) of ONE tab: the amount columns (from row 2 down: the header is text) get the currency number format. */
export function moneyRequests({ sheetId, moneyCols = [] }, numberFormat) {
  if (!isId(sheetId)) return [];
  const cols = [...new Set((Array.isArray(moneyCols) ? moneyCols : []).filter((c) => Number.isInteger(c) && c >= 0))].sort((a, b) => a - b);
  const out = [];
  for (const c of cols) {
    const last = out[out.length - 1];
    if (last && last.repeatCell.range.endColumnIndex === c) last.repeatCell.range.endColumnIndex = c + 1; // adjacent amount columns: one range
    else
      out.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 },
          cell: { userEnteredFormat: { numberFormat } },
          fields: 'userEnteredFormat.numberFormat',
        },
      });
  }
  return out;
}

/**
 * The two payloads of the design for a whole spreadsheet.
 * @param sheetsMetadata  [{ sheetId, widths?, moneyCols? }]  sheetId = what Google returned when the tab was created (a tab without a valid one is skipped)
 * @returns { layout: { requests }, money: { requests } | null }
 */
export function buildFormatPayloads(sheetsMetadata, currency) {
  const tabs = (Array.isArray(sheetsMetadata) ? sheetsMetadata : []).filter((s) => s && typeof s === 'object' && isId(s.sheetId));
  const numberFormat = currencyFormat(currency);
  const layout = tabs.flatMap((s) => layoutRequests(s));
  const money = tabs.flatMap((s) => moneyRequests(s, numberFormat));
  return { layout: { requests: layout }, money: money.length ? { requests: money } : null, numberFormat };
}

/**
 * Inject the design into the Spreadsheet. NEVER throws: every failure is swallowed (the data is already safe in the Sheet).
 * @param client           { post(url, body) => Promise }   the authenticated HTTP client (drive.js)
 * @param spreadsheetId    the id Google returned
 * @param sheetsMetadata   [{ sheetId, widths?, moneyCols? }]
 * @param currency         ISO code of the amounts ('CLP', 'EUR'...; '' = a plain number)
 * @returns { layout: boolean, money: boolean }   what actually got applied (informational: nobody has to act on it)
 */
export async function formatSpreadsheet(client, spreadsheetId, sheetsMetadata, currency = '') {
  const done = { layout: false, money: false };
  try {
    if (typeof client?.post !== 'function' || !ID_RE.test(String(spreadsheetId))) return done;
    const url = `${SHEETS}/${spreadsheetId}:batchUpdate`;
    const { layout, money, numberFormat } = buildFormatPayloads(sheetsMetadata, currency);
    if (layout.requests.length) {
      try {
        await client.post(url, layout);
        done.layout = true;
      } catch {
        /* nice-to-have */
      }
    }
    if (money) {
      try {
        await client.post(url, money);
        done.money = true;
      } catch {
        // the currency pattern was not accepted: a plain number format is still better than nothing
        if (numberFormat.type !== 'NUMBER') {
          try {
            await client.post(url, { requests: money.requests.map((r) => ({ repeatCell: { ...r.repeatCell, cell: { userEnteredFormat: { numberFormat: { ...PLAIN } } } } })) });
            done.money = true;
          } catch {
            /* nice-to-have */
          }
        }
      }
    }
  } catch {
    /* never throws */
  }
  return done;
}
