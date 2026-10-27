// The three documents of the export sheet, as plain async functions (no React): the screen only calls them and shows
// the outcome. Same engines as the old project screen (reportPdf.js, rendition.js, shareFile.js).
//
//   'client'  PDF Cliente      Imprevistos and Utilidad are NOT shown: their money is prorated into the visible lines
//                              (reports.js buildClientModel). Generating it FREEZES the quote (prices + dates stop moving).
//   'tech'    PDF Contratista  the technical dossier: Imprevistos and Utilidad are itemised with their percentages.
//   'xlsx'    Excel Rendición  the accounting statement (payments, expenses, advances, balance).

import { freezeQuote } from './signature.js';
import { photosForReport } from './photos.js';
import { createReportPdf, pdfToFile } from './reportPdf.js';
import { buildRenditionFile } from './rendition.js';
import { shareOrDownload } from './shareFile.js';
import { projectTitle } from './projects.js';

export const EXPORT_KINDS = Object.freeze(['client', 'tech', 'xlsx']);

/**
 * @param kind  'client' | 'tech' | 'xlsx'
 * @param ctx   { project, result, total, priceTime, company, photos, i18n, setDraft }
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function runExport(kind, { project, result, total, priceTime, company, photos, i18n, setDraft }) {
  if (!EXPORT_KINDS.includes(kind)) throw new Error(`unknown export kind: ${kind}`);
  const { t, locale, region } = i18n;
  const draft = project.draft;

  if (kind === 'xlsx') {
    const file = buildRenditionFile([project], new Map([[project.id, result.valid ? total : null]]), { t, locale, currency: region.currency, digits: region.digits });
    return shareOrDownload(file, { title: t('xl.shareTitle', { name: projectTitle(project) || t('proj.untitled') }) });
  }

  if (!result.valid) throw new Error('quote incomplete');
  let frozen = draft;
  if (kind === 'client' && !draft.frozen && !draft.signature) {
    // the document handed to the client freezes the quote it shows
    frozen = freezeQuote(draft, { pricedAt: priceTime, total, live: project, book: result.book });
    if (frozen !== draft) setDraft(() => frozen);
  }
  const { doc, fileName, title } = await createReportPdf(kind, { draft: frozen, result, company, i18n, photos: photosForReport(photos, t) });
  return shareOrDownload(pdfToFile(doc, fileName), { title });
}
