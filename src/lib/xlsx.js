// Minimal, dependency-light .xlsx writer (Office Open XML in a zip, via fflate which jsPDF already ships).
// Enough for accounting exports: several sheets, text / number cells, bold + header + money styles, column
// widths. Text goes in as inline strings, so a cell that starts with "=" is DATA and can never run as a formula.

import { strToU8, zipSync } from 'fflate';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;
const esc = (s) =>
  String(s)
    .replace(BAD_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

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

/** Excel sheet names: <= 31 chars, none of []:*?/\ , unique (case-insensitive) within the workbook. */
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

// cellXfs indexes (see STYLES below)
const XF = { text: 0, bold: 1, head: 2, money: 3, boldMoney: 4, title: 5 };

const styleOf = (cell) => {
  if (cell.head) return XF.head;
  if (cell.title) return XF.title;
  if (cell.money) return cell.bold ? XF.boldMoney : XF.money;
  if (cell.bold) return XF.bold;
  return XF.text;
};

/** A cell is a string, a number, null, or {v, bold, head, title, money}. */
function cellXml(cell, ref) {
  if (cell === null || cell === undefined || cell === '') return '';
  const c = typeof cell === 'object' ? cell : { v: cell };
  const s = styleOf(c);
  const style = s ? ` s="${s}"` : '';
  if (typeof c.v === 'number') return Number.isFinite(c.v) ? `<c r="${ref}"${style}><v>${c.v}</v></c>` : '';
  const text = String(c.v ?? '');
  return text ? `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(text)}</t></is></c>` : '';
}

function sheetXml(sheet) {
  const rows = sheet.rows || [];
  const widths = sheet.widths || [];
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(80, w))}" customWidth="1"/>`).join('')}</cols>` : '';
  const body = rows
    .map((row, r) => {
      const cells = (row || []).map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`)).join('');
      return cells ? `<row r="${r + 1}">${cells}</row>` : '';
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}

const stylesXml = (digits) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2EFDA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="${digits > 0 ? 4 : 3}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="${digits > 0 ? 4 : 3}" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/**
 * Build the workbook.
 * @param sheets [{ name, rows: Cell[][], widths?: number[] }]
 * @param digits currency decimals (0 or 2): picks the money number format
 * @returns Uint8Array (a valid .xlsx)
 */
export function buildXlsx(sheets, { digits = 2 } = {}) {
  const list = sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }];
  const names = sheetNames(list.map((s) => s.name));
  const files = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${list
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    ),
    'xl/styles.xml': strToU8(stylesXml(digits)),
  };
  list.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  return zipSync(files, { level: 6 });
}

/** Safe file name stem: letters / digits / dash / underscore only. */
export const fileStem = (text, fallback = 'cubrax') =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || fallback;

export const xlsxToFile = (bytes, fileName) => new File([bytes], fileName, { type: XLSX_MIME });
