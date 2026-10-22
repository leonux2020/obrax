// Report PDF pipeline used by the summary screen. Everything here is a PURE function of its inputs: the
// document `kind` ('client' | 'tech') is fixed by the caller when the user taps and is the only thing
// that decides which model and renderer run, so switching tabs while a PDF is being generated can never
// mix the two reports. Sharing goes through the native Web Share API with the real file (no custom menu).

import { buildClientModel, buildTechModel } from './reports.js';
import { pdfFileName, pdfMoneyFormatter, rasterizeLogo, renderClientPdf, renderTechPdf } from './pdf.js';
import { ICON_DATA_URI } from '../brand/icon.js';

export const REPORT_KINDS = Object.freeze(['client', 'tech']);

/** Tab ("view") shown on screen -> document kind. The download / share button always follows the open tab. */
export const kindForView = (view) => (view === 'tech' ? 'tech' : 'client');

/** Warm the jsPDF chunk so generating (and the share user-gesture window) is fast on first use. */
export const warmPdfEngine = () => import('jspdf').catch(() => null);

/** Company logo as a PNG data URL for the PDF header; the Obrax icon only when there is none / it fails. */
async function pdfLogo(company) {
  const own = typeof company?.logo === 'string' && company.logo ? await rasterizeLogo(company.logo) : null;
  return own || rasterizeLogo(ICON_DATA_URI);
}

/**
 * Build ONE document.
 * @param kind 'client' | 'tech'
 * @param inputs {draft, result, company, i18n, photos} - `photos` = report photos already labelled
 * @returns {{doc, fileName, title, kind}}
 */
export async function createReportPdf(kind, { draft, result, company, i18n, photos = [] }) {
  if (!REPORT_KINDS.includes(kind)) throw new Error(`unknown report kind: ${kind}`);
  const { t, region, locale, num, unit, date } = i18n;
  const ctx = { draft, result, company, region, t, num, unit, date };
  const money = pdfMoneyFormatter(region, locale);
  const base = { money, logo: await pdfLogo(company), appName: t('app.name') };

  let doc;
  if (kind === 'client') {
    doc = await renderClientPdf(buildClientModel(ctx), {
      ...base,
      photos: draft.attachPhotos ? photos : [],
      photosTitle: t('photo.pdfClientTitle'),
    });
  } else {
    doc = await renderTechPdf(buildTechModel({ ...ctx, money }), { ...base, t, num, photos });
  }
  const fileName = pdfFileName(kind === 'client' ? t('pdf.file.client') : t('pdf.file.tech'), draft.project.name);
  return { doc, fileName, title: t('report.shareTitle'), kind };
}

/** jsPDF document -> real File (what the system share sheet needs to attach to WhatsApp / e-mail). */
export function pdfToFile(doc, fileName) {
  return new File([doc.output('arraybuffer')], fileName, { type: 'application/pdf' });
}

export function canShareFile(file, nav = typeof navigator === 'undefined' ? null : navigator) {
  if (!nav || typeof nav.share !== 'function') return false;
  return typeof nav.canShare !== 'function' || nav.canShare({ files: [file] });
}

/**
 * Open the native share sheet with the PDF.
 * @returns 'shared' | 'cancelled' | 'unsupported' - on 'unsupported' the caller falls back to a download.
 */
export async function sharePdfFile(file, { title }, nav = typeof navigator === 'undefined' ? null : navigator) {
  if (!canShareFile(file, nav)) return 'unsupported';
  try {
    await nav.share({ files: [file], title });
    return 'shared';
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled'; // the user closed the sheet: not an error
    if (err?.name === 'NotAllowedError' || err?.name === 'NotSupportedError') return 'unsupported'; // gesture expired / files refused
    throw err;
  }
}
