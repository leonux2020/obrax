import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emptySlots } from './lib/photos.js';
import { migrateLegacyPhotos, photoStoreFor } from './lib/photoStore.js';
import { projectStore } from './lib/projectStore.js';
import { logoStore } from './lib/companyStore.js';
import { hasIndexedDb } from './lib/db.js';
import { I18nProvider, makeI18n } from './lib/i18n.jsx';
import { getRegion, LANGS } from './lib/regions.js';
import { wipeLocalData } from './lib/session.js';
import { adoptCompany, documentCompany, newProject, projectTitle, toDayString } from './lib/projects.js';
import { normalizeLocation } from './lib/ledger.js';
import { computeAll } from './lib/engine.js';
import { planningTimeline, pricingTime } from './lib/signature.js';
import { detectLang, detectRegionCode } from './lib/geo.js';
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
import { ensureDriveToken, googleConfigured, localUser } from './lib/auth.js';
import { clearDriveToken, getDriveToken, isDriveLinked } from './lib/driveToken.js';
import { createDriveClient } from './lib/drive.js';
import { createDriveSync } from './lib/driveSync.js';
import { collectBackup, isDeviceEmpty, parseBackup, restoreBackup } from './lib/backup.js';
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
import ToastHost from './components/workspace/ToastHost.jsx';
import { workspaceEnabled } from './lib/flags.js';
import { askNotifyPermission, pushToast, systemNotify } from './lib/notify.js';
import { receiptQueue } from './lib/receiptQueue.js';
import { addExpenses, registerBackgroundSync } from './lib/receiptSync.js';
import { useReceiptSync } from './lib/useReceiptSync.js';
import GlobalAccounting from './components/GlobalAccounting.jsx';
import Dashboard from './components/Dashboard.jsx';
import BottomNav from './components/BottomNav.jsx';
import ProjectSheet from './components/ProjectSheet.jsx';
import SettingsSheet from './components/SettingsSheet.jsx';
import ProfileSheet from './components/ProfileSheet.jsx';
import { clearOAuthResult, peekOAuthResult } from './lib/oauthCallback.js';
import SplashScreen, { SPLASH_TIMING } from './components/SplashScreen.jsx';
import ProfileSetup from './components/ProfileSetup.jsx';
import ProPaywall from './components/ProPaywall.jsx';
import RestoreScreen from './components/RestoreScreen.jsx';

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

/** Back to the opening screen with a clean page load (the app lives at the site root). */
const goToStart = () => window.location.replace(import.meta.env?.BASE_URL || '/');

const projectCompany = (project, company) => documentCompany(project.company, company);

export default function App({ splash = SPLASH_TIMING, onSignedOut = goToStart }) {
  const pwa = usePWA();
  const pro = usePro();
  const [settings, setSettings] = useState(loadSettings);
  const [user, setUser] = useState(loadUser);
  const [company, setCompany] = useState(loadCompany); // global profile (text); the logo lives in IndexedDB
  const [logo, setLogo] = useState('');
  const [projects, setProjects] = useState(null); // null while loading from IndexedDB
  const [activeId, setActiveId] = useState(null); // null = dashboard
  // Google's answer after a full-page redirect (Drive consent), already validated and stripped of its token in main.jsx.
  const [oauth] = useState(peekOAuthResult);
  const [meta, setMeta] = useState(() => {
    const m = loadProfileMeta(); // { onboarded, drive }
    return oauth?.granted && m.onboarded ? { ...m, drive: true } : m;
  });
  // The welcome screen ('splash') is ALWAYS the first view of a new or signed-out user (nobody authenticated);
  // a stored user goes straight to the app. 'setup' is the registration (first run), 'app' shows Login when
  // there is no user.
  const [stage, setStage] = useState('splash'); // the opening screen is ALWAYS the first thing shown
  const [sheet, setSheet] = useState(null); // { type: 'new' | 'edit' | 'settings' | 'profile', id? } (profile is reached from Ajustes)
  const [tab, setTab] = useState('projects'); // bottom navigation: 'projects' | 'accounting' (Ajustes is a sheet)
  const [dashTab, setDashTab] = useState('active'); // dashboard tabs: 'active' | 'history'
  const [editor, setEditor] = useState(false); // the technical editor (measures, prices, schedule) of the open project
  const [pickingRegion, setPickingRegion] = useState(false);
  const [paywall, setPaywall] = useState(null); // null | 'promo' | 'projects' | 'drive' | 'ai': which locked feature opened the PRO screen
  const [photos, setPhotos] = useState(emptySlots);
  const [wsOn] = useState(workspaceEnabled); // single-screen project workspace (flag, see lib/flags.js)

  const region = getRegion(settings.region);
  // live material / rental prices for the regions in use (the user's country + every project's); only inside the app
  usePriceFeed(stage === 'app' ? [settings.region, ...(projects ?? []).map((p) => p.draft.regionCode)] : []);
  const active = useMemo(() => projects?.find((p) => p.id === activeId) ?? null, [projects, activeId]);
  const activeRef = useRef(null);
  const projectsRef = useRef([]); // always the latest list, readable from async callbacks (receipt sync)
  projectsRef.current = projects ?? projectsRef.current;
  const wipingRef = useRef(false); // true while signing out: nothing may be written back to the (erased) device
  activeRef.current = active;
  const [restoring, setRestoring] = useState(false); // reading the Drive backup before the Dashboard is shown
  const latest = useRef(null); // the CURRENT state, read by the backup engine and the restore
  latest.current = { settings, company, meta, logo, projects };
  const backupOn = googleConfigured && meta.drive;
  const backupOnRef = useRef(false);
  backupOnRef.current = backupOn && !wipingRef.current;

  // ---- Google Drive backup (silent) ---------------------------------------------------------------------------
  const driveClient = useMemo(() => createDriveClient({ getToken: async () => getDriveToken(), onAuthRejected: () => clearDriveToken() }), []);
  const sync = useMemo(
    () =>
      createDriveSync({
        client: driveClient,
        collect: () => collectBackup({ ...latest.current, projects: latest.current.projects || [], loadPhotos: (id) => photoStoreFor(id).load().catch(() => []) }),
        // in the background Google is only asked (silently) when this device has been connected before
        ensureToken: ({ interactive }) => (interactive || isDriveLinked() ? ensureDriveToken({ interactive }) : Promise.resolve(getDriveToken())),
        isEnabled: () => backupOnRef.current,
      }),
    [driveClient]
  );
  const [backup, setBackup] = useState(() => sync.getState());
  useEffect(() => sync.subscribe(setBackup), [sync]);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveUser(user), [user]);
  useEffect(() => saveCompany(company), [company]);
  useEffect(() => saveProfileMeta(meta), [meta]);
  useEffect(() => clearOAuthResult(), []); // the answer is consumed once
  // Every change of projects / profile / settings / backup preference queues a silent Drive backup.
  const syncReady = useRef(false);
  useEffect(() => {
    if (projects === null) return;
    if (!syncReady.current) {
      syncReady.current = true; // the first load is not a change; just resume anything left pending
      sync.resume();
      return;
    }
    if (!wipingRef.current) sync.markDirty();
  }, [projects, company, settings, meta, logo, sync]);
  const changePhotos = useCallback(
    (next) => {
      setPhotos(next);
      if (!wipingRef.current) sync.markDirty();
    },
    [sync]
  );
  useEffect(() => {
    document.documentElement.lang = settings.lang;
  }, [settings.lang]);

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
    setProjects((list) => (list.some((p) => p.id === project.id) ? list.map((p) => (p.id === project.id ? project : p)) : [project, ...list]));
    projectStore.save(project).catch(() => {});
  }, []);

  // ---- deferred receipts (offline scanner) ---------------------------------------------------------------------
  // A receipt photographed without a connection waits in IndexedDB (receiptQueue). This global sync sends it to the AI
  // proxy when the network is back, writes the tabulated expenses into ITS project (open or not) and tells the user.
  const applyReceipt = useCallback(async (projectId, expenses) => {
    const target = projectsRef.current.find((p) => p.id === projectId);
    if (!target) return false; // the project was deleted meanwhile
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

  const openProject = useCallback((id) => {
    setActiveId(id);
    setEditor(false);
    setPhotos(emptySlots());
    photoStoreFor(id)
      .load()
      .then((p) => activeRef.current?.id === id && setPhotos(p))
      .catch(() => {});
    window.scrollTo({ top: 0 });
  }, []);

  const closeProject = useCallback(() => {
    if (activeRef.current) projectStore.save(activeRef.current).catch(() => {});
    setActiveId(null);
    setEditor(false);
    setPhotos(emptySlots());
  }, []);

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
    const created = newProject({ regionCode: settings.region, company, logo, ...fields });
    const project = { ...created, draft: { ...created.draft, step: created.draft.mode === 'project' ? 1 : 0 } };
    commit(project);
    setSheet(null);
    setTab('projects');
    openProject(project.id);
    // the workspace is the whole project (measures included): a new job lands right in it; only the legacy flow opens the wizard
    if (!wsOn) setEditor(true);
  };

  const editProject = (project, fields) => {
    commit({
      ...project,
      startDate: fields.startDate,
      endDate: fields.endDate,
      location: normalizeLocation(fields.location),
      closedAt: fields.closed ? project.closedAt || Date.now() : 0, // finished jobs live in the Historial tab
      updatedAt: Date.now(),
      draft: {
        ...project.draft,
        frozen: fields.unfreeze ? null : project.draft.frozen,
        project: { name: sanitizeText(fields.name, 60).trim(), client: sanitizeText(fields.client, 60).trim() },
      },
    });
    setSheet(null);
  };

  const deleteProject = (id) => {
    projectStore.remove(id).catch(() => {});
    photoStoreFor(id).clear().catch(() => {});
    receiptQueue.removeProject(id).catch(() => {});
    setProjects((list) => list.filter((p) => p.id !== id));
    if (activeRef.current?.id === id) {
      setActiveId(null);
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

  const saveProfileFromSettings = async (data) => {
    await saveProfile(data);
    setSheet({ type: 'settings' }); // back to Ajustes, where the edit started
  };

  const confirmRegion = useCallback(
    (code) => {
      const r = getRegion(code);
      const changed = code !== settings.region;
      setSettings({ region: code, lang: changed ? r.lang : settings.lang });
      setPickingRegion(false);
    },
    [settings]
  );

  const changeLang = useCallback((lang) => LANGS.includes(lang) && setSettings((s) => ({ ...s, lang })), []);
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
        const r = await sync.flush({ force: true, interactive: true });
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

  // ---- restore from Drive --------------------------------------------------------------------------------------
  // Reads the newest backup of the CUBRAX folder and merges it into the device (projects: newest wins; profile and
  // settings only fill an empty device), writes IndexedDB and then updates the screen state.
  const restoreFromDrive = useCallback(
    async ({ interactive = false } = {}) => {
      const token = await ensureDriveToken({ interactive });
      if (!token) return { ok: false, reason: 'auth' };
      try {
        const found = await driveClient.latestBackup(parseBackup);
        if (!found) return { ok: true, restored: false };
        const local = latest.current;
        const merged = await restoreBackup({ ...local, projects: local.projects || [] }, found.value, { projectStore, photoStoreFor, logoStore });
        setProjects(merged.projects);
        if (merged.profileRestored) {
          setCompany(merged.company);
          setLogo(merged.logo);
          setSettings(merged.settings);
          setMeta(merged.meta);
        } else setMeta((m) => (m.drive ? m : { ...m, drive: true }));
        return { ok: true, restored: true, profile: merged.profileRestored, company: merged.company, projects: merged.wonProjects.length };
      } catch (err) {
        return { ok: false, reason: err?.code || 'error' };
      }
    },
    [driveClient]
  );
  // First-run setup connected Drive: if this Google account already has a backup, it is restored and the user lands
  // on the Dashboard with everything back (nothing to type).
  const onDriveConnected = useCallback(async () => {
    if (!isDeviceEmpty(latest.current)) return { ok: true, restored: false };
    const r = await restoreFromDrive();
    if (r.ok && r.restored && r.profile) {
      setUser((u) => u || localUser(r.company.proName || r.company.name));
      setStage('app');
      setSheet(null);
    }
    return r;
  }, [restoreFromDrive]);
  // Successful sign-in (Google or local profile): the user is stored (effect above), and we land on the
  // main view: no splash, no open sheet, no pending region picker.
  const signIn = useCallback(
    (u) => {
      setUser(u);
      setSheet(null);
      setPickingRegion(false);
      setStage('app');
      window.scrollTo({ top: 0 });
      // Google on a new device / after signing out: look for the backup in Drive BEFORE the Dashboard is shown.
      if (u.provider === 'google' && googleConfigured && isDeviceEmpty(latest.current)) {
        setRestoring(true);
        restoreFromDrive({ interactive: true })
          .catch(() => null)
          .finally(() => setRestoring(false));
      }
    },
    [restoreFromDrive]
  );

  const returning = meta.onboarded || !isCompanyEmpty(company);
  // "Iniciar": a returning user goes straight on; a new one gets the single setup screen, with the country,
  // currency and language already taken from the device (nothing to answer).
  const start = () => {
    if (user || returning) return setStage('app');
    if (!settings.region) {
      const code = detectRegionCode();
      if (code) setSettings({ region: code, lang: detectLang(getRegion(code).lang) });
    }
    return setStage('setup');
  };
  const editing = sheet?.type === 'edit' ? projects?.find((p) => p.id === sheet.id) : null;
  const navActive = sheet?.type === 'settings' || sheet?.type === 'profile' ? 'settings' : tab;

  return (
    <I18nProvider lang={settings.lang} regionCode={active ? active.draft.regionCode : settings.region}>
      {restoring ? (
        <RestoreScreen />
      ) : stage === 'splash' ? (
        <SplashScreen onStart={start} auto={Boolean(user) || returning || Boolean(oauth)} timing={splash} pwa={pwa} />
      ) : stage === 'setup' ? (
        !region || pickingRegion ? (
          <RegionSelect
            initial={settings.region}
            onConfirm={confirmRegion}
            onChangeLang={changeLang}
            onCancel={region ? () => setPickingRegion(false) : () => setStage('splash')}
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

          {projects === null ? null : active ? (
            wsOn ? (
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
                onBack={closeProject}
                onEdit={() => setSheet({ type: 'edit', id: active.id })}
                onPro={openPaywall}
              />
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
              {tab === 'accounting' ? (
                <GlobalAccounting projects={projects} />
              ) : (
                <Dashboard projects={projects} tab={dashTab} onTab={setDashTab} onNew={requestNewProject} onOpen={openProject} onPro={() => openPaywall('promo')} />
              )}
              <BottomNav
                active={navActive}
                onProjects={() => {
                  setSheet(null);
                  setTab('projects');
                }}
                onAccounting={() => {
                  setSheet(null);
                  setTab('accounting');
                }}
                onSettings={() => setSheet({ type: 'settings' })}
              />
            </>
          )}

          {sheet?.type === 'new' && <ProjectSheet onSave={createProject} onClose={() => setSheet(null)} />}
          {editing && (
            <ProjectSheet project={editing} onSave={(f) => editProject(editing, f)} onDelete={() => deleteProject(editing.id)} onClose={() => setSheet(null)} />
          )}
          {sheet?.type === 'profile' && (
            <ProfileSheet company={company} logo={logo} drive={meta.drive} onSave={saveProfileFromSettings} onClose={() => setSheet({ type: 'settings' })} />
          )}
          {sheet?.type === 'settings' && (
            <SettingsSheet
              user={user}
              company={company}
              logo={logo}
              regionCode={settings.region}
              pwa={pwa}
              drive={meta.drive}
              onDriveChange={(v) => setMeta((m) => ({ ...m, drive: v }))}
              onEditProfile={() => setSheet({ type: 'profile' })}
              onSignIn={signIn}
              onChangeLang={changeLang}
              onChangeRegion={() => {
                setSheet(null);
                setPickingRegion(true);
              }}
              backup={{ configured: googleConfigured, enabled: backupOn, state: backup }}
              onBackupNow={async () => {
                const r = await sync.flush({ force: true, interactive: true });
                if (r.ok) setMeta((m) => (m.drive ? m : { ...m, drive: true }));
                return r;
              }}
              onRestore={() => restoreFromDrive({ interactive: true })}
              onLogout={logout}
              onClose={() => setSheet(null)}
            />
          )}
          {paywall && <ProPaywall feature={paywall} onClose={() => setPaywall(null)} />}
          <ToastHost />
        </>
      )}
    </I18nProvider>
  );
}
