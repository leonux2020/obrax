// @vitest-environment happy-dom
// The libraries behind the restructured flow: ledger, dashboard levels, frozen quote, quote overheads,
// receipts, spreadsheet export, native sharing, geo detection and the Drive consent request.
import { describe, it, expect, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  normalizePayments,
  normalizeAdvances,
  normalizeExpenses,
  normalizeLogbook,
  normalizeLocation,
  cashSummary,
  laborPool,
  expensesTotal,
  rentalsDue,
  hasRentalDue,
  dayOf,
  LEDGER_LIMITS,
} from '../src/lib/ledger.js';
import { newProject, normalizeProject, projectLevel, isClosed } from '../src/lib/projects.js';
import { newDraft, normalizeDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { freezeQuote, pricingTime, planningTimeline, normalizeFrozen } from '../src/lib/signature.js';
import { normalizeReceipt, expensesFromRows } from '../src/lib/receipt.js';
import { buildXlsx, columnName, sheetNames, fileStem } from '../src/lib/xlsx.js';
import { buildRenditionSheets, buildRenditionFile, projectBalance } from '../src/lib/rendition.js';
import { shareOrDownload } from '../src/lib/shareFile.js';
import { detectRegionCode, detectLang, currentPosition } from '../src/lib/geo.js';
import { requestDriveAccess } from '../src/lib/auth.js';
import { makeI18n } from '../src/lib/i18n.jsx';

const NOW = new Date(2026, 9, 22, 12, 0, 0).getTime(); // 22 Oct 2026, local noon
const sized = (draft) => {
  draft.partidas[0].dims = { ...draft.partidas[0].dims, length: 6, width: 4 };
  return draft;
};

describe('ledger: untrusted records are cleaned and bounded', () => {
  it('payments / advances drop invalid amounts, sanitize text and keep unique ids', () => {
    const pays = normalizePayments([{ id: 'abc123', amount: '1500,5', at: 5, note: '<b>Anticipo</b>' }, { amount: -3 }, { amount: 'x' }, null, 7, { id: 'abc123', amount: 10 }]);
    expect(pays).toHaveLength(2);
    expect(pays[0].amount).toBe(1500.5);
    expect(pays[0].note).not.toMatch(/[<>]/);
    expect(new Set(pays.map((p) => p.id)).size).toBe(2);
    expect(normalizePayments('nope')).toEqual([]);
    expect(normalizePayments(Array.from({ length: 300 }, () => ({ amount: 1 })))).toHaveLength(LEDGER_LIMITS.payments);

    const adv = normalizeAdvances([{ worker: 'Juan', amount: 20000 }, { worker: '  ', amount: 5 }, { worker: 'Ana', amount: 0 }]);
    expect(adv).toHaveLength(1);
    expect(adv[0].worker).toBe('Juan');
  });

  it('expenses: unknown categories become "other"; only rentals keep a valid return day', () => {
    const [a, b, c, d] = normalizeExpenses([
      { amount: 100, category: 'weird', returnDate: '2026-10-22' },
      { amount: 200, category: 'tool_rental', returnDate: '2026-10-22', returned: true },
      { amount: 300, category: 'machinery_rental', returnDate: 'tomorrow' },
      { amount: 400, category: 'material', returned: true },
    ]);
    expect(a.category).toBe('other');
    expect(a.returnDate).toBe('');
    expect(b).toMatchObject({ returnDate: '2026-10-22', returned: true });
    expect(c.returnDate).toBe('');
    expect(d).toMatchObject({ returnDate: '', returned: false });
  });

  it('logbook and location', () => {
    expect(normalizeLogbook([{ text: '  Hormigonado  ' }, { text: '   ' }, { text: 'x'.repeat(5000) }]).map((l) => l.text.length)).toEqual([11, LEDGER_LIMITS.logChars]);
    expect(normalizeLocation({ lat: -33.4489, lng: -70.6693, label: 'Santiago' })).toEqual({ lat: -33.4489, lng: -70.6693, label: 'Santiago' });
    expect(normalizeLocation({ lat: 91, lng: 0 })).toBeNull();
    expect(normalizeLocation({ lat: 'a', lng: 0 })).toBeNull();
    expect(normalizeLocation(null)).toBeNull();
  });
});

describe('ledger: cash control, labour pool and rental alerts', () => {
  it('cashSummary: paid / pending / percentage (clamped) / overpayment', () => {
    expect(cashSummary(1000, [{ amount: 250 }, { amount: 250 }])).toMatchObject({ paid: 500, pending: 500, pct: 50, overpaid: false });
    expect(cashSummary(1000, [{ amount: 1200 }])).toMatchObject({ pending: 0, pct: 100, overpaid: true });
    expect(cashSummary(0, [{ amount: 10 }])).toMatchObject({ pct: 0, overpaid: false });
  });

  it('laborPool: advances are discounted from the visible pool', () => {
    expect(laborPool(100000, [{ amount: 30000 }, { amount: 20000 }])).toEqual({ pool: 100000, advanced: 50000, available: 50000 });
    expect(laborPool(10, [{ amount: 30 }]).available).toBe(-20);
    expect(expensesTotal([{ amount: 1.1 }, { amount: 2.2 }])).toBe(3.3);
  });

  it('rentalsDue: only unreturned rentals whose return day is today or earlier (the hourglass)', () => {
    const today = dayOf(NOW);
    expect(today).toBe('2026-10-22');
    const expenses = normalizeExpenses([
      { amount: 1, category: 'tool_rental', returnDate: '2026-10-22' }, // today -> due
      { amount: 2, category: 'machinery_rental', returnDate: '2026-10-20' }, // late -> due
      { amount: 3, category: 'tool_rental', returnDate: '2026-10-23' }, // tomorrow
      { amount: 4, category: 'tool_rental', returnDate: '2026-10-22', returned: true }, // given back
      { amount: 5, category: 'material', returnDate: '2026-10-22' }, // not a rental
    ]);
    expect(rentalsDue(expenses, NOW).map((e) => e.amount)).toEqual([1, 2]);
    expect(hasRentalDue({ expenses }, NOW)).toBe(true);
    expect(hasRentalDue({ expenses: expenses.slice(2) }, NOW)).toBe(false);
    expect(hasRentalDue(null, NOW)).toBe(false);
  });
});

describe('projects: dashboard level, closed jobs and the new fields', () => {
  const at = (start, end) => newProject({ regionCode: 'CL', startDate: start, endDate: end, now: NOW });

  it('projectLevel: future (blue), red with the late days, orange, green and undated (on time)', () => {
    expect(projectLevel(at('2026-10-30', '2026-11-30'), NOW)).toMatchObject({ level: 'future', daysUntilStart: 8, daysLate: 0 });
    expect(projectLevel(at('2026-10-01', '2026-10-17'), NOW)).toMatchObject({ level: 'red', daysLate: 5 });
    expect(projectLevel(at('2026-10-01', '2026-10-24'), NOW).level).toBe('orange');
    expect(projectLevel(at('2026-10-01', '2026-12-31'), NOW).level).toBe('green');
    expect(projectLevel(at('2026-10-01', ''), NOW)).toMatchObject({ level: 'green', daysLate: 0 }); // no end date: never late
    expect(projectLevel(at('', ''), NOW).level).toBe('green');
  });

  it('closedAt marks the Historial; the ledger fields survive a save/load round trip and junk is cleaned', () => {
    const p = at('', '');
    expect(isClosed(p)).toBe(false);
    expect(isClosed({ ...p, closedAt: NOW })).toBe(true);
    const full = { ...p, closedAt: NOW, payments: [{ amount: 5 }], advances: [{ worker: 'Juan', amount: 6 }], expenses: [{ amount: 7 }], logbook: [{ text: 'hola' }], location: { lat: 1, lng: 2 } };
    const back = normalizeProject(JSON.parse(JSON.stringify(full)));
    expect(back.closedAt).toBe(NOW);
    expect([back.payments.length, back.advances.length, back.expenses.length, back.logbook.length]).toEqual([1, 1, 1, 1]);
    expect(back.location).toMatchObject({ lat: 1, lng: 2 });
    const old = normalizeProject({ ...p, payments: 'x', expenses: [{ amount: -1 }], location: 'x', closedAt: 'y' });
    expect(old).toMatchObject({ payments: [], expenses: [], location: null, closedAt: 0 });
  });
});

describe('frozen quote ("Generar PDF")', () => {
  it('freezeQuote stamps the price time and dates; a second call and a signature leave it alone', () => {
    const d = sized(newDraft('CL'));
    const frozen = freezeQuote(d, { pricedAt: 1000, total: 500, live: { startDate: '2026-10-01', endDate: '2026-10-30' }, now: 2000 });
    expect(frozen.frozen).toEqual({ at: 2000, pricedAt: 1000, total: 500, timeline: { startDate: '2026-10-01', endDate: '2026-10-30' } });
    expect(freezeQuote(frozen, { pricedAt: 9, total: 9, now: 9 })).toBe(frozen);
    expect(d.frozen).toBeNull(); // pure
  });

  it('while frozen, prices use the frozen time and the plan uses the frozen dates; unfreezing releases both', () => {
    const d = freezeQuote(sized(newDraft('CL')), { pricedAt: 1000, total: 1, live: { startDate: '2026-10-01', endDate: '2026-10-30' } });
    expect(pricingTime(d, 99999)).toBe(1000);
    expect(planningTimeline(d, { startDate: '2027-01-01', endDate: '2027-02-01' })).toEqual({ startDate: '2026-10-01', endDate: '2026-10-30' });
    const free = { ...d, frozen: null };
    expect(pricingTime(free, 99999)).toBe(99999);
    expect(planningTimeline(free, { startDate: '2027-01-01', endDate: '2027-02-01' }).startDate).toBe('2027-01-01');
  });

  it('normalizeFrozen rejects junk and survives normalizeDraft', () => {
    expect(normalizeFrozen(null)).toBeNull();
    expect(normalizeFrozen({ pricedAt: 'x' })).toBeNull();
    const d = freezeQuote(sized(newDraft('CL')), { pricedAt: 1000, total: 7 });
    expect(normalizeDraft(JSON.parse(JSON.stringify(d)), 'CL').frozen).toMatchObject({ pricedAt: 1000, total: 7 });
    expect(normalizeDraft(JSON.parse(JSON.stringify({ ...d, frozen: { pricedAt: -1 } })), 'CL').frozen).toBeNull();
  });
});

describe('quote overheads: Imprevistos and Utilidad', () => {
  const base = () => {
    const d = sized(newDraft('CL'));
    return d;
  };
  it('default 0% leaves the quote exactly as before', () => {
    const d = base();
    expect(d.finance.contingency).toBe(0);
    expect(d.finance.profit).toBe(0);
    const q = computeAll(d, NOW).quote;
    expect(q.contingency).toBe(0);
    expect(q.profit).toBe(0);
  });

  it('contingency applies over direct costs and profit over direct + contingency', () => {
    const d0 = base();
    const q0 = computeAll(d0, NOW).quote;
    const d = base();
    d.finance.contingency = 10;
    d.finance.profit = 20;
    const q = computeAll(d, NOW).quote;
    const direct = q0.subtotal;
    expect(Math.abs(q.contingency - direct * 0.1)).toBeLessThan(1); // CLP has no decimals: each line is rounded
    expect(Math.abs(q.profit - direct * 1.1 * 0.2)).toBeLessThan(1);
    expect(Math.abs(q.subtotal - direct * 1.1 * 1.2)).toBeLessThan(1.5);
    expect(q.total).toBeGreaterThan(q0.total);
  });

  it('out-of-range percentages fall back to the default when a draft is loaded', () => {
    const d = base();
    d.finance.contingency = 500;
    d.finance.profit = -4;
    const back = normalizeDraft(JSON.parse(JSON.stringify(d)), 'CL');
    expect(back.finance.contingency).toBe(0); // out of range -> the default, like every other finance field
    expect(back.finance.profit).toBe(0);
    d.finance.contingency = 12;
    expect(normalizeDraft(JSON.parse(JSON.stringify(d)), 'CL').finance.contingency).toBe(12);
  });
});

describe('receipt reading: the model output is data, never trusted', () => {
  it('amounts come from the PRINTED text, categories are whitelisted, only rentals keep a return day', () => {
    const r = normalizeReceipt({
      isReceipt: true,
      currency: 'clp',
      supplier: '<b>Arriendos Sur</b>',
      receiptDate: '2026-10-20',
      items: [
        { description: 'Taladro percutor', quantity: 1, amountText: '$ 12.000', amount: 12, category: 'tool_rental', returnDate: '2026-10-22' },
        { description: 'Cemento', quantity: 10, amountText: '49.900', category: 'material', returnDate: '2026-10-22' },
        { description: 'Raro', amount: 5, category: 'drugs' },
        { description: 'sin precio', category: 'material' },
        { description: 'Fecha mala', amount: 5, category: 'machinery_rental', returnDate: '2026-13-45' },
      ],
    });
    expect(r.currency).toBe('CLP');
    expect(r.supplier).not.toMatch(/[<>]/);
    expect(r.items.map((i) => i.amount)).toEqual([12000, 49900, 5, 5]);
    expect(r.items.map((i) => i.category)).toEqual(['tool_rental', 'material', 'other', 'machinery_rental']);
    expect(r.items.map((i) => i.returnDate)).toEqual(['2026-10-22', '', '', '']);
  });

  it('garbage in -> empty receipt; isReceipt false is preserved', () => {
    expect(normalizeReceipt(null).items).toEqual([]);
    expect(normalizeReceipt({ isReceipt: false, items: [] }).isReceipt).toBe(false);
    expect(normalizeReceipt({ items: Array.from({ length: 200 }, () => ({ amount: 1 })) }).items).toHaveLength(40);
  });

  it('expensesFromRows keeps only ticked rows with an amount', () => {
    const out = expensesFromRows(
      [
        { selected: true, amount: 10, description: 'A', category: 'tool_rental', returnDate: '2026-10-22' },
        { selected: false, amount: 20, description: 'B', category: 'material' },
        { selected: true, amount: 0, description: 'C', category: 'material' },
        { selected: true, amount: 5, description: 'D', category: 'material', returnDate: '2026-10-22' },
      ],
      { supplier: 'Sur', now: 5 }
    );
    expect(out.map((e) => e.description)).toEqual(['A', 'D']);
    expect(out[0]).toMatchObject({ supplier: 'Sur', at: 5, returned: false, returnDate: '2026-10-22' });
    expect(out[1].returnDate).toBe('');
  });
});

describe('xlsx writer', () => {
  const unzip = (bytes) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));

  it('produces a valid package: content types, workbook, rels, styles and one part per sheet', () => {
    const files = unzip(buildXlsx([{ name: 'Uno', rows: [['a', 1]] }, { name: 'Dos', rows: [] }]));
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
    expect(files['xl/workbook.xml']).toContain('name="Uno"');
    expect(files['xl/worksheets/sheet1.xml']).toContain('<c r="B1"><v>1</v></c>');
  });

  it('text is inline and escaped: "=" cells are data, markup cannot break the XML, control chars are dropped', () => {
    const sheet = unzip(buildXlsx([{ name: 'S', rows: [['=HYPERLINK("http://x")', '<b>&</b>', 'a\u0001b', { v: 5, money: true, bold: true }, { v: NaN }]] }]))['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain('=HYPERLINK(&quot;http://x&quot;)');
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('&lt;b&gt;&amp;&lt;/b&gt;');
    expect(sheet).toContain('ab');
    expect(sheet).toContain('s="4"');
    expect(sheet).not.toContain('NaN');
  });

  it('helpers: column letters, sheet-name rules, file stems', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(sheetNames(['A/B:C', 'x'.repeat(40), 'dup', 'DUP', ''])).toEqual(['A B C', 'x'.repeat(31), 'dup', 'DUP (2)', 'Sheet5']);
    expect(fileStem('Casa López 2/3')).toBe('Casa-Lopez-2-3');
    expect(fileStem('///', 'obra')).toBe('obra');
  });
});

describe('rendición (individual and consolidated Excel)', () => {
  const { t } = makeI18n('es', 'CL');
  const project = (name, regionCode = 'CL') => {
    const p = newProject({ regionCode, name, client: 'Cliente', now: NOW });
    p.payments = normalizePayments([{ amount: 600 }, { amount: 100 }]);
    p.expenses = normalizeExpenses([{ amount: 200, category: 'material', supplier: 'Sur', description: 'Cemento' }]);
    p.advances = normalizeAdvances([{ worker: 'Juan', amount: 50 }]);
    p.logbook = normalizeLogbook([{ text: 'Día 1', at: NOW }]);
    return p;
  };

  it('projectBalance = collected - expenses - advances', () => {
    const p = project('Casa');
    expect(projectBalance(p, 1000)).toEqual({ budget: 1000, paid: 700, pending: 300, spent: 200, advanced: 50, balance: 450 });
  });

  it('one project: five sheets, no per-row project column, and an incomplete quote does not break it', () => {
    const p = project('Casa');
    const sheets = buildRenditionSheets([p], new Map([[p.id, null]]), { t, locale: 'es', currency: 'CLP' });
    expect(sheets).toHaveLength(5);
    expect(sheets[1].rows[0]).toHaveLength(7);
    expect(sheets[1].rows).toHaveLength(2);
    expect(sheets[0].rows.flat().some((c) => c && c.v === 'Casa' || c === 'Casa')).toBe(true);
  });

  it('consolidated: a project column and a grand total only when all share one currency', () => {
    const a = project('Uno');
    const b = project('Dos');
    const totals = new Map([[a.id, 1000], [b.id, 2000]]);
    const same = buildRenditionSheets([a, b], totals, { t, locale: 'es', currency: '' });
    expect(same[1].rows[0]).toHaveLength(8);
    const last = same[0].rows.at(-1);
    expect(last[0].v).toBe(t('xl.total'));
    expect(last[3].v).toBe(3000);
    const c = project('Tres', 'PE');
    const mixed = buildRenditionSheets([a, c], new Map([[a.id, 1], [c.id, 1]]), { t, locale: 'es', currency: '' });
    expect(mixed[0].rows.at(-1)[0]).not.toEqual(expect.objectContaining({ v: t('xl.total') }));
    expect(mixed[0].rows.some((r) => r[2] === 'PEN')).toBe(true);
  });

  it('buildRenditionFile returns a real .xlsx File with a safe name', async () => {
    const p = project('Casa López');
    const file = buildRenditionFile([p], new Map([[p.id, 1000]]), { t, locale: 'es', currency: 'CLP' });
    expect(file.name).toMatch(/^[A-Za-z0-9_-]+\.xlsx$/);
    expect(file.name).toContain('Casa-Lopez');
    expect(file.type).toContain('spreadsheetml');
    expect(Object.keys(unzipSync(new Uint8Array(await file.arrayBuffer())))).toContain('xl/workbook.xml');
  });
});

describe('shareOrDownload: navigator.share with the real file, else a download', () => {
  const file = new File(['x'], 'r.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  it('shares the file natively when the browser can', async () => {
    const nav = { share: vi.fn().mockResolvedValue(undefined), canShare: vi.fn(() => true) };
    expect(await shareOrDownload(file, { title: 'T', text: 'hi' }, nav)).toBe('shared');
    expect(nav.share).toHaveBeenCalledWith({ files: [file], title: 'T', text: 'hi' });
  });

  it('closing the share sheet is "cancelled", not an error and not a download', async () => {
    const nav = { share: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' })), canShare: () => true };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(await shareOrDownload(file, {}, nav)).toBe('cancelled');
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('without file sharing (or if it fails at the last moment) the file is downloaded', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    expect(await shareOrDownload(file, {}, {})).toBe('downloaded');
    const failing = { share: vi.fn().mockRejectedValue(new Error('NotAllowed')), canShare: () => true };
    expect(await shareOrDownload(file, {}, failing)).toBe('downloaded');
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });
});

describe('geo: silent detection and the location button', () => {
  it('country from the language region, else from the time zone, else null', () => {
    expect(detectRegionCode({ languages: ['es-CL', 'es'], timeZone: 'Europe/Madrid' })).toBe('CL');
    expect(detectRegionCode({ languages: ['es', 'en'], timeZone: 'America/Santiago' })).toBe('CL');
    expect(detectRegionCode({ languages: ['xx-ZZ'], timeZone: 'Nowhere/None' })).toBeNull();
    expect(detectRegionCode({ languages: [], timeZone: '' })).toBeNull();
  });

  it('language: the browser one when the app has it, else the fallback', () => {
    expect(detectLang('es', { languages: ['pt-BR'] })).toBe('pt');
    expect(detectLang('fr', { languages: ['ja-JP'] })).toBe('fr');
  });

  it('currentPosition resolves lat/lng and maps failures to codes', async () => {
    const ok = { getCurrentPosition: (res) => res({ coords: { latitude: -33.4, longitude: -70.6 } }) };
    await expect(currentPosition({ geolocation: ok })).resolves.toEqual({ lat: -33.4, lng: -70.6 });
    const deny = (code) => ({ getCurrentPosition: (_, rej) => rej({ code }) });
    await expect(currentPosition({ geolocation: deny(1) })).rejects.toMatchObject({ code: 'denied' });
    await expect(currentPosition({ geolocation: deny(3) })).rejects.toMatchObject({ code: 'timeout' });
    await expect(currentPosition({ geolocation: deny(2) })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(currentPosition({ geolocation: null })).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('Google Drive consent (native OAuth, no passwords)', () => {
  const gsi = (resp, extra = {}) => ({
    accounts: {
      oauth2: {
        hasGrantedAllScopes: () => true,
        initTokenClient: (cfg) => {
          expect(cfg.scope).toBe('https://www.googleapis.com/auth/drive.file');
          return { requestAccessToken: () => cfg.callback(resp) };
        },
        ...extra,
      },
    },
  });

  it('not configured / offline / denied / granted', async () => {
    await expect(requestDriveAccess({ enabled: false })).rejects.toMatchObject({ code: 'not_configured' });
    await expect(requestDriveAccess({ enabled: true, load: async () => { throw new Error('net'); } })).rejects.toMatchObject({ code: 'offline' });
    await expect(requestDriveAccess({ enabled: true, load: async () => ({}) })).rejects.toMatchObject({ code: 'offline' });
    await expect(requestDriveAccess({ enabled: true, load: async () => gsi({ error: 'access_denied' }) })).rejects.toMatchObject({ code: 'denied' });
    await expect(requestDriveAccess({ enabled: true, load: async () => gsi({ access_token: 't' }, { hasGrantedAllScopes: () => false }) })).rejects.toMatchObject({ code: 'denied' });
    await expect(requestDriveAccess({ enabled: true, clientId: 'cid', load: async () => gsi({ access_token: 't' }) })).resolves.toEqual({ granted: true });
  });

  it('the granted token is not handed back to the app', async () => {
    const res = await requestDriveAccess({ enabled: true, load: async () => gsi({ access_token: 'SECRET-TOKEN' }) });
    expect(JSON.stringify(res)).not.toContain('SECRET-TOKEN');
  });
});
