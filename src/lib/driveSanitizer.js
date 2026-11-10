// The silent concierge of the user's Google Drive ("Auto-Healing"): after a good sync, in the background, it puts away what older versions (or a death
// between two steps) left lying around, so that "Mi unidad" ends up clean without the user ever lifting a finger.
//
//   MISSION A  the backup. Every `cubrax-backup.json` of the Drive is looked at: the NEWEST one stays, inside the master folder "CUBRAX - Respaldos Obra"
//              (moved in with addParents / removeParents when it was in the root or in the legacy "CUBRAX" folder); the rest go to the TRASH.
//   MISSION B  the rendición Sheets. A Spreadsheet of the app lying in the root of the Drive is identified by its name (`rendicion-<obra>`), moved into the
//              folder of its project (found or created inside CUBRAX / Proyectos; the consolidated one into Rendiciones_Globales) and, when a Sheet with
//              that very name is already there, the Highlander rule applies: the most recent one stays, the other goes to the trash.
//   MISSION B2 the legacy Excel. The .xlsx files of the old versions (`rendicion-<obra>-<day>.xlsx`, `Rendicion_<day>.xlsx`, `Rendicion_Global_<day>.xlsx`), in the
//              root OR in any project folder, go straight to the trash: the live Google Sheets are the source of truth now. Matched by the Excel mimeType or
//              the .xlsx extension AND the name pattern of our rendiciones; any other .xlsx is not ours and is left alone.
//
// Safe by construction:
//   - Drive only shows the files this app created (scope drive.file) and every query adds `'me' in owners`: nothing else of the user's Drive is visible.
//   - Nothing is ever deleted: the trash keeps it 30 days. A backup is never trashed while the one that stays looks empty.
//   - A Sheet whose name is not ours (no known prefix) is left alone; one of ours that belongs to no known project goes to the master folder (out of the root).
//   - It never throws, never opens a window and never touches the UI: a failure (network, permissions, quota) is swallowed and tried again next time.
//   - Privacy first: no wider scope. Files created before the current OAuth Client ID (or by hand) are invisible to the app and need a manual clean-up.
//   - DEVELOPER LOG (temporary, rollout phase): every file Drive shows to the app and what was decided about it (KEEP / MOVE / TRASH / IGNORE) is printed
//     in DevTools with the prefix "[Conserje Drive]" (TIDY.verbose).
//   - Mutations run through client.serial, so they cannot interleave with the save of the backup.
// No React, no browser: the Drive client is injected.

import { GLOBAL_RENDITIONS_FOLDER, PROJECTS_FOLDER, folderNameFor } from './driveExport.js';
import { fileStem } from './sheetData.js';

export const TIDY_KEY = 'cp.drive.tidy.v1';
// everyMs: 0 = ROLLOUT PHASE, it runs in the first sync of EVERY session (the persisted 12 h gate is off). Back to `12 * 3_600_000` when the Drives are tidy.
// verbose: the developer log in DevTools (see sanitizeDrive); switch it off with the gate above when the rollout is over.
export const TIDY = Object.freeze({ everyMs: 0, verbose: true, maxMutations: 40, maxFolders: 200 });

/** `xl.file.prefix` / `xl.file.global` of every language (a test keeps them in sync with the dictionaries): "rendicion-<obra>", "rendicion-consolidado". */
export const RENDITION_PREFIXES = Object.freeze(['rendicion', 'statement', 'prestacao', 'reddition', 'rendiconto', 'abrechnung']);
export const GLOBAL_WORDS = Object.freeze(['consolidado', 'consolidated', 'consolide', 'consolidato', 'konsolidiert']);

const STOP = new Set(['auth', 'offline', 'quota']); // the line is dead / Google says no: the rest of the run would fail the same way

const ms = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};
const newestFirst = (a, b) => ms(b.modifiedTime) - ms(a.modifiedTime);
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * Where does a Spreadsheet of the rendición belong, by its name?
 * @returns {{ kind: 'global' } | { kind: 'project', candidate } | { kind: 'unknown' } | null}  null = not one of ours (it is left alone)
 * @param candidates [{ name, stem }]  the projects (their stem is fileStem(name), the way renditionTitle builds the title)
 */
export function classifySheet(title, candidates = []) {
  const lower = String(title ?? '').trim().toLowerCase();
  const prefix = RENDITION_PREFIXES.find((p) => lower.startsWith(`${p}-`));
  if (!prefix) return null;
  const rest = lower.slice(prefix.length + 1).trim();
  if (!rest) return null; // "rendicion-" alone names nothing
  if (GLOBAL_WORDS.includes(rest)) return { kind: 'global' };
  // the longest stem wins ("Casa-Norte" before "Casa")
  const match = [...candidates].filter((c) => c.stem && c.stem.toLowerCase() === rest).sort((a, b) => b.stem.length - a.stem.length)[0];
  return match ? { kind: 'project', candidate: match } : { kind: 'unknown' };
}

const LEGACY_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Is this an Excel file of the old rendiciones? (.xlsx by mimeType or extension, named `<prefix>-...` / `<prefix>_...`, any case: Rendicion_Global_2026-10-30.xlsx) */
export function isLegacyRendition(file) {
  const name = String(file?.name ?? '').trim();
  const excel = file?.mimeType === LEGACY_XLSX || /\.xlsx$/i.test(name);
  if (!excel) return false;
  const lower = name.toLowerCase();
  return RENDITION_PREFIXES.some((p) => lower.startsWith(`${p}-`) || lower.startsWith(`${p}_`));
}

/** The names of the projects the app knows plus the folders already in Drive, as unique candidates [{ name, stem, id? }] (a Drive folder wins: it exists). */
export function projectCandidates(appNames = [], driveFolders = []) {
  const byStem = new Map();
  for (const name of appNames) {
    if (typeof name !== 'string') continue;
    const clean = folderNameFor(name, '');
    const stem = fileStem(name, '');
    if (clean && stem && !byStem.has(stem.toLowerCase())) byStem.set(stem.toLowerCase(), { name: clean, stem });
  }
  for (const f of driveFolders) {
    const stem = fileStem(f.name, '');
    if (stem) byStem.set(stem.toLowerCase(), { name: f.name, stem, id: f.id }); // the real folder, with its id
  }
  return [...byStem.values()];
}

/** Every decision about a file, for the developer log: { action: KEEP | MOVE | TRASH | IGNORE, why }. */
const decide = (report, file, action, why) => {
  report.decisions.push({ action, why, id: file.id, name: file.name, mimeType: file.mimeType || '', parents: (file.parents || []).join(','), modified: file.modifiedTime || '' });
};

const safe = async (fn, report, key) => {
  try {
    await fn();
    return true;
  } catch (err) {
    report.errors.push(`${key}:${typeof err?.code === 'string' ? err.code : 'error'}`);
    if (STOP.has(err?.code)) report.stopped = true;
    return false;
  }
};

/** MISSION A. */
async function tidyBackups(client, report, budget) {
  const found = (await client.findBackups()).sort(newestFirst);
  if (!found.length) return;
  const [keep, ...rest] = found;
  const master = await client.ensureFolder(); // only now: a Drive with no backup never gets a folder from the concierge
  report.backup.kept = keep.id;
  if (keep.parents.length !== 1 || keep.parents[0] !== master) {
    if (budget.take()) {
      await client.moveFile(keep.id, master);
      report.backup.moved += 1;
      decide(report, keep, 'MOVE', 'newest backup: into the master folder');
    }
  } else decide(report, keep, 'KEEP', 'newest backup, already in the master folder');
  if (keep.size <= 0) {
    for (const old of rest) decide(report, old, 'IGNORE', 'the newest backup looks empty: the older copies are not trashed');
    return; // the newest looks empty: the older ones may be the only good copy, nothing is trashed
  }
  for (const old of rest) {
    if (!budget.take()) {
      decide(report, old, 'IGNORE', 'run budget used up: next run');
      continue;
    }
    if (await safe(() => client.trashFile(old.id), report, 'trash-backup')) {
      report.backup.trashed += 1;
      decide(report, old, 'TRASH', 'older duplicate backup');
    } else decide(report, old, 'IGNORE', 'could not be trashed (see errors)');
    if (report.stopped) break;
  }
}

/** MISSION B. */
async function tidySheets(client, report, budget, appNames) {
  const orphans = (await client.listSheets('root')).sort(newestFirst);
  if (!orphans.length) return;
  const master = await client.ensureFolder();
  const projectsFolder = await client.ensureChildFolder(master, PROJECTS_FOLDER);
  const candidates = projectCandidates(appNames, await client.listFolders(projectsFolder));
  const inFolder = new Map(); // folder id -> the Sheets known to be in it (kept up to date as we move / trash)
  const sheetsOf = async (folder) => {
    if (!inFolder.has(folder)) inFolder.set(folder, await client.listSheets(folder));
    return inFolder.get(folder);
  };

  for (const orphan of orphans) {
    if (report.stopped || !budget.take()) break;
    const where = classifySheet(orphan.name, candidates);
    if (!where) {
      report.sheets.left += 1; // not one of ours
      decide(report, orphan, 'IGNORE', 'a Google Sheet in the root whose name is not a rendición of ours');
      continue;
    }
    await safe(async () => {
      let folder = master;
      if (where.kind === 'global') folder = await client.ensureFolderPath([GLOBAL_RENDITIONS_FOLDER]);
      else if (where.kind === 'project') folder = where.candidate.id || (await client.ensureFolderPath([PROJECTS_FOLDER, where.candidate.name]));
      else report.sheets.unknown += 1;

      // Highlander: the same name already in that folder -> the most recent one stays, the other goes to the trash
      const list = await sheetsOf(folder);
      const twins = list.filter((x) => same(x.name, orphan.name)).sort(newestFirst);
      const best = twins[0];
      if (best && ms(best.modifiedTime) >= ms(orphan.modifiedTime)) {
        await client.trashFile(orphan.id); // what is already in place is newer (or the same): the orphan is the old copy
        report.sheets.trashed += 1;
        decide(report, orphan, 'TRASH', `Highlander: a newer "${best.name}" is already in place (${best.id})`);
        return;
      }
      await client.moveFile(orphan.id, folder);
      report.sheets.moved += 1;
      decide(report, orphan, 'MOVE', `${where.kind === 'global' ? 'consolidated rendición' : where.kind === 'project' ? 'rendición of its project' : 'rendición of no known project'} -> folder ${folder}`);
      list.push({ ...orphan, parents: [folder] });
      for (const old of twins) {
        if (!budget.take()) break;
        await client.trashFile(old.id);
        report.sheets.trashed += 1;
        decide(report, old, 'TRASH', `Highlander: replaced by the newer ${orphan.id}`);
        list.splice(list.indexOf(old), 1);
      }
    }, report, 'sheet');
  }
}

/** The developer log: console.log with a clear prefix (a table for lists). */
function consoleLog(label, payload) {
  if (typeof console === 'undefined') return;
  console.log(`[Conserje Drive] ${label}`, payload);
  if (Array.isArray(payload) && payload.length && typeof console.table === 'function') console.table(payload);
}

/** What Drive shows the app BEFORE anything is touched (the census): never throws, [] when it cannot be read. */
async function takeCensus(client, say) {
  try {
    return typeof client.listVisible === 'function' ? await client.listVisible() : [];
  } catch (err) {
    say('census failed', typeof err?.code === 'string' ? err.code : 'error');
    return [];
  }
}

/** Every file Drive showed the app and what was decided about it (anything nobody touched is listed as IGNORE: "seen, nothing to do"). */
function showCensus(visible, report, say) {
  const decided = new Map(report.decisions.map((d) => [d.id, d]));
  const rows = visible.map((f) => decided.get(f.id) || { action: 'IGNORE', why: 'seen, nothing to do (not an app file to tidy, or already in place)', id: f.id, name: f.name, mimeType: f.mimeType || '', parents: (f.parents || []).join(','), modified: f.modifiedTime || '' });
  for (const d of report.decisions) if (!rows.some((r) => r.id === d.id)) rows.push(d); // decided but not in the census
  say(`Drive shows ${visible.length} file(s) to this app (not counting folders); decisions:`, rows);
}

/** MISSION B2: the .xlsx of the old versions, wherever they are (root or project folders), straight to the trash. */
async function tidyLegacyExcel(client, report, budget) {
  const found = (await client.findExcelFiles()).sort(newestFirst);
  for (const file of found) {
    if (report.stopped) break;
    if (!isLegacyRendition(file)) {
      report.excel.left += 1;
      decide(report, file, 'IGNORE', 'an .xlsx whose name is not a rendición of ours');
      continue;
    }
    if (!budget.take()) {
      decide(report, file, 'IGNORE', 'run budget used up: next run');
      continue;
    }
    if (await safe(() => client.trashFile(file.id), report, 'trash-excel')) {
      report.excel.trashed += 1;
      decide(report, file, 'TRASH', 'legacy Excel: the live Google Sheet is the source of truth now');
    } else decide(report, file, 'IGNORE', 'could not be trashed (see errors)');
  }
}

/**
 * Put the user's Drive in order. NEVER throws, never blocks the UI (call it without awaiting, from the background).
 * @param client  createDriveClient(...)
 * @param opts    { projectNames: () => string[] }   the names of the projects of the app (to recognise `rendicion-<obra>`; optional)
 * @param opts.log  (label, payload) => void   the developer log (default: console.log "[Conserje Drive]"); only used while TIDY.verbose is on
 * @returns {Promise<{ ok: boolean, stopped: boolean, backup: {kept, moved, trashed}, sheets: {moved, trashed, unknown, left}, excel: {trashed, left}, decisions: object[], errors: string[] }>}
 *   ok = both missions ran to the end (nothing to retry); false = a network / permission problem stopped it (tried again next time)
 */
export async function sanitizeDrive(client, { projectNames = () => [], log = consoleLog, verbose = TIDY.verbose } = {}) {
  const report = { ok: false, stopped: false, backup: { kept: '', moved: 0, trashed: 0 }, sheets: { moved: 0, trashed: 0, unknown: 0, left: 0 }, excel: { trashed: 0, left: 0 }, decisions: [], errors: [] };
  const say = (label, payload) => {
    if (!verbose) return;
    try {
      log(label, payload);
    } catch {
      /* a log can never break the concierge */
    }
  };
  try {
    if (!client || typeof client.findBackups !== 'function') return report;
    let left = TIDY.maxMutations;
    const budget = { take: () => (left > 0 ? ((left -= 1), true) : false) };
    const run = (task) => (typeof client.serial === 'function' ? client.serial(task) : task());
    let names = [];
    try {
      names = (projectNames() || []).filter((n) => typeof n === 'string');
    } catch {
      names = [];
    }
    const census = verbose ? await takeCensus(client, say) : [];
    say('start', { projects: names, note: 'Drive only shows the files this app created (scope drive.file); older / hand-made ones are invisible' });
    await run(() => safe(() => tidyBackups(client, report, budget), report, 'backup'));
    if (!report.stopped) await run(() => safe(() => tidySheets(client, report, budget, names), report, 'sheets'));
    if (!report.stopped) await run(() => safe(() => tidyLegacyExcel(client, report, budget), report, 'excel'));
    report.ok = !report.stopped && report.errors.length === 0;
    if (verbose) showCensus(census, report, say);
  } catch {
    /* the concierge is silent: whatever happens, the app carries on */
  }
  say('result', { ok: report.ok, stopped: report.stopped, backup: report.backup, sheets: report.sheets, excel: report.excel, errors: report.errors });
  return report;
}

const defer = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 15_000 }) : setTimeout(fn, 4_000));

/**
 * The background entry: deferred to an idle moment; `everyMs` gates it per device (persisted, TIDY.everyMs; 0 = rollout phase: every session's first sync);
 * the day is only marked when it finished cleanly (a failure because of the network / permissions is tried again at the next sync).
 * @returns {boolean} true when a run was scheduled
 */
export function scheduleSanitize(client, { storage = typeof localStorage === 'undefined' ? null : localStorage, now = Date.now, everyMs = TIDY.everyMs, projectNames, log, verbose, run = defer, sanitize = sanitizeDrive } = {}) {
  try {
    const last = Number(storage?.getItem(TIDY_KEY)) || 0;
    if (everyMs > 0 && last > 0 && now() - last < everyMs) return false; // everyMs 0 (the rollout phase): never gated, it runs in the first sync of every session
    run(async () => {
      const report = await sanitize(client, { projectNames, ...(log ? { log } : {}), ...(verbose === undefined ? {} : { verbose }) });
      if (report?.ok) {
        try {
          storage?.setItem(TIDY_KEY, String(now()));
        } catch {
          /* storage blocked: it simply runs again next time */
        }
      }
    });
    return true;
  } catch {
    return false;
  }
}
