// Report PDF pipeline used by the summary screen. Everything here is a PURE function of its inputs: the
// document `kind` ('client' | 'tech') is fixed by the caller when the user taps and is the only thing
// that decides which model and renderer run, so switching tabs while a PDF is being generated can never
// mix the two reports. Sharing goes through the native Web Share API (the real file when the browser allows it; no custom menu).

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
 * Open the NATIVE share sheet (navigator.share) whenever the browser has it.
 *  1. the browser can share files  -> the PDF itself is attached ('shared')
 *  2. it has share() but refuses files (some desktop / older mobile browsers) -> the same native sheet is
 *     opened with the title and a short text instead of silently downloading ('shared-text'); the PDF is
 *     then still available through "Descargar PDF"
 *  3. no navigator.share at all (or the gesture expired) -> 'unsupported': the caller downloads the file.
 * Closing the sheet is not an error ('cancelled').
 * @returns 'shared' | 'shared-text' | 'cancelled' | 'unsupported'
 */
export async function sharePdfFile(file, { title, text = '' }, nav = typeof navigator === 'undefined' ? null : navigator) {
  if (!nav || typeof nav.share !== 'function') return 'unsupported';
  const textPayload = () => ({ title, ...(text ? { text } : {}) });
  const run = async (payload, ok) => {
    await nav.share(payload);
    return ok;
  };
  try {
    if (canShareFile(file, nav)) {
      try {
        return await run({ files: [file], title }, 'shared');
      } catch (err) {
        // files refused at the last moment: fall through to the text-only native sheet
        if (err?.name !== 'NotSupportedError' && err?.name !== 'TypeError') throw err;
      }
    }
    return await run(textPayload(), 'shared-text');
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled'; // the user closed the sheet: not an error
    if (err?.name === 'NotAllowedError' || err?.name === 'NotSupportedError' || err?.name === 'TypeError') return 'unsupported'; // gesture expired / nothing shareable
    throw err;
  }
}
