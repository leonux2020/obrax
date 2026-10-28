// "Expediente" export: a human-readable, per-project folder tree in the user's Google Drive, readable from a laptop.
//
//   CUBRAX - Respaldos Obra /
//     Proyectos /
//       <project name> /          PDF (technical dossier) + Excel rendición (payments, expenses, advances, logbook)
//         Fotos Obra /            Cámara de Obra photos + the photos of the logbook notes (independent JPEG / PNG files)
//         Comprobantes /          the photos of the receipts behind the expenses (rendiciones)
//
// Disaster recovery (cubrax-backup.json in the root) is untouched: this is a second, readable copy. Everything is idempotent:
// a second sync never duplicates a folder or a file (same names; a photo whose name and size already match is not sent again).
// Folder ids are cached by the Drive client, and photos go up with a small concurrency (3 at a time) and are read from the
// device one by one, so a phone never holds more than a few images in memory and Google's rate limits are respected.

import { dataUrlToBlob } from './blobs.js';

export const PROJECTS_FOLDER = 'Proyectos';
export const PHOTOS_FOLDER = 'Fotos Obra';
export const RECEIPTS_FOLDER = 'Comprobantes';
export const EXPORT_CONCURRENCY = 3;

/** Run `fn(item, index)` over `items` with at most `limit` in flight (Promise.all over a small pool). Never rejects: [{ ok, value | error }]. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      try {
        out[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        out[i] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}

// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

/** A folder name that is the project's own name, safe for every operating system (the laptop may be Windows). */
export function folderNameFor(title, fallback = 'Proyecto') {
  const clean = String(title ?? '').replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80).trim();
  return clean || fallback;
}

/** ascii-only readable fragment for a file name: "Material dañado!" -> "Material-danado". */
export const slug = (text, max = 30) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');

const ymd = (at) => {
  const d = new Date(Number(at) > 0 ? Number(at) : 0);
  return Number.isNaN(d.getTime()) || !(Number(at) > 0) ? 'sin-fecha' : d.toISOString().slice(0, 10);
};
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const extOf = (mime) => EXT[String(mime).toLowerCase()] || 'jpg';
const joinName = (...parts) => parts.filter(Boolean).join('_');

const bytesOfBlob = async (blob) => (blob && typeof blob.arrayBuffer === 'function' ? new Uint8Array(await blob.arrayBuffer()) : null);

/**
 * The image files of a project, as lazy items: { name, mimeType, load() -> Uint8Array | null }. Nothing is read from the device
 * until the upload of that very file starts.
 * @param sources {
 *   cameraPhotos: () => Promise<[{slot, dataUrl, at}]>      Cámara de Obra
 *   notePhoto: (noteId) => Promise<{blob, at}|null>          photo of a logbook note
 *   receiptPhoto: (receiptId) => Promise<{blob, at}|null>    photo of a receipt
 * }
 * @returns {Promise<{ obra: Item[], comprobantes: Item[] }>}
 */
export async function collectDossierImages(project, { cameraPhotos = async () => [], notePhoto = async () => null, receiptPhoto = async () => null }) {
  const obra = [];
  for (const p of ((await cameraPhotos()) || []).filter(Boolean)) {
    const blob = dataUrlToBlob(p.dataUrl);
    if (!blob) continue;
    obra.push({ name: `${joinName('Obra', ymd(p.at), String(Number(p.slot) + 1 || obra.length + 1))}.${extOf(blob.type)}`, mimeType: blob.type, load: async () => bytesOfBlob(blob) });
  }
  for (const note of project.logbook || []) {
    if (note?.photo !== true || typeof note.id !== 'string') continue;
    const mimeGuess = 'image/jpeg';
    obra.push({
      name: `${joinName('Bitacora', ymd(note.at), slug(note.text, 30), note.id.slice(0, 6))}.jpg`,
      mimeType: mimeGuess,
      load: async () => bytesOfBlob((await notePhoto(note.id))?.blob),
    });
  }
  const comprobantes = [];
  const seen = new Set();
  for (const e of project.expenses || []) {
    if (!e.receiptId || seen.has(e.receiptId)) continue;
    seen.add(e.receiptId);
    const lines = project.expenses.filter((x) => x.receiptId === e.receiptId);
    const supplier = lines.find((x) => x.supplier)?.supplier || lines[0]?.description || '';
    comprobantes.push({
      name: `${joinName('Comprobante', ymd(e.at), slug(supplier, 30), e.receiptId.slice(0, 6))}.jpg`,
      mimeType: 'image/jpeg',
      load: async () => bytesOfBlob((await receiptPhoto(e.receiptId))?.blob),
    });
  }
  return { obra, comprobantes };
}

const STOP = new Set(['auth', 'offline', 'quota']); // errors that mean "stop sending", not "this file failed"

/**
 * Build / verify the folder tree and upload the expediente of ONE project.
 * @param client     createDriveClient(...) (ensureFolderPath, ensureChildFolder, listFiles, uploadFile, forgetFolders)
 * @param title      the folder name (the project's name)
 * @param documents  () => Promise<[{ name, mimeType, bytes }]>  PDF / Excel for the project folder (an empty list is fine)
 * @param images     { obra: Item[], comprobantes: Item[] }       from collectDossierImages
 * @param onProgress ({ done, total }) => void                    called after every file
 * @returns {Promise<{ folderId, documents, uploaded, unchanged, failed, total }>} throws a DriveError for auth / offline / quota
 */
export async function syncDossier({ client, title, documents = async () => [], images = { obra: [], comprobantes: [] }, concurrency = EXPORT_CONCURRENCY, onProgress = () => {} }) {
  const attempt = async () => {
    const projectFolder = await client.ensureFolderPath([PROJECTS_FOLDER, folderNameFor(title)]);
    const [obraFolder, receiptsFolder] = await Promise.all([client.ensureChildFolder(projectFolder, PHOTOS_FOLDER), client.ensureChildFolder(projectFolder, RECEIPTS_FOLDER)]);
    const [rootFiles, obraFiles, receiptFiles] = await Promise.all([client.listFiles(projectFolder), client.listFiles(obraFolder), client.listFiles(receiptsFolder)]);

    const docs = (await documents()) || [];
    const total = docs.length + images.obra.length + images.comprobantes.length;
    const stats = { folderId: projectFolder, documents: 0, uploaded: 0, unchanged: 0, failed: 0, total };
    let done = 0;
    let fatal = null;
    const tick = () => {
      done += 1;
      onProgress({ done, total });
    };

    // the documents: always replaced (their content moves with the project)
    for (const doc of docs) {
      if (fatal) break;
      try {
        await client.uploadFile(projectFolder, { ...doc, existingId: rootFiles.get(doc.name)?.id || '' });
        stats.documents += 1;
      } catch (err) {
        if (STOP.has(err?.code) || err?.status === 404) fatal = err;
        else stats.failed += 1;
      }
      tick();
    }

    // the images: 3 at a time; a file whose name and size are already in the folder is not sent again
    const sendAll = async (items, folder, existing) =>
      mapLimit(items, concurrency, async (item) => {
        if (fatal) return 'skipped';
        try {
          const bytes = await item.load();
          if (!bytes || !bytes.length) {
            stats.failed += 1;
            return 'failed';
          }
          const known = existing.get(item.name);
          if (known && known.size === bytes.length) {
            stats.unchanged += 1;
            return 'unchanged';
          }
          await client.uploadFile(folder, { name: item.name, mimeType: item.mimeType, bytes, existingId: known?.id || '' });
          stats.uploaded += 1;
          return 'uploaded';
        } catch (err) {
          if (STOP.has(err?.code) || err?.status === 404) fatal = err; // no coverage / no session / rate limit: stop, do not hammer
          else stats.failed += 1;
          return 'failed';
        } finally {
          tick();
        }
      });
    if (!fatal) await sendAll(images.obra, obraFolder, obraFiles);
    if (!fatal) await sendAll(images.comprobantes, receiptsFolder, receiptFiles);
    if (fatal) throw fatal;
    return stats;
  };

  try {
    return await attempt();
  } catch (err) {
    if (err?.status !== 404) throw err;
    client.forgetFolders(); // a cached folder was deleted from Drive: look everything up again, once
    return attempt();
  }
}
