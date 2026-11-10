// "Expediente" export: a human-readable, per-project folder tree in the user's Google Drive, readable from a laptop.
//
//   CUBRAX - Respaldos Obra /
//     cubrax-backup.json
//     Rendiciones_Globales /       the consolidated Sheet
//     Proyectos /
//       <project name> /           FLAT: everything of the project lives directly here, one level, no subfolders
//         rendicion-<project>      the live Sheet
//         Informe-....pdf          the PDF reports
//         Obra_<day>_<n>.jpg       Cámara de Obra photos
//         Bitacora_<day>_....jpg   photos of the logbook notes
//         Comprobante_<day>_....jpg  the photos of the receipts behind the expenses
//
// NOTHING of the expediente is ever created outside its folder: every upload is born with `parents: [projectFolder]` (see syncDossier), in ONE request.
// Everything is idempotent: a second sync never duplicates a folder or a file (same names; a photo whose name and size already match is not sent again).
// Folder ids are cached by the Drive client. The photos go up IN SINGLE FILE: one at a time, in order (a `for...of` with an `await`, never a Promise.all), each one
// read from the device only when its turn comes, so a phone never holds more than one image in memory, a burst never fights for the line and Google's rate
// limits are respected. Two syncs never run at once either (a queue per Drive client, see `inLine`).

import { dataUrlToBlob } from './blobs.js';
import { DriveError, isFolderId } from './drive.js';
import { cleanCaption } from './photos.js';

export const PROJECTS_FOLDER = 'Proyectos';
export const GLOBAL_RENDITIONS_FOLDER = 'Rendiciones_Globales'; // CUBRAX - Respaldos Obra / Rendiciones_Globales / Rendicion_Global_<date>.xlsx
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
/** The id of a note / receipt as a file name fragment, WHOLE: 6 random characters + the millisecond clock of its creation (ledger.js newEntryId), so two photos taken in the
 *  same second never share a name. It is stored with the entry, so a second sync derives the very same name (idempotent: nothing is uploaded twice). */
const idPart = (id) => String(id ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
/** The capture instant in whole milliseconds ('' when unknown). */
const msPart = (at) => (Number(at) > 0 ? String(Math.round(Number(at))) : '');

const bytesOfBlob = async (blob) => (blob && typeof blob.arrayBuffer === 'function' ? new Uint8Array(await blob.arrayBuffer()) : null);

/**
 * The image files of a project, as lazy items: { name, mimeType, load() -> Uint8Array | null }. Nothing is read from the device
 * until the upload of that very file starts.
 * @param sources {
 *   cameraPhotos: () => Promise<[{slot, dataUrl, at, description?}]>      Cámara de Obra (the caption travels with the file as its Drive description)
 *   notePhoto: (noteId) => Promise<{blob, at}|null>          photo of a logbook note
 *   receiptPhoto: (receiptId) => Promise<{blob, at}|null>    photo of a receipt
 * }
 * @returns {Promise<Item[]>}  one flat list: camera photos, logbook photos, receipts (their names tell them apart: Obra_ / Bitacora_ / Comprobante_, and each ends
 *                              with the millisecond stamp / the whole id of its photo: two photos never share a name)
 */
export async function collectDossierImages(project, { cameraPhotos = async () => [], notePhoto = async () => null, receiptPhoto = async () => null }) {
  const photos = [];
  for (const p of ((await cameraPhotos()) || []).filter(Boolean)) {
    const blob = dataUrlToBlob(p.dataUrl);
    if (!blob) continue;
    photos.push({
      name: `${joinName('Obra', ymd(p.at), String(Number(p.slot) + 1 || photos.length + 1), msPart(p.at))}.${extOf(blob.type)}`,
      mimeType: blob.type,
      description: cleanCaption(p.description), // '' = no caption (and a caption that was removed is removed in Drive too)
      load: async () => bytesOfBlob(blob),
    });
  }
  for (const note of project.logbook || []) {
    if (note?.photo !== true || typeof note.id !== 'string') continue;
    const mimeGuess = 'image/jpeg';
    photos.push({
      name: `${joinName('Bitacora', ymd(note.at), slug(note.text, 30), idPart(note.id))}.jpg`,
      mimeType: mimeGuess,
      load: async () => bytesOfBlob((await notePhoto(note.id))?.blob),
    });
  }
  const seen = new Set();
  for (const e of project.expenses || []) {
    if (!e.receiptId || seen.has(e.receiptId)) continue;
    seen.add(e.receiptId);
    const lines = project.expenses.filter((x) => x.receiptId === e.receiptId);
    const supplier = lines.find((x) => x.supplier)?.supplier || lines[0]?.description || '';
    photos.push({
      name: `${joinName('Comprobante', ymd(e.at), slug(supplier, 30), idPart(e.receiptId))}.jpg`,
      mimeType: 'image/jpeg',
      load: async () => bytesOfBlob((await receiptPhoto(e.receiptId))?.blob),
    });
  }
  return photos;
}

const STOP = new Set(['auth', 'offline', 'quota']); // errors that mean "stop sending", not "this file failed"

/**
 * Build / verify the project folder and upload the expediente of ONE project: EVERYTHING goes directly into it (flat).
 * @param client     createDriveClient(...) (ensureFolderPath, listFiles, uploadFile, upsertSpreadsheet, forgetFolders)
 * @param title      the folder name (the project's name)
 * @param documents  () => Promise<[{ name, mimeType, bytes } | { name, sheets }]>  PDFs (bytes) and live Google Sheets (pure-value tabs) for the project folder (an empty list is fine)
 * @param images     Item[]                                       from collectDossierImages (photos and receipts, all to the same folder)
 * @param onProgress ({ done, total }) => void                    called after every file
 * @returns {Promise<{ folderId, documents, uploaded, unchanged, failed, total }>} throws a DriveError for auth / offline / quota
 */
export function syncDossier(args) {
  return inLine(args.client, () => syncDossierNow(args));
}

// QUEUE LOCK of the uploads: one sync at a time per Drive client (the global `isSyncing`). A second sync that is asked for while the first one is still sending does NOT
// run in parallel (both would list the folder before the other's photos existed and then upload the same names twice): it WAITS for its turn and then runs with its own,
// fresher list of photos. A sync that fails never blocks the ones behind it.
const lines = new WeakMap(); // Drive client -> the tail of its queue
function inLine(client, job) {
  const key = client && typeof client === 'object' ? client : lines;
  const run = (lines.get(key) || Promise.resolve()).then(job, job);
  lines.set(key, run.catch(() => {}));
  return run;
}

async function syncDossierNow({ client, title, documents = async () => [], images = [], onProgress = () => {} }) {
  const attempt = async () => {
    const projectFolder = await client.ensureFolderPath([PROJECTS_FOLDER, folderNameFor(title)]);
    // ATOMIC SAFE CREATION: nothing goes up until the project folder is a REAL folder id. Every photo / PDF is then created with `parents: [projectFolder]` in the
    // metadata of its own upload request (drive.js, uploadFile): never in the root of the Drive, never moved afterwards. One folder, one listing.
    if (!isFolderId(projectFolder)) throw new DriveError('bad_response');
    const existing = await client.listFiles(projectFolder);
    const photos = Array.isArray(images) ? images : [];

    const docs = (await documents()) || [];
    const total = docs.length + photos.length;
    const stats = { folderId: projectFolder, documents: 0, uploaded: 0, unchanged: 0, failed: 0, total };
    let done = 0;
    let fatal = null;
    const tick = () => {
      done += 1;
      onProgress({ done, total });
    };

    // the documents: always replaced (their content moves with the project). A Google Sheet (`doc.sheets`) is refreshed IN PLACE (found by name:
    // never a copy) and goes LAST, after the photos: it needs the extra Sheets scope, and a device that has not granted it yet must not hold back the rest.
    const isSheet = (d) => Array.isArray(d.sheets);
    const sendDoc = async (doc) => {
      if (fatal) return;
      try {
        if (isSheet(doc)) await client.upsertSpreadsheet(projectFolder, { title: doc.name, sheets: doc.sheets });
        else await client.uploadFile(projectFolder, { ...doc, existingId: existing.get(doc.name)?.id || '' });
        stats.documents += 1;
      } catch (err) {
        if (STOP.has(err?.code) || err?.status === 404) fatal = err;
        else stats.failed += 1;
      }
      tick();
    };
    for (const doc of docs.filter((d) => !isSheet(d))) await sendDoc(doc);

    // the photos: IN SINGLE FILE (one at a time, in order). A photo counts as uploaded ONLY when its own `uploadFile` has answered with success; a file whose name and
    // size are already in the folder is not sent again. A photo that fails is counted as failed and the next one still gets its turn.
    const taken = new Set(); // names used by THIS run: two photos of one burst never share a name, so the second can never overwrite the first
    const uniqueName = (name) => {
      let out = name;
      for (let i = 2; taken.has(out); i += 1) out = name.replace(/(\.[^.]*)?$/, `-${i}$1`);
      taken.add(out);
      return out;
    };
    const sendPhotos = async () => {
      for (const item of photos) {
        if (fatal) return;
        try {
          const fileName = uniqueName(item.name);
          const bytes = await item.load();
          if (!bytes || !bytes.length) {
            stats.failed += 1;
            continue;
          }
          const known = existing.get(fileName);
          // only the camera photos carry a caption (a string); the logbook / receipt photos have none: what Drive says about them is left alone
          const caption = typeof item.description === 'string' ? item.description : null;
          // the caption of a file that is ALREADY in Drive (edited afterwards): metadata only, the picture is not sent again. A failure here never fails the photo.
          const recaption = async () => {
            if (!known || caption === null || (known.description || '') === caption || typeof client.setDescription !== 'function') return;
            try {
              await client.setDescription(known.id, caption);
            } catch (err) {
              if (STOP.has(err?.code) || err?.status === 404) fatal = err; // otherwise silent: the next sync tries again
            }
          };
          if (known && known.size === bytes.length) {
            await recaption();
            stats.unchanged += 1;
            continue;
          }
          // a NEW file is born with its caption in the very same request (atomic: the context never lags behind the file)
          await client.uploadFile(projectFolder, { name: fileName, mimeType: item.mimeType, bytes, existingId: known?.id || '', description: caption || '' });
          if (known) await recaption();
          stats.uploaded += 1; // reached only after the upload of THIS photo succeeded
        } catch (err) {
          if (STOP.has(err?.code) || err?.status === 404) fatal = err; // no coverage / no session / rate limit: stop, do not hammer
          else stats.failed += 1;
        } finally {
          tick();
        }
      }
    };
    if (!fatal) await sendPhotos();
    for (const doc of docs.filter(isSheet)) await sendDoc(doc);
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
