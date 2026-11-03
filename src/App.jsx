import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { diffPhotos, emptySlots } from './lib/photos.js';
import { migrateLegacyPhotos, photoStoreFor } from './lib/photoStore.js';
import { notePhotosFor, readNotePhotos } from './lib/notePhotos.js';
import { receiptPhotosFor } from './lib/receiptPhotos.js';
import { paymentPhotosFor } from './lib/paymentPhotos.js';
import { projectStore } from './lib/projectStore.js';
import { logoStore } from './lib/companyStore.js';
import { hasIndexedDb } from './lib/db.js';
import { I18nProvider, makeI18n } from './lib/i18n.jsx';
import { getRegion, LANGS, REGIONS } from './lib/regions.js';
import { wipeLocalData } from './lib/session.js';
import { adoptCompany, cleanCityOrRegion, documentCompany, isClosed, newExtension, newProject, projectTitle, toDayString } from './lib/projects.js';
import { normalizeLocation } from './lib/ledger.js';
import { computeAll } from './lib/engine.js';
import { planningTimeline, pricingTime } from './lib/signature.js';
import { detectCurrentRegion, languageFor } from './lib/geo.js';
import { sanitizeText } from './lib/sanitize.js';
import {
  loadSettings,
  saveSettings,
  loadUser,
  saveUser,
  loadDraft,
  clearDraft,
  hasStoredDraft,
  newDraft,
  loadCompany,
  saveCompany,
  normalizeCompany,
  isCompanyEmpty,
  loadProfileMeta,
  saveProfileMeta,
} from './lib/draft.js';
import { ensureDriveToken, googleConfigured, GOOGLE_CONFIG_STATUS, localUser } from './lib/auth.js';
import { clearDriveToken, getDriveToken, isDriveLinked, needsDriveInteraction, subscribeDriveAuth } from './lib/driveToken.js';
import { createDriveClient } from './lib/drive.js';
import { createDriveSync, getSeenRemote, setSeenRemote } from './lib/driveSync.js';
import { mergeProjectLists, stampProject, stampProjects } from './lib/merge.js';
import { markDeleted, mergeTomb } from './lib/tombstones.js';
import { collectBackup, hasNoProjects, parseBackup, restoreBackup } from './lib/backup.js';
import { projectLimitReached } from './lib/pro.js';
import { usePro } from './lib/usePro.js';
import { usePriceFeed } from './lib/usePrices.js';
import { usePWA } from './pwa/usePWA.js';
import RegionSelect from './components/RegionSelect.jsx';
import Login from './components/Login.jsx';
import Header from './components/Header.jsx';
import Wizard from './components/Wizard.jsx';
import ProjectView from './components/ProjectView.jsx';
import ProjectWorkspace from './components/ProjectWorkspace.jsx';
import PostMortem from './components/PostMortem.jsx';
import { useHistoryBack } from './lib/useHistoryBack.js';
import ToastHost from './components/workspace/ToastHost.jsx';
import { isStandalone } from './pwa/installPrompt.js';
import { workspaceEnabled } from './lib/flags.js';
import { withMarket, quoteLock } from './lib/workspaceModel.js';
import { askNotifyPermission, pushToast, systemNotify, updateToast } from './lib/notify.js';
import { collectDossierImages, syncDossier } from './lib/driveExport.js';
import { receiptQueue } from './lib/receiptQueue.js';
import { exportQueue } from './lib/exportQueue.js';
import { closeGlobalRendition, closeRendition, uploadRendition } from './lib/exportSync.js';
import { useExportSync } from './lib/useExportSync.js';
import { projectTotals } from './lib/projectTotals.js';
import { addExpenses, registerBackgroundSync } from './lib/receiptSync.js';
import { dropDuplicateExpenses } from './lib/receipt.js';
import { useReceiptSync } from './lib/useReceiptSync.js';
import GlobalAccounting from './components/GlobalAccounting.jsx';
import AppShell from './components/AppShell.jsx';
import Dashboard from './components/Dashboard.jsx';
import BottomNav from './components/BottomNav.jsx';
import ProjectSheet from './components/ProjectSheet.jsx';
import SettingsView from './components/SettingsView.jsx';
import { clearOAuthResult, clearSignInResult, connectDrive, peekOAuthResult, peekSignInResult } from './lib/oauthCallback.js';
import { BackupStatusContext } from './lib/backupStatus.jsx';
import { EcoContext, useEcoBattery } from './lib/useEcoMode.jsx';
import { onWorkersChanged } from './lib/workers.js';
import SplashScreen from './components/SplashScreen.jsx';
import ProfileSetup from './components/ProfileSetup.jsx';
import ProPaywall from './components/ProPaywall.jsx';
import RestorePrompt from './components/RestorePrompt.jsx';

// Loads the saved projects and performs the one-off migration of the pre-dashboard single draft.
// It is shared (one in-flight promise) so React StrictMode's double effect — or a quick remount —
// can never migrate the same draft into two projects.
let bootPromise = null;
function bootProjects(region) {
  if (!bootPromise) {
    bootPromise = (async () => {
      let list = [];
      try {
        list = await projectStore.load();
      } catch {
        /* start empty: the app keeps working in memory */
      }
      if (!list.length && region && hasStoredDraft()) {
        const legacy = loadDraft(region);
        const untouched = JSON.stringify(legacy) === JSON.stringify(newDraft(region, legacy?.mode));
        if (legacy && !untouched) {
          let logoNow = '';
          try {
            logoNow = await logoStore.load();
          } catch {
            /* no logo */
          }
          const project = { ...newProject({ regionCode: region, company: loadCompany(), logo: logoNow, startDate: toDayString(new Date()) }), draft: legacy };
          try {
            await projectStore.save(project);
            if (hasIndexedDb()) await migrateLegacyPhotos(indexedDB, project.id);
          } catch {
            /* still shown below */
          }
          list = [project];
        }
        clearDraft();
      }
      return list;
    })();
  }
  return bootPromise;
}

/** Test hook: forget the shared boot so a fresh mount reads the store again. */
export const resetBoot = () => {
  bootPromise = null;
};

/** Back to the opening screen with a clean page load (the app lives at the site root). */
const goToStart = () => window.location.replace(import.meta.env?.BASE_URL || '/');

/** A visitor with no session, no onboarding mark and an empty company profile: the only one who needs a welcome / setup. */
const isNewProfile = (user, meta, company) => !user && !meta.onboarded && isCompanyEmpty(company);

const projectCompany = (project, company) => documentCompany(project.company, company);

export default function App({ onSignedOut = goToStart, installed = isStandalone() }) {
  const pwa = usePWA();
  const pro = usePro();
  const isEcoMode = useEcoBattery(); // battery <= 20 % and unplugged: animations off (class on <body>)
  // The interface follows the device's language (an Italian phone gets Italian) unless the user locked a language in the settings.
  const [settings, setSettings] = useState(() => {
    const stored = loadSettings();
    const lang = languageFor(stored);
    const base = lang === stored.lang ? stored : { ...stored, lang };
    // An installed app of a brand-new profile goes straight to the setup (no welcome screen to run `start()` for it): the country comes from the device here.
    if (installed && !base.region && isNewProfile(loadUser(), loadProfileMeta(), loadCompany())) {
      const code = detectCurrentRegion();
      if (code) return { ...base, region: code };
    }
    return base;
  });
  const [user, setUser] = useState(loadUser);
  const [company, setCompany] = useState(loadCompany); // global profile (text); the logo lives in IndexedDB
  const [logo, setLogo] = useState('');
  const [projects, setProjectsRaw] = useState(null); // null while loading from IndexedDB
  // Every change of the projects goes through here: the records that changed are stamped (`updatedAt`) and the deleted ones remembered (`tomb`),
  // which is what lets the Drive merge go record by record instead of "the newest project wins as a whole". Restores use the raw setter (already merged).
  const setProjects = useCallback(
    (update) =>
      setProjectsRaw((prev) => {
        const next = typeof update === 'function' ? update(prev) : update;
        return prev ? stampProjects(prev, next) : next;
      }),
    []
  );
  const [activeId, setActiveId] = useState(null); // null = dashboard
  // Google's answer after a full-page redirect (Drive consent), already validated and stripped of its token in main.jsx.
  const [oauth] = useState(peekOAuthResult);
  const [signInReturn] = useState(peekSignInResult); // the account chosen at Google after a full-page sign-in (installed apps never open a pop-up)
  const [meta, setMeta] = useState(() => {
    const m = loadProfileMeta(); // { onboarded, drive }
    return oauth?.granted && m.onboarded ? { ...m, drive: true } : m;
  });
  // Zero-latency boot, no timers, no fade: anybody who already has a profile or a session (installed app or browser tab) starts in the main
  // view: the black shell, then the projects as soon as IndexedDB answers. The OS already drew the logo (manifest icon) while the app loaded.
  // An INSTALLED app of a brand-new profile goes straight to the setup. Only a first visit in a browser tab meets the minimal welcome screen
  // ('splash': one "Iniciar" button), which is never part of an installed app's life.
  const [stage, setStage] = useState(() =>
    !isNewProfile(user, meta, company) ? 'app' : installed ? 'setup' : 'splash'
  );
  const [sheet, setSheet] = useState(null); // { type: 'new' | 'edit', id? }
  const [tab, setTab] = useState('projects'); // bottom navigation: 'projects' | 'accounting' | 'settings' (all three are top-level screens)
  const [dashTab, setDashTab] = useState('active'); // dashboard tabs: 'active' | 'history'
  const [editor, setEditor] = useState(false); // the technical editor (measures, prices, schedule) of the open project
  const [pickingRegion, setPickingRegion] = useState(false);
  const [paywall, setPaywall] = useState(null); // null | 'promo' | 'projects' | 'drive' | 'ai': which locked feature opened the PRO screen
  const [photos, setPhotos] = useState(emptySlots);
  const [wsOn] = useState(workspaceEnabled); // single-screen project workspace (flag, see lib/flags.js)

  const region = getRegion(settings.region);
  // live material / rental prices for the regions in use (the user's country + every project's); only inside the app
  // `projectLocations`: where the projects of each market are, so the AI is not asked for what the user's nearby suppliers cover
  const projectLocations = useMemo(() => {
    const out = {};
    for (const p of projects ?? []) (out[p.draft.regionCode] ||= []).push(p.location ? { lat: p.location.lat, lng: p.location.lng } : null);
    return out;
  }, [projects]);
  usePriceFeed(stage === 'app' ? [settings.region, ...(projects ?? []).map((p) => p.draft.regionCode)] : [], projectLocations);
  const active = useMemo(() => projects?.find((p) => p.id === activeId) ?? null, [projects, activeId]);
  const activeRef = useRef(null);
  const projectsRef = useRef([]); // always the latest list, readable from async callbacks (receipt sync)
  projectsRef.current = projects ?? projectsRef.current;
  const wipingRef = useRef(false); // true while signing out: nothing may be written back to the (erased) device
  activeRef.current = active;
  const restoreOfferRef = useRef(false); // true while the one-click restore sheet is on screen (the daemon leaves the held backup alone only then)
  const [restoreOffer, setRestoreOffer] = useState(false); // Drive holds a backup and this device has no work: the one-click restore sheet
  const latest = useRef(null); // the CURRENT state, read by the backup engine and the restore
  latest.current = { settings, company, meta, logo, projects };
  const backupOn = googleConfigured && meta.drive;
  restoreOfferRef.current = restoreOffer;
  const backupOnRef = useRef(false);
  backupOnRef.current = backupOn && !wipingRef.current;

  // ---- Google Drive backup (silent) ---------------------------------------------------------------------------
  const userRef = useRef(null);
  userRef.current = user;
  // a 401 (the token expired while working) renews it SILENTLY (no Google screen) and repeats the request: the user never notices
  const driveClient = useMemo(
    () =>
      createDriveClient({
        getToken: async () => getDriveToken(),
        refreshToken: () => ensureDriveToken({ interactive: false, hint: userRef.current?.email || '' }),
        onAuthRejected: () => clearDriveToken(),
      }),
    []
  );
  const pullRef = useRef(null); // pullFromDrive (defined with the restore code below)
  const sync = useMemo(
    () =>
      createDriveSync({
        client: driveClient,
        collect: () => collectBackup({ ...latest.current, projects: latest.current.projects || [], loadPhotos: (id) => photoStoreFor(id).load().catch(() => []), loadNotePhotos: (p) => readNotePhotos(notePhotosFor(p.id), p.logbook) }),
        // in the background Google is only asked (silently) when this device has been connected before
        ensureToken: ({ interactive }) => (interactive || isDriveLinked() ? ensureDriveToken({ interactive, hint: userRef.current?.email || '' }) : Promise.resolve(getDriveToken())),
        // BEFORE this device's copy replaces the Drive file, what other devices uploaded is pulled and merged in (a stale tablet can never crush the phone)
        beforePush: async ({ interactive }) => {
          const r = await pullRef.current?.({ interactive, inRound: true });
          if (r && !r.ok) throw Object.assign(new Error(`pull:${r.reason}`), { code: r.reason });
        },
        isEnabled: () => backupOnRef.current,
      }),
    [driveClient]
  );
  const [backup, setBackup] = useState(() => sync.getState());
  useEffect(() => sync.subscribe(setBackup), [sync]);
  // "This device is connected to Google Drive": a consent was given here before (or a copy has gone up)
  const [linkedNow, setLinkedNow] = useState(false);
  const offerRef = useRef(null); // offerRestore (defined with the restore code below)
  const driveLinked = linkedNow || backup.at > 0 || isDriveLinked() || Boolean(getDriveToken());
  // Google's own authorization (pop-up; full-page redirect when the browser blocks it). As soon as it is granted the exclusive folder is
  // created and the first backup goes up in the background (sync.flush: find / create "CUBRAX - Respaldos Obra", then upload).
  const connectAndBackup = useCallback(async () => {
    if (!googleConfigured) return { ok: false, reason: 'not_configured' };
    try {
      await connectDrive();
    } catch (err) {
      return { ok: false, reason: err?.code === 'redirect' ? 'redirect' : err?.code || 'denied' };
    }
    setLinkedNow(true);
    setMeta((m) => (m.drive ? m : { ...m, drive: true }));
    // a backup already in this Google account and nothing on this device: offer to restore it (uploads wait, so it is never overwritten)
    const offer = await offerRef.current?.();
    if (offer?.offered) return { ok: true, offered: true };
    sync.flush({ force: true }).catch(() => {}); // in the background and SILENT (the token was just granted): the card shows "Sincronizando…" then "Último respaldo"
    return { ok: true };
  }, [sync]);
  // The toggle: ON for an account that is not linked yet starts that authorization at once; if Google says no, it goes back to OFF.
  const changeDrive = useCallback(
    async (on) => {
      setMeta((m) => ({ ...m, drive: on }));
      if (!on || !googleConfigured || driveLinked) return { ok: true };
      const r = await connectAndBackup();
      if (!r.ok && r.reason !== 'redirect') setMeta((m) => ({ ...m, drive: false }));
      return r;
    },
    [connectAndBackup, driveLinked]
  );
  // came back from Google's full-page consent: put the first copy up (the folder is created if missing)
  const returnedBackup = useRef(false);
  useEffect(() => {
    if (!oauth?.granted || returnedBackup.current || projects === null || !googleConfigured || !meta.onboarded) return;
    returnedBackup.current = true;
    setLinkedNow(true);
    Promise.resolve(offerRef.current?.())
      .catch(() => null)
      .then((offer) => (offer?.offered ? null : sync.flush({ force: true }))) // an existing backup is offered first, never overwritten
      .catch(() => {});
  }, [oauth, projects, meta.onboarded, sync]);
  // No coverage: ONE discreet toast per offline episode ("the backup will be tried when the signal returns"); the pending change
  // is uploaded by itself when the browser reports the connection is back.
  useEffect(() => {
    let told = false;
    const off = sync.subscribe((st) => {
      if (st.status === 'pending' && st.reason === 'offline') {
        if (!told) pushToast({ key: 'backup.offline.toast', tone: 'amber', ms: 6000 });
        told = true;
      } else if (st.status === 'synced') told = false;
    });
    const online = () => {
      told = false;
      sync.retryNow().catch(() => {});
    };
    window.addEventListener('online', online);
    return () => {
      off();
      window.removeEventListener('online', online);
    };
  }, [sync]);

  // The Squadra directory lives in localStorage, outside React state: its writes tell the backup engine too (a worker edited = a change to protect)
  useEffect(() => onWorkersChanged(() => !wipingRef.current && !applyingPull.current && backupOnRef.current && sync.markDirty()), [sync]);
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveUser(user), [user]);
  useEffect(() => saveCompany(company), [company]);
  useEffect(() => saveProfileMeta(meta), [meta]);
  useEffect(() => clearOAuthResult(), []); // the answer is consumed once
  // Every change of projects / profile / settings / backup preference queues a silent Drive backup.
  const syncReady = useRef(false);
  const skipDirty = useRef(false); // the next change of `projects` is a pull from Drive: it does not mark the state dirty
  const applyingPull = useRef(false); // while a pull writes the Squadra directory, those writes are not "changes to upload"
  useEffect(() => {
    if (projects === null) return;
    if (!syncReady.current) {
      syncReady.current = true; // the first load is not a change; just resume anything left pending
      sync.resume();
      return;
    }
    if (skipDirty.current) {
      skipDirty.current = false; // the change is the merge with Drive itself (nothing new to upload by this alone)
      return;
    }
    if (!wipingRef.current) sync.markDirty();
  }, [projects, company, settings, meta, logo, sync]);
  // The camera photos live in IndexedDB, outside the project record, so adding / replacing / deleting one would leave the project looking
  // untouched to the sync engine. Every real change therefore STAMPS the open project (`updatedAt` = now), and a deletion also leaves a
  // `photoTomb` entry for its slot, so the other devices neither miss the change nor bring a deleted photo back.
  const photosRef = useRef(null);
  photosRef.current = photos;
  const changePhotos = useCallback(
    (update) => {
      const prev = photosRef.current ?? emptySlots();
      const next = typeof update === 'function' ? update(prev) : update;
      photosRef.current = next; // successive updates in the same tick build on each other
      setPhotos(next);
      const { changed, removed } = diffPhotos(prev, next);
      const id = activeRef.current?.id;
      if (changed && id && !wipingRef.current) {
        const now = Date.now();
        setProjects((list) =>
          (list || []).map((p) => (p.id !== id ? p : { ...p, ...(removed.length ? { photoTomb: mergeTomb(p.photoTomb, Object.fromEntries(removed.map((slot) => [String(slot), now])), 12) } : {}), updatedAt: Math.max(now, (p.updatedAt || 0) + 1) }))
        );
      }
      if (!wipingRef.current) sync.markDirty();
    },
    [sync, setProjects]
  );
  useEffect(() => {
    document.documentElement.lang = settings.lang;
  }, [settings.lang]);
  // the phone's language changed while the app was open (and the user never locked one): follow it
  useEffect(() => {
    const follow = () => setSettings((s) => (languageFor(s) === s.lang ? s : { ...s, lang: languageFor(s) }));
    window.addEventListener('languagechange', follow);
    return () => window.removeEventListener('languagechange', follow);
  }, []);

  // ---- boot: logo + projects (+ one-off migration of the pre-dashboard single draft) ----------------
  useEffect(() => {
    let alive = true;
    Promise.all([logoStore.load().catch(() => ''), bootProjects(settings.region)]).then(([l, list]) => {
      if (!alive) return;
      setLogo(l);
      setProjects(list);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- persistence of the open project (debounced) + flush when the page is hidden --------------------
  useEffect(() => {
    if (!active) return undefined;
    const id = setTimeout(() => !wipingRef.current && projectStore.save(active).catch(() => {}), 250);
    return () => clearTimeout(id);
  }, [active]);
  // `pagehide` alone is not reliable on mobile / installed PWAs (the OS often freezes or kills the page without it):
  // `visibilitychange -> hidden` is the last event that is guaranteed to run, so the open project is also flushed there.
  useEffect(() => {
    const flush = () => activeRef.current && !wipingRef.current && projectStore.save(activeRef.current).catch(() => {});
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // ---- project actions -------------------------------------------------------------------------------------
  const commit = useCallback((project) => {
    const stamped = stampProject(projectsRef.current?.find((p) => p.id === project.id), project); // records changed / deleted by this commit are marked for the merge
    setProjects((list) => (list.some((p) => p.id === stamped.id) ? list.map((p) => (p.id === stamped.id ? stamped : p)) : [stamped, ...list]));
    projectStore.save(stamped).catch(() => {});
  }, [setProjects]);

  // ---- deferred receipts (offline scanner) ---------------------------------------------------------------------
  // A receipt photographed without a connection waits in IndexedDB (receiptQueue). This global sync sends it to the AI
  // proxy when the network is back, writes the tabulated expenses into ITS project (open or not) and tells the user.
  const applyReceipt = useCallback(async (projectId, expenses, row) => {
    const target = projectsRef.current.find((p) => p.id === projectId);
    if (!target) return false; // the project was deleted meanwhile
    // Smart deduplication: a paper that is already in the project (same total + date + shop) is skipped silently, with a quiet toast
    const dedup = dropDuplicateExpenses(expenses, target.expenses);
    if (dedup.skipped) pushToast({ key: dedup.skipped === 1 ? 'rcpt.dup.one' : 'rcpt.dup.many', params: { n: dedup.skipped }, tone: 'info', ms: 5000 });
    expenses = dedup.fresh;
    if (row?.blob) {
      // the queued photo is kept with its lines (Comprobantes of the expediente) before the queue row is dropped
      try {
        await receiptPhotosFor(projectId).put(row.id, { blob: row.blob, at: row.createdAt });
        expenses = expenses.map((e) => ({ ...e, receiptId: row.id }));
      } catch {
        /* the expenses matter more than the picture */
      }
    }
    if (!expenses.length) return false; // nothing new: the queued photo is dropped, there is nothing to announce as saved
    const next = addExpenses(target, expenses);
    projectsRef.current = projectsRef.current.map((p) => (p.id === projectId ? next : p)); // two receipts in a row stack up
    setProjects((list) => list.map((p) => (p.id === projectId ? addExpenses(p, expenses) : p)));
    if (activeRef.current?.id !== projectId) projectStore.save(next).catch(() => {}); // the open project saves itself
    return true;
  }, []);
  const notifyUser = useCallback(
    ({ key, params, tone }) => {
      pushToast({ key, params, tone, ms: 6000 });
      const i18n = makeI18n(settings.lang, settings.region);
      systemNotify(i18n.t('app.name'), i18n.t(key, params));
    },
    [settings.lang, settings.region]
  );
  const receipts = useReceiptSync({ apply: applyReceipt, notify: notifyUser, enabled: stage === 'app' && projects !== null });
  const enqueueReceipt = useCallback(async (job) => {
    const row = await receiptQueue.enqueue(job);
    registerBackgroundSync(); // Chromium: wakes the page when the connection returns (the online event covers the rest)
    askNotifyPermission(); // we are inside the user's tap: the only moment the browser lets us ask
    return row;
  }, []);

  // Navigation context of the detail view: opened from Proyectos = tactical mode; from Contabilidad (`{ fromAccounting: true }`) = audit mode (ledger)
  const [fromAccounting, setFromAccounting] = useState(false);
  const openedId = useRef(null); // the project whose photos are being loaded: a fast IndexedDB answer can arrive before the screen has re-rendered
  const openProject = useCallback((id, context = null) => {
    openedId.current = id;
    setFromAccounting(context?.fromAccounting === true);
    setActiveId(id);
    setEditor(false);
    setPhotos(emptySlots());
    photoStoreFor(id)
      .load()
      .then((p) => openedId.current === id && setPhotos(p))
      .catch(() => {});
    window.scrollTo({ top: 0 });
  }, []);

  const closeProject = useCallback(() => {
    if (activeRef.current) projectStore.save(activeRef.current).catch(() => {});
    openedId.current = null;
    setActiveId(null);
    setFromAccounting(false);
    setEditor(false);
    setPhotos(emptySlots());
  }, []);

  // The device's BACK button (Android / browser) does exactly what the "←" arrow does: back to the Dashboard.
  const leaveByBack = useCallback(() => {
    setSheet(null);
    setPaywall(null);
    closeProject();
  }, [closeProject]);
  useHistoryBack(activeId, leaveByBack);
  // Bottom navigation: Contabilidad and Ajustes are ONE history entry on top of Proyectos (switching between them replaces it), so the
  // device's Back goes ordered to the previous screen (Proyectos) instead of leaving the app; tapping "Proyectos" drops that entry.
  useHistoryBack(tab !== 'projects' ? tab : null, () => setTab('projects'), 'cubraxTab');

  // The open project's draft: all wizard / project-view edits flow through here.
  const setDraft = useCallback(
    (update) =>
      setProjects((list) =>
        list.map((p) => {
          if (p.id !== activeId) return p;
          const draft = typeof update === 'function' ? update(p.draft) : update;
          return draft === p.draft ? p : { ...p, draft, updatedAt: Date.now() };
        })
      ),
    [activeId]
  );
  // The open project itself (payments, advances, expenses, logbook...).
  const setProject = useCallback(
    (update) =>
      setProjects((list) =>
        list.map((p) => {
          if (p.id !== activeId) return p;
          const next = typeof update === 'function' ? update(p) : update;
          return next === p ? p : { ...next, updatedAt: Date.now() };
        })
      ),
    [activeId]
  );

  // The editor opens where the work is: the task / measures while the quote is incomplete, the measures afterwards.
  const openEditor = () => {
    const p = activeRef.current;
    if (!p) return;
    const valid = computeAll(p.draft, pricingTime(p.draft, Date.now()), { timeline: planningTimeline(p.draft, p), chains: false }).valid;
    setDraft((d) => ({ ...d, step: valid || d.mode === 'project' ? 1 : 0 }));
    setEditor(true);
    window.scrollTo({ top: 0 });
  };

  // A NEW project lands in the workspace (the SPA): its first partida is already open to type the measures, and
  // "Proyecto completo" starts with "+ Agregar partida". (Legacy flow, ?workspace=0: the wizard opens first, then ProjectView.)
  const createProject = (fields) => {
    // The company profile is COPIED into the new project: later profile changes never rewrite it.
    // the market of a new job is the one picked in the form (it starts with where the device is NOW), never blindly the stored one
    // Market of THIS job, in this order: the one picked in the form (it starts at the country the device is in NOW) -> the device's sensor read
    // again here -> the profile's country. It is the job's own state: it never writes back to the settings (a Chilean job created from Italy
    // must not make the next job Chilean) and it never moves the interface language.
    const regionCode = [fields.regionCode, detectCurrentRegion(), settings.region].find((c) => REGIONS[c]);
    const created = newProject({ company, logo, ...fields, regionCode });
    const project = { ...created, draft: { ...created.draft, step: created.draft.mode === 'project' ? 1 : 0 } };
    commit(project);
    setSheet(null);
    setTab('projects');
    openProject(project.id);
    // the workspace is the whole project (measures included): a new job lands right in it; only the legacy flow opens the wizard
    if (!wsOn) setEditor(true);
  };

  // "Crear extensión": a NEW phase of a finished job (same client, place and market, no items), linked by parentId.
  const createExtension = (parent) => {
    if (projectLimitReached(projects?.length ?? 0, pro)) {
      setPaywall('projects');
      return;
    }
    const label = makeI18n(settings.lang, parent.draft.regionCode).t('pm.extension.word');
    const created = newExtension(parent, projects ?? [], { label, company, logo });
    const project = { ...created, draft: { ...created.draft, step: 1 } };
    commit(project);
    openProject(project.id);
  };

  const editProject = (project, fields) => {
    commit({
      ...project,
      startDate: fields.startDate,
      endDate: fields.endDate,
      location: normalizeLocation(fields.location),
      cityOrRegion: cleanCityOrRegion(fields.cityOrRegion),
      closedAt: fields.closed ? project.closedAt || Date.now() : 0, // finished jobs live in the Historial tab
      updatedAt: Date.now(),
      draft: {
        // the market of the job (flag, currency, tax, prices) follows the country picked in its settings; the app language does not move
        ...(REGIONS[fields.regionCode] ? withMarket(project.draft, fields.regionCode) : project.draft),
        frozen: fields.unfreeze ? null : project.draft.frozen,
        project: { name: sanitizeText(fields.name, 60).trim(), client: sanitizeText(fields.client, 60).trim() },
      },
    });
    if (REGIONS[fields.regionCode] && fields.regionCode !== project.draft.regionCode && !quoteLock(project.draft)) pushToast({ key: 'ws.market.done', tone: 'ok' });
    setSheet(null);
  };

  const deleteProject = (id) => {
    markDeleted('projects', id); // so another device does not bring it back from the Drive backup
    projectStore.remove(id).catch(() => {});
    photoStoreFor(id).clear().catch(() => {});
    notePhotosFor(id).clear().catch(() => {}); // the photos of its logbook notes go with it
    receiptPhotosFor(id).clear().catch(() => {}); // and the pictures of its receipts
    paymentPhotosFor(id).clear().catch(() => {}); // and the proofs (cheque / transfer slip) of its client payments
    receiptQueue.removeProject(id).catch(() => {});
    exportQueue.removeProject(id).catch(() => {});
    setProjects((list) => list.filter((p) => p.id !== id));
    if (activeRef.current?.id === id) {
      openedId.current = null;
      setActiveId(null);
      setFromAccounting(false);
      setPhotos(emptySlots());
    }
    setSheet(null);
  };

  // Saves the profile (company + professional + backup choice). Used by the first-run setup and by the
  // edit sheet in Ajustes. Projects born before any profile existed adopt it once; populated snapshots are
  // never overwritten, so issued quotes keep the data they were issued with.
  const saveProfile = async ({ logo: newLogo, drive, ...text }) => {
    const clean = normalizeCompany(text);
    if (newLogo) await logoStore.save(newLogo);
    else await logoStore.clear();
    setCompany(clean);
    setLogo(newLogo || '');
    setMeta({ onboarded: true, drive: drive !== false });
    const next = (projects || []).map((p) => adoptCompany(p, clean, newLogo));
    next.forEach((p, i) => p !== projects[i] && projectStore.save(p).catch(() => {}));
    setProjects(next);
  };

  const finishSetup = async (data) => {
    await saveProfile(data);
    if (!user) setUser(localUser(data.proName || data.name));
    setStage('app');
    setSheet(null);
  };


  const confirmRegion = useCallback(
    (code) => {
      // the profile's country (default when the device cannot tell). The interface language is NOT derived from it: it follows the phone
      if (!REGIONS[code]) return;
      setSettings((s) => ({ ...s, region: code }));
      setPickingRegion(false);
    },
    []
  );

  // an explicit choice of language LOCKS it: from then on the device's language no longer overrides it
  const changeLang = useCallback((lang) => LANGS.includes(lang) && setSettings((s) => ({ ...s, lang, langLocked: true })), []);
  // Freemium gate for new projects: past the free limit the PRO screen opens instead of the form.
  const requestNewProject = useCallback(() => {
    if (projectLimitReached(projects?.length ?? 0, pro)) {
      setSheet(null);
      setPaywall('projects');
      return;
    }
    setSheet({ type: 'new' });
  }, [projects, pro]);

  const openPaywall = useCallback((feature = 'promo') => {
    setSheet(null);
    setPaywall(feature);
  }, []);

  // Sign out = deep clean (storage, IndexedDB, Google session) and a full reload onto the opening screen. With the
  // Drive backup on, the CURRENT state is first uploaded and the sign-out only goes on once Drive has it: if it
  // cannot be confirmed nothing is erased and the caller is told why ({ ok: false, reason }). `force` = the user
  // explicitly chose to leave without the backup.
  const logout = useCallback(
    async ({ force = false } = {}) => {
      if (wipingRef.current) return { ok: true };
      if (backupOnRef.current && !force) {
        const r = await sync.flush({ force: true }); // silent: signing out never opens a Google window; if it cannot upload, the user is told and may leave anyway
        if (!r.ok) return r;
      }
      wipingRef.current = true;
      sync.cancel();
      await wipeLocalData();
      onSignedOut();
      return { ok: true };
    },
    [sync, onSignedOut]
  );

  // ---- "Sincronizar Expediente a Drive" -----------------------------------------------------------------------
  // Proyectos/<name>/ with the PDF + Excel, "Fotos Obra" and "Comprobantes". Runs in the background (async, never blocks the screen):
  // a toast says "Sincronizando expediente en Drive..." while the user keeps working, then turns into the result.
  const [dossierBusy, setDossierBusy] = useState([]); // ids of the projects being synced
  const dossierRunning = useRef(new Set());
  const syncExpediente = useCallback(
    (projectId, buildDocuments) => {
      if (dossierRunning.current.has(projectId)) return { started: false, reason: 'busy' };
      if (!googleConfigured) {
        pushToast({ key: 'setup.drive.err.not_configured', tone: 'amber', ms: 6000 });
        return { started: false, reason: 'not_configured' };
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        pushToast({ key: 'dossier.err.offline', tone: 'amber', ms: 6000 });
        return { started: false, reason: 'offline' };
      }
      dossierRunning.current.add(projectId);
      setDossierBusy([...dossierRunning.current]);
      const toastId = pushToast({ key: 'dossier.syncing', tone: 'info', ms: 0 });
      const finish = (patch) => {
        if (!updateToast(toastId, patch)) pushToast(patch); // the user may have tapped the toast away: say the result anyway
      };
      (async () => {
        try {
          const token = await ensureDriveToken({ interactive: true, hint: userRef.current?.email || '' }); // a tap: the consent may open
          if (!token) throw Object.assign(new Error('auth'), { code: 'auth' });
          const project = projectsRef.current.find((p) => p.id === projectId);
          if (!project) throw new Error('gone');
          const images = await collectDossierImages(project, {
            cameraPhotos: () => photoStoreFor(projectId).load().catch(() => []),
            notePhoto: (noteId) => notePhotosFor(projectId).get(noteId),
            receiptPhoto: (receiptId) => receiptPhotosFor(projectId).get(receiptId),
          });
          const title = projectTitle(project) || makeI18n(settings.lang, settings.region).t('proj.untitled');
          const stats = await syncDossier({ client: driveClient, title, documents: buildDocuments, images });
          setLinkedNow(true);
          finish(stats.failed ? { key: 'dossier.partial', params: { n: stats.failed }, tone: 'amber', ms: 8000 } : { key: 'dossier.done', tone: 'ok', ms: 6000 });
        } catch (err) {
          const code = err?.code;
          finish({ key: code === 'offline' ? 'dossier.err.offline' : code === 'auth' ? 'dossier.err.auth' : code === 'quota' ? 'dossier.err.quota' : 'dossier.err', tone: 'amber', ms: 7000 });
        } finally {
          dossierRunning.current.delete(projectId);
          setDossierBusy([...dossierRunning.current]);
        }
      })();
      return { started: true };
    },
    [driveClient, settings.lang, settings.region]
  );

  // ---- Contabilidad: the financial command center of ONE project + "Cerrar Rendición" -----------------------------------------
  // The card of Contabilidad opens the project in AUDIT mode (its checkbox only picks the project for the consolidated Excel). "Cerrar Rendición"
  // builds the Excel and sends it straight to Drive with the app's own Drive client / token; with no connection (or when Drive fails) the file is
  // parked in IndexedDB (exportQueue) and uploaded by the background sync below. Nothing is ever downloaded to the phone.
  const renditionUpload = useCallback(({ kind, title, fileName, bytes }) => uploadRendition({ client: driveClient, kind, title, fileName, bytes }), [driveClient]);
  const renditionRef = useRef(false);
  // The one way a rendición (of a project or the global one) leaves the app: Drive or the offline queue, never a download. `run` builds + delivers;
  // whatever happens (offline, hanging network, throw), this settles, the guard is released and the user gets a toast.
  const sendRendition = useCallback(async (run) => {
    if (renditionRef.current) return null;
    renditionRef.current = true;
    try {
      const out = await run({
        upload: renditionUpload,
        ensureToken: ({ interactive = true } = {}) => ensureDriveToken({ interactive, hint: userRef.current?.email || '' }).catch(() => null), // "Enviar a Drive" is a tap: the Google window may open
        configured: googleConfigured,
      });
      if (out.status === 'uploaded') {
        setLinkedNow(true);
        pushToast({ key: 'rend.done', tone: 'ok', ms: 6000 });
      } else if (out.status === 'queued') pushToast({ key: out.reason === 'offline' ? 'rend.queued.offline' : 'rend.queued', tone: 'amber', ms: 8000 });
      else if (out.status === 'not_configured') pushToast({ key: 'setup.drive.err.not_configured', tone: 'warn', ms: 6000 });
      else pushToast({ key: out.reason === 'queue_full' ? 'rend.queueFull' : 'rend.error', tone: 'warn', ms: 7000 });
      return out;
    } catch {
      pushToast({ key: 'rend.error', tone: 'warn', ms: 7000 });
      return null;
    } finally {
      renditionRef.current = false;
    }
  }, [renditionUpload]);
  const submitRendition = useCallback(async () => {
    const project = projectsRef.current.find((p) => p.id === activeRef.current?.id); // the project open in audit mode
    if (!project) return null;
    return sendRendition((deps) => closeRendition({ project, totals: projectTotals([project], Date.now()), i18n: makeI18n(settings.lang, project.draft.regionCode), ...deps }));
  }, [settings.lang, sendRendition]);
  // the consolidated Excel of the chosen projects -> CUBRAX - Respaldos Obra / Rendiciones_Globales (or the same offline queue)
  const submitGlobalRendition = useCallback(
    async (ids) => {
      const chosen = projectsRef.current.filter((p) => ids.includes(p.id));
      if (!chosen.length) return null;
      return sendRendition((deps) => closeGlobalRendition({ projects: chosen, totals: projectTotals(chosen, Date.now()), i18n: makeI18n(settings.lang, chosen[0].draft.regionCode), ...deps }));
    },
    [settings.lang, sendRendition]
  );
  // the background half: the parked rendiciones go up when the network is back (silent token only: no Google screen from the background)
  const exportSync = useExportSync({
    upload: renditionUpload,
    ensureToken: async () => getDriveToken() ?? (googleConfigured && isDriveLinked() && !needsDriveInteraction() ? ensureDriveToken({ interactive: false, hint: userRef.current?.email || '' }).catch(() => null) : null),
    notify: notifyUser,
    enabled: stage === 'app' && projects !== null && googleConfigured,
  });
  // Google said (silently) that it needs the user: the screens offer "Reconectar Drive", the only way back besides "Enviar a Drive"
  const driveNeedsReconnect = useSyncExternalStore(subscribeDriveAuth, needsDriveInteraction, () => false);
  // "Reconectar Drive" (a tap): the one place where the Google window may open to renew the token; the parked files go up right after
  const reconnectDrive = useCallback(async () => {
    const token = await ensureDriveToken({ interactive: true, hint: userRef.current?.email || '' }).catch(() => null);
    if (!token) {
      pushToast({ key: 'rend.reconnect.err', tone: 'amber', ms: 7000 });
      return null;
    }
    setLinkedNow(true);
    await exportSync.retry();
    return token;
  }, [exportSync]);

  // ---- pull from Drive: download + MERGE (never overwrite) ---------------------------------------------------------
  // Reads the newest backup of the CUBRAX folder and merges it into the device record by record (merge.js: projects and, inside them,
  // payments / advances / expenses / crew / logbook by id, newest `updatedAt` wins; workers the same; deletions respected; the profile and
  // settings only fill an empty device). IndexedDB is written first, then the screen state is merged against the CURRENT list, so what the user
  // typed while the file was downloading is never lost. If this device holds something the backup lacks, the merged state goes back up.
  //   force: download even if Drive still shows the file this device last uploaded / merged (the manual button);
  //   inRound: called by the upload engine just before it uploads (it uploads right after, so nothing is queued here).
  // Never throws: { ok: false, reason } with 'offline' | 'auth' | 'quota' | 'error'.
  const pullInflight = useRef(null);
  const [, setSyncRev] = useState(0); // bumped when a pull changed something: a global re-render
  const pullFromDrive = useCallback(
    ({ interactive = false, force = false, inRound = false } = {}) => {
      if (pullInflight.current) return pullInflight.current;
      sync.beginPull(); // the header cloud spins while the daemon downloads (never a blocking screen)
      const job = (async () => {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' }; // no coverage: nothing to ask
        let token = null;
        try {
          token = await ensureDriveToken({ interactive, hint: userRef.current?.email || '' });
        } catch {
          token = null;
        }
        if (!token) return { ok: false, reason: 'auth' };
        try {
          const peek = await driveClient.peekBackup(); // metadata only
          if (!peek) {
            sync.release(); // nothing usable in the cloud: there is nothing to protect
            return { ok: true, restored: false, changed: 0 };
          }
          if (!force && peek.modifiedTime && peek.modifiedTime === getSeenRemote()) return { ok: true, restored: false, changed: 0, upToDate: true }; // nobody wrote since
          const found = await driveClient.latestBackup(parseBackup);
          if (!found) {
            sync.release();
            return { ok: true, restored: false, changed: 0 };
          }
          const local = latest.current;
          applyingPull.current = true;
          let merged;
          try {
            merged = await restoreBackup({ ...local, projects: local.projects || [] }, found.value, { projectStore, photoStoreFor, notePhotosFor, logoStore });
          } finally {
            applyingPull.current = false;
          }
          const changed = merged.wonProjects.length + merged.removedProjects.length + merged.photosChanged.length + (merged.workersChanged ? 1 : 0);
          const openId = activeRef.current?.id;
          if (openId && merged.photosChanged.includes(openId)) {
            // the photos of the project on screen were completed from Drive: show them (straight state, not a user change)
            photoStoreFor(openId)
              .load()
              .then((p) => activeRef.current?.id === openId && setPhotos(p))
              .catch(() => {});
          }
          if (merged.wonProjects.length || merged.removedProjects.length) {
            skipDirty.current = true;
            latest.current = { ...latest.current, projects: merged.projects }; // an upload that starts right now already sees the merge
            setProjectsRaw((list) => mergeProjectLists(list || [], found.value.projects, merged.tombs.projects).projects); // against the CURRENT list
          }
          if (merged.wonProjects.length || merged.photosChanged.length) {
            // tell the open screens that the background pull changed projects (their derived amounts recompute from the new state at once; no F5)
            try {
              window.dispatchEvent(new CustomEvent('cubrax:synced', { detail: { projects: merged.wonProjects, photos: merged.photosChanged, open: openedId.current } }));
            } catch {
              /* no CustomEvent (very old WebView): the state update below still refreshes the screen */
            }
          }
          if (merged.profileRestored) {
            setCompany(merged.company);
            setLogo(merged.logo);
            setSettings(merged.settings);
            setMeta(merged.meta);
          } else setMeta((m) => (m.drive ? m : { ...m, drive: true }));
          if (changed || merged.profileRestored) setSyncRev((n) => n + 1);
          setSeenRemote(peek.modifiedTime);
          sync.release(); // the cloud copy is now part of this device: uploads resume
          if (merged.needsPush && !inRound) sync.markDirty(); // this device has something Drive lacks: the merged whole goes back up
          return { ok: true, restored: true, changed, profile: merged.profileRestored, company: merged.company, projects: merged.wonProjects.length };
        } catch (err) {
          const code = err?.code;
          return { ok: false, reason: code === 'auth' || code === 'offline' || code === 'quota' ? code : 'error' };
        }
      })().finally(() => {
        pullInflight.current = null;
        sync.endPull();
      });
      pullInflight.current = job;
      return job;
    },
    [driveClient, sync]
  );
  pullRef.current = pullFromDrive;
  // The manual "Restaurar" / the one-click offer: always downloads; a failure is reported to the header cloud as well as to the caller
  const restoreFromDrive = useCallback(
    async ({ interactive = false } = {}) => {
      const r = await pullFromDrive({ interactive, force: true });
      sync.reportPull(r);
      return r;
    },
    [pullFromDrive, sync]
  );
  // AUTO-PULL: when the app opens or comes back to the foreground (visibilitychange), Drive is checked silently (one metadata request when nobody else
  // wrote) and what other devices did is merged in. Never opens a Google window: without a valid token it only lights the cloud. If this device has
  // changes waiting, the upload (which merges first) runs instead.
  const lastPull = useRef(0);
  const autoPull = useCallback(({ ignoreThrottle = false } = {}) => {
    if (!backupOnRef.current || wipingRef.current || !userRef.current || !Array.isArray(latest.current.projects)) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (!isDriveLinked() && !getDriveToken()) return; // this device never connected to Drive
    const st = sync.getState();
    if (st.held && restoreOfferRef.current) return; // the one-click restore sheet is on screen: the user is answering it
    // a held backup with no sheet (the user chose "later", or the app was reopened): the daemon completes the job itself, merging the cloud copy in
    const nowMs = Date.now();
    if (!ignoreThrottle && nowMs - lastPull.current < 15_000) return;
    lastPull.current = nowMs;
    if (st.dirty && !st.held) {
      sync.flush().catch(() => {}); // this device has changes waiting: the upload merges (pulls) first anyway
      return;
    }
    pullFromDrive({ interactive: false })
      .then((r) => sync.reportPull(r))
      .catch(() => sync.reportPull({ ok: false, reason: 'error' }));
  }, [pullFromDrive, sync]);
  const autoPullRef = useRef(autoPull);
  autoPullRef.current = autoPull;
  // THE DAEMON'S EVENT TRIGGERS (no buttons: nothing here asks anything of the user)
  //  a) the app comes back to the foreground (visibilitychange -> visible): pull what the other devices did; on the way OUT (hidden) whatever is
  //     still waiting for its debounce goes up at once, so leaving the app never strands a change
  //  b) the connection comes back ('online'): pull + push, without the 15 s throttle (the last attempt failed for lack of signal)
  //  c) every local change (projects, photos, workers, profile...) -> sync.markDirty() -> debounced push (see the effect on `projects` above)
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'hidden') {
        if (sync.getState().dirty && backupOnRef.current && !wipingRef.current) sync.flush().catch(() => {});
        return;
      }
      autoPullRef.current();
    };
    const online = () => autoPullRef.current({ ignoreThrottle: true });
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', online);
    };
  }, [sync]);
  // ... and once when the app has opened and its data is loaded
  const bootPulled = useRef(false);
  useEffect(() => {
    if (bootPulled.current || projects === null || !user || !backupOn) return;
    bootPulled.current = true;
    autoPullRef.current();
  }, [projects, user, backupOn]);
  // Light detection after a login: ONLY the metadata of cubrax-backup.json is requested (never its content). When the file exists and this
  // device has no work, the one-click restore sheet opens and uploads are held so the cloud copy cannot be overwritten meanwhile.
  const offerRestore = useCallback(
    async ({ interactive = false } = {}) => {
      if (!googleConfigured || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { offered: false };
      for (let i = 0; i < 40 && !Array.isArray(latest.current.projects); i += 1) await new Promise((res) => setTimeout(res, 50)); // IndexedDB still loading
      if (!hasNoProjects(latest.current)) return { offered: false };
      const token = await ensureDriveToken({ interactive, hint: userRef.current?.email || '' });
      if (!token) return { offered: false };
      try {
        const found = await driveClient.peekBackup();
        if (!found) {
          sync.release();
          return { offered: false };
        }
        if (!hasNoProjects(latest.current)) return { offered: false }; // the user started working while we looked
        sync.hold();
        setRestoreOffer(true);
        return { offered: true, modifiedTime: found.modifiedTime || '' };
      } catch {
        return { offered: false };
      }
    },
    [driveClient, sync]
  );
  offerRef.current = offerRestore;
  // "Restaurar ahora": download + rebuild + hydrate. A backup that carries the profile also completes the first-run setup.
  const restoreOffered = useCallback(async () => {
    const r = await restoreFromDrive({ interactive: true });
    if (r.ok && r.restored && r.profile) {
      setUser((u) => u || localUser(r.company.proName || r.company.name));
      setStage('app');
      setSheet(null);
    }
    return r;
  }, [restoreFromDrive]);
  // after the short success message: the Dashboard with the projects just restored
  const finishOffer = useCallback(() => {
    setRestoreOffer(false);
    setSheet(null);
    setTab('projects');
    closeProject();
    window.scrollTo({ top: 0 });
  }, [closeProject]);
  // First-run setup connected Drive: if this Google account already has a backup, it is restored and the user lands
  // on the Dashboard with everything back (nothing to type).
  const onDriveConnected = useCallback(async () => {
    const offer = await offerRestore();
    return { ok: true, restored: false, offered: offer.offered };
  }, [offerRestore]);
  // Successful sign-in (Google or local profile): the user is stored (effect above), and we land on the
  // main view: no splash, no open sheet, no pending region picker.
  const signIn = useCallback(
    (u) => {
      setUser(u);
      setSheet(null);
      setPickingRegion(false);
      setStage('app');
      window.scrollTo({ top: 0 });
      // Google on a new device / after signing out: a light look in Drive (metadata only); a backup found is OFFERED, not forced.
      if (u.provider === 'google' && googleConfigured) offerRef.current?.({ interactive: false })?.catch(() => null); // silent: no second Google window right after the sign-in
    },
    []
  );

  // Back from Google after a full-page sign-in (installed app): take the chosen account in, once, and forget the one-shot result.
  useEffect(() => {
    if (!signInReturn) return;
    clearSignInResult();
    if (signInReturn.user) signIn(signInReturn.user);
  }, [signInReturn, signIn]);

  const returning = meta.onboarded || !isCompanyEmpty(company);
  // "Iniciar": a returning user goes straight on; a new one gets the single setup screen, with the country,
  // currency and language already taken from the device (nothing to answer).
  const start = () => {
    if (user || returning) return setStage('app');
    if (!settings.region) {
      const code = detectCurrentRegion();
      if (code) setSettings((s) => ({ ...s, region: code })); // the language already follows the phone (languageFor), never the country
    }
    return setStage('setup');
  };
  const backupStatusValue = useMemo(
    () => ({ enabled: backupOn && Boolean(user), status: backup.status, reason: backup.reason, pullError: backup.pullError, dirty: backup.dirty, at: backup.at, held: backup.held, pulling: backup.pulling }),
    [backupOn, user, backup]
  );
  const editing = sheet?.type === 'edit' ? projects?.find((p) => p.id === sheet.id) : null;
  const navActive = tab;

  return (
    <I18nProvider lang={settings.lang} regionCode={active ? active.draft.regionCode : settings.region}>
     <EcoContext.Provider value={isEcoMode}>
     <BackupStatusContext.Provider value={backupStatusValue}>
      {stage === 'splash' ? (
        <SplashScreen onStart={start} auto={Boolean(oauth)} pwa={pwa} />
      ) : stage === 'setup' ? (
        !region || pickingRegion ? (
          <RegionSelect
            initial={settings.region}
            onConfirm={confirmRegion}
            onChangeLang={changeLang}
            onCancel={region ? () => setPickingRegion(false) : installed ? undefined : () => setStage('splash')}
          />
        ) : (
          <ProfileSetup onSave={finishSetup} onChangeRegion={() => setPickingRegion(true)} returned={oauth} onDriveConnected={onDriveConnected} />
        )
      ) : !region || pickingRegion ? (
        <RegionSelect
          initial={settings.region}
          onConfirm={confirmRegion}
          onChangeLang={changeLang}
          onCancel={region ? () => setPickingRegion(false) : undefined}
        />
      ) : !user ? (
        <Login onLogin={signIn} />
      ) : (
        <>
          <Header bare={!(active && editor)} subtitle={active ? projectTitle(active) || user.name : user.name} pwa={pwa} />

          {projects === null ? (
            <>
              <AppShell />
              <BottomNav active={navActive} onProjects={() => setTab('projects')} onAccounting={() => setTab('accounting')} onSettings={() => setTab('settings')} />
            </>
          ) : active && fromAccounting ? (
            // opened from Contabilidad: AUDIT mode, the pure ledger (cockpit + receipt stack + "Cerrar Rendición"), also for finished projects
            <ProjectWorkspace
              key={active.id}
              fromAccounting
              project={active}
              rendition={{ onClose: submitRendition, onRetry: exportSync.retry, onReconnect: reconnectDrive, needsReconnect: driveNeedsReconnect }}
            />
          ) : active ? (
            wsOn ? (
              isClosed(active) ? (
                <PostMortem
                  key={active.id}
                  project={active}
                  parent={active.parentId ? projects.find((p) => p.id === active.parentId) ?? null : null}
                  company={projectCompany(active, company)}
                  photos={photos}
                  setDraft={setDraft}
                  onReopen={() => commit({ ...active, closedAt: 0, updatedAt: Date.now() })}
                  onExtend={() => createExtension(active)}
                />
              ) : (
                <ProjectWorkspace
                  key={active.id}
                  project={active}
                  setProject={setProject}
                  setDraft={setDraft}
                  photos={photos}
                  setPhotos={changePhotos}
                  company={projectCompany(active, company)}
                  receipts={receipts}
                  enqueueReceipt={enqueueReceipt}
                  onSyncDossier={syncExpediente}
                  dossierBusy={dossierBusy.includes(active.id)}
                  onBack={closeProject}
                  onEdit={() => setSheet({ type: 'edit', id: active.id })}
                  onPro={openPaywall}
                />
              )
            ) : editor ? (
              <Wizard
                key={active.id}
                projectId={active.id}
                draft={active.draft}
                setDraft={setDraft}
                photos={photos}
                setPhotos={changePhotos}
                company={projectCompany(active, company)}
                startDate={active.startDate}
                endDate={active.endDate}
                onNewProject={() => {
                  closeProject();
                  requestNewProject();
                }}
                onPro={openPaywall}
                onExit={() => setEditor(false)}
              />
            ) : (
              <ProjectView
                key={active.id}
                project={active}
                setProject={setProject}
                setDraft={setDraft}
                photos={photos}
                setPhotos={changePhotos}
                company={projectCompany(active, company)}
                onBack={closeProject}
                onEdit={() => setSheet({ type: 'edit', id: active.id })}
                onEditor={openEditor}
                onPro={openPaywall}
              />
            )
          ) : (
            <>
              {tab === 'settings' ? (
                <SettingsView
                  user={user}
                  company={company}
                  logo={logo}
                  regionCode={settings.region}
                  pwa={pwa}
                  drive={meta.drive}
                  onDriveChange={changeDrive}
                  onConnect={connectAndBackup}
                  onSaveProfile={async (data) => {
                    await saveProfile(data); // stays on Ajustes: email / phone / logo land in localStorage + IndexedDB and the PDFs
                  }}
                  onSignIn={signIn}
                  onChangeLang={changeLang}
                  onConfirmRegion={(code) => confirmRegion(code)}
                  onChangeRegion={() => setPickingRegion(true)}
                  backup={{ configured: googleConfigured, configStatus: GOOGLE_CONFIG_STATUS, enabled: backupOn, linked: driveLinked, held: Boolean(backup.held), state: backup }}
                  onLogout={logout}
                />
              ) : tab === 'accounting' ? (
                <GlobalAccounting projects={projects} onOpenProject={openProject} onExportGlobal={submitGlobalRendition} />
              ) : (
                <Dashboard projects={projects} receiptRows={receipts.rows} tab={dashTab} onTab={setDashTab} onNew={requestNewProject} onOpen={openProject} onPro={() => openPaywall('promo')} />
              )}
              <BottomNav
                active={navActive}
                onProjects={() => setTab('projects')}
                onAccounting={() => setTab('accounting')}
                onSettings={() => setTab('settings')}
              />
            </>
          )}

          {sheet?.type === 'new' && <ProjectSheet defaultRegion={settings.region} onSave={createProject} onClose={() => setSheet(null)} />}
          {editing && (
            <ProjectSheet project={editing} onSave={(f) => editProject(editing, f)} onDelete={() => deleteProject(editing.id)} onClose={() => setSheet(null)} />
          )}
          {paywall && <ProPaywall feature={paywall} onClose={() => setPaywall(null)} />}
          <ToastHost />
        </>
      )}
      {restoreOffer && <RestorePrompt onRestore={restoreOffered} onLater={() => setRestoreOffer(false)} onDone={finishOffer} />}
     </BackupStatusContext.Provider>
     </EcoContext.Provider>
    </I18nProvider>
  );
}
