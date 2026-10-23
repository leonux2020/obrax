// "Send the file now": the native share sheet (navigator.share) with the real file attached, or - where the
// browser cannot share files - a plain download, so the user always ends up with the document.

import { canShareFile } from './reportPdf.js';

export function downloadFile(file, doc = typeof document === 'undefined' ? null : document, urlApi = typeof URL === 'undefined' ? null : URL) {
  if (!doc || !urlApi?.createObjectURL) return false;
  const url = urlApi.createObjectURL(file);
  const a = doc.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => urlApi.revokeObjectURL?.(url), 4000);
  return true;
}

/**
 * @returns 'shared' | 'cancelled' | 'downloaded'
 *  - navigator.share + files supported -> the file goes straight to the native sheet ('shared')
 *  - the user closes the sheet -> 'cancelled' (not an error)
 *  - anything else (desktop, old browser, gesture expired) -> the file is downloaded instead
 */
export async function shareOrDownload(file, { title = '', text = '' } = {}, nav = typeof navigator === 'undefined' ? null : navigator) {
  if (nav && typeof nav.share === 'function' && canShareFile(file, nav)) {
    try {
      await nav.share({ files: [file], title, ...(text ? { text } : {}) });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      /* refused at the last moment: download below */
    }
  }
  downloadFile(file);
  return 'downloaded';
}
