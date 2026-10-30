// Rendición de cuentas (accounting statement) as spreadsheet sheets: one project, or several consolidated.
// Pure: it receives the already-computed budget total of each project, so no pricing runs here.

import { cashSummary, expensesTotal, laborPool, locationLabel } from './ledger.js';
import { projectClient, projectTitle } from './projects.js';
import { getRegion } from './regions.js';
import { buildXlsx, fileStem, xlsxToFile } from './xlsx.js';

const head = (v) => ({ v, head: true });
const money = (v, bold = false) => ({ v, money: true, bold });
const bold = (v) => ({ v, bold: true });

const when = (ms, locale) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms)) : '');
// the date PRINTED on a receipt ('YYYY-MM-DD', no time zone: read at noon so no zone can move the day)
const whenDay = (iso, locale) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(`${iso}T12:00:00`)) : '');

/** Cash balance of one project: collected - expenses - advances to workers. */
export function projectBalance(project, budget) {
  const cash = cashSummary(budget ?? 0, project.payments);
  const spent = expensesTotal(project.expenses);
  const advanced = laborPool(0, project.advances).advanced;
  return { budget: budget ?? 0, paid: cash.paid, pending: cash.pending, spent, advanced, balance: Math.round((cash.paid - spent - advanced) * 100) / 100 };
}

/**
 * @param projects  projects to include (1 = individual rendición, several = consolidated)
 * @param totals    Map(projectId -> budget total with tax, or null when the quote is incomplete)
 * @param ctx       { t, locale, currency }
 * @returns [{ name, rows, widths }]
 */
export function buildRenditionSheets(projects, totals, { t, locale = 'es', currency = '' }) {
  const single = projects.length === 1;
  const withProject = (cells, p) => (single ? cells : [projectTitle(p) || t('proj.untitled'), ...cells]);
  const projCol = single ? [] : [head(t('xl.project'))];
  const widthsWith = (w) => (single ? w : [28, ...w]);

  // ---- summary ------------------------------------------------------------------------------------------
  const summary = [];
  if (single) {
    const p = projects[0];
    const b = projectBalance(p, totals.get(p.id));
    summary.push(
      [{ v: t('xl.title'), title: true }],
      [bold(t('xl.project')), projectTitle(p) || t('proj.untitled')],
      [bold(t('xl.client')), projectClient(p) || ''],
      [bold(t('xl.dates')), [p.startDate, p.endDate].filter(Boolean).join(' → ')],
      [bold(t('xl.location')), locationLabel(p.location)],
      [bold(t('xl.currency')), currency],
      [],
      [head(t('xl.concept')), head(t('xl.amount'))],
      [t('xl.budget'), money(b.budget)],
      [t('xl.paid'), money(b.paid)],
      [t('xl.pending'), money(b.pending)],
      [t('xl.expenses'), money(b.spent)],
      [t('xl.advances'), money(b.advanced)],
      [bold(t('xl.balance')), money(b.balance, true)]
    );
  } else {
    summary.push(
      [{ v: t('xl.titleGlobal'), title: true }],
      [],
      [head(t('xl.project')), head(t('xl.client')), head(t('xl.currency')), head(t('xl.budget')), head(t('xl.paid')), head(t('xl.pending')), head(t('xl.expenses')), head(t('xl.advances')), head(t('xl.balance'))]
    );
    const sum = { budget: 0, paid: 0, pending: 0, spent: 0, advanced: 0, balance: 0 };
    for (const p of projects) {
      const b = projectBalance(p, totals.get(p.id));
      for (const k of Object.keys(sum)) sum[k] += b[k];
      summary.push([projectTitle(p) || t('proj.untitled'), projectClient(p) || '', getRegion(p.draft.regionCode)?.currency ?? '', money(b.budget), money(b.paid), money(b.pending), money(b.spent), money(b.advanced), money(b.balance)]);
    }
    // one grand total only when every project is in the same currency: summing different currencies is meaningless
    const currencies = new Set(projects.map((p) => getRegion(p.draft.regionCode)?.currency));
    if (currencies.size === 1) {
      summary.push([bold(t('xl.total')), '', [...currencies][0], money(sum.budget, true), money(sum.paid, true), money(sum.pending, true), money(sum.spent, true), money(sum.advanced, true), money(sum.balance, true)]);
    }
  }

  // ---- detail sheets ---------------------------------------------------------------------------------------
  const expenses = [[...projCol, head(t('xl.date')), head(t('xl.supplier')), head(t('xl.description')), head(t('xl.category')), head(t('xl.quantity')), head(t('xl.unitPrice')), head(t('xl.amount')), head(t('xl.currency')), head(t('xl.returnDate')), head(t('xl.returned'))]];
  const payments = [[...projCol, head(t('xl.date')), head(t('xl.note')), head(t('xl.amount'))]];
  const advances = [[...projCol, head(t('xl.date')), head(t('xl.worker')), head(t('xl.amount'))]];
  const logbook = [[...projCol, head(t('xl.date')), head(t('xl.entry'))]];
  for (const p of projects) {
    for (const e of p.expenses) {
      // one row per receipt line: printed date (else the day it was saved), shop, product, type, quantity, unit price, line total, currency
      const cur = e.currency || getRegion(p.draft.regionCode)?.currency || currency;
      expenses.push(withProject([whenDay(e.date, locale) || when(e.at, locale), e.supplier, e.description, t(`exp.cat.${e.category}`), e.quantity ?? '', e.unitPrice ? money(e.unitPrice) : '', money(e.amount), cur, e.returnDate, e.returnDate ? t(e.returned ? 'common.yes' : 'common.no') : ''], p));
    }
    for (const x of p.payments) payments.push(withProject([when(x.at, locale), x.note, money(x.amount)], p));
    for (const x of p.advances) advances.push(withProject([when(x.at, locale), x.worker, money(x.amount)], p));
    for (const x of p.logbook) logbook.push(withProject([when(x.at, locale), x.text], p));
  }

  return [
    { name: t('xl.sheet.summary'), rows: summary, widths: single ? [22, 28] : [28, 22, 10, 16, 16, 16, 16, 16, 16] },
    { name: t('xl.sheet.expenses'), rows: expenses, widths: widthsWith([14, 24, 36, 22, 10, 14, 14, 9, 14, 10]) },
    { name: t('xl.sheet.payments'), rows: payments, widths: widthsWith([14, 36, 14]) },
    { name: t('xl.sheet.advances'), rows: advances, widths: widthsWith([14, 26, 14]) },
    { name: t('xl.sheet.logbook'), rows: logbook, widths: widthsWith([14, 80]) },
  ];
}

/** The .xlsx File of the rendición for these projects. */
export function buildRenditionFile(projects, totals, ctx) {
  const sheets = buildRenditionSheets(projects, totals, ctx);
  const bytes = buildXlsx(sheets, { digits: ctx.digits ?? 2 });
  const day = new Date().toISOString().slice(0, 10);
  const stem = projects.length === 1 ? fileStem(projectTitle(projects[0]), 'obra') : fileStem(ctx.t('xl.file.global'), 'global');
  return xlsxToFile(bytes, `${fileStem(ctx.t('xl.file.prefix'), 'rendicion')}-${stem}-${day}.xlsx`);
}
