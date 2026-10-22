import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emptySlots } from './lib/photos.js';
import { migrateLegacyPhotos, photoStoreFor } from './lib/photoStore.js';
import { projectStore } from './lib/projectStore.js';
import { logoStore } from './lib/companyStore.js';
import { hasIndexedDb } from './lib/db.js';
import { I18nProvider } from './lib/i18n.jsx';
import { getRegion, LANGS } from './lib/regions.js';
import { adoptCompany, newProject, projectTitle, toDayString } from './lib/projects.js';
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
import { localUser } from './lib/auth.js';
import { isPro, projectLimitReached } from './lib/pro.js';
import { usePWA } from './pwa/usePWA.js';
import RegionSelect from './components/RegionSelect.jsx';
import Login from './components/Login.jsx';
import Header from './components/Header.jsx';
import Wizard from './components/Wizard.jsx';
import Dashboard from './components/Dashboard.jsx';
import BottomNav from './components/BottomNav.jsx';
import ProjectSheet from './components/ProjectSheet.jsx';
import SettingsSheet from './components/SettingsSheet.jsx';
import ProfileSheet from './components/ProfileSheet.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import ProfileSetup from './components/ProfileSetup.jsx';
import ProPaywall from './components/ProPaywall.jsx';

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

export default function App() {
  const pwa = usePWA();
  const [settings, setSettings] = useState(loadSettings);
  const [user, setUser] = useState(loadUser);
  const [company, setCompany] = useState(loadCompany); // global profile (text); the logo lives in IndexedDB
  const [logo, setLogo] = useState('');
  const [projects, setProjects] = useState(null); // null while loading from IndexedDB
  const [activeId, setActiveId] = useState(null); // null = dashboard
  const [meta, setMeta] = useState(loadProfileMeta); // { onboarded, drive }
  // The welcome screen ('splash') is ALWAYS the first view of a new or signed-out user (nobody authenticated);
  // a stored user goes straight to the app. 'setup' is the registration (first run), 'app' shows Login when
  // there is no user.
  const [stage, setStage] = useState(() => (user ? 'app' : 'splash'));
  const [sheet, setSheet] = useState(null); // { type: 'new' | 'edit' | 'settings' | 'profile', id? } (profile is reached from Ajustes)
  const [pickingRegion, setPickingRegion] = useState(false);
  const [paywall, setPaywall] = useState(null); // null | 'promo' | 'projects' | 'drive' | 'ai': which locked feature opened the PRO screen
  const [photos, setPhotos] = useState(emptySlots);

  const region = getRegion(settings.region);
  const active = useMemo(() => projects?.find((p) => p.id === activeId) ?? null, [projects, activeId]);
  const activeRef = useRef(null);
  activeRef.current = active;

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveUser(user), [user]);
  useEffect(() => saveCompany(company), [company]);
  useEffect(() => saveProfileMeta(meta), [meta]);
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
    const id = setTimeout(() => projectStore.save(active).catch(() => {}), 250);
    return () => clearTimeout(id);
  }, [active]);
  useEffect(() => {
    const flush = () => activeRef.current && projectStore.save(activeRef.current).catch(() => {});
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // ---- project actions -------------------------------------------------------------------------------------
  const commit = useCallback((project) => {
    setProjects((list) => (list.some((p) => p.id === project.id) ? list.map((p) => (p.id === project.id ? project : p)) : [project, ...list]));
    projectStore.save(project).catch(() => {});
  }, []);

  const openProject = useCallback((id) => {
    setActiveId(id);
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
    setPhotos(emptySlots());
  }, []);

  // The open project's draft: all wizard edits flow through here.
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

  const createProject = (fields) => {
    // The company profile is COPIED into the new project: later profile changes never rewrite it.
    const project = newProject({ regionCode: settings.region, company, logo, ...fields });
    commit(project);
    setSheet(null);
    openProject(project.id);
  };

  const editProject = (project, fields) => {
    commit({
      ...project,
      startDate: fields.startDate,
      endDate: fields.endDate,
      updatedAt: Date.now(),
      draft: { ...project.draft, project: { name: sanitizeText(fields.name, 60).trim(), client: sanitizeText(fields.client, 60).trim() } },
    });
    setSheet(null);
  };

  const deleteProject = (id) => {
    projectStore.remove(id).catch(() => {});
    photoStoreFor(id).clear().catch(() => {});
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
  // Successful sign-in (Google or local profile): the user is stored (effect above), and we land on the
  // main view: no splash, no open sheet, no pending region picker.
  const signIn = useCallback((u) => {
    setUser(u);
    setSheet(null);
    setPickingRegion(false);
    setStage('app');
    window.scrollTo({ top: 0 });
  }, []);

  // Freemium gate for new projects: past the free limit the PRO screen opens instead of the form.
  const requestNewProject = useCallback(() => {
    if (projectLimitReached(projects?.length ?? 0, isPro())) {
      setSheet(null);
      setPaywall('projects');
      return;
    }
    setSheet({ type: 'new' });
  }, [projects]);

  const openPaywall = useCallback((feature = 'promo') => {
    setSheet(null);
    setPaywall(feature);
  }, []);

  const logout = useCallback(() => {
    closeProject();
    setSheet(null);
    setPaywall(null);
    setUser(null);
    setStage('splash'); // signed out: back to the welcome screen
  }, [closeProject]);

  const companyMissing = isCompanyEmpty(company) && !logo;
  const editing = sheet?.type === 'edit' ? projects?.find((p) => p.id === sheet.id) : null;
  const navActive = sheet?.type === 'settings' || sheet?.type === 'profile' ? 'settings' : 'projects';

  return (
    <I18nProvider lang={settings.lang} regionCode={active ? active.draft.regionCode : settings.region}>
      {stage === 'splash' ? (
        <SplashScreen
          returning={meta.onboarded || !isCompanyEmpty(company)}
          onStart={() => setStage(meta.onboarded || !isCompanyEmpty(company) ? 'app' : 'setup')}
          onLogin={() => setStage('app')}
        />
      ) : stage === 'setup' ? (
        !region ? (
          <RegionSelect initial={null} onConfirm={confirmRegion} onChangeLang={changeLang} onCancel={() => setStage('splash')} />
        ) : (
          <ProfileSetup onSave={finishSetup} onBack={() => setStage('splash')} />
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
          <Header subtitle={active ? projectTitle(active) || user.name : user.name} pwa={pwa} />

          {projects === null ? null : active ? (
            <Wizard
              key={active.id}
              projectId={active.id}
              draft={active.draft}
              setDraft={setDraft}
              photos={photos}
              setPhotos={setPhotos}
              company={active.company.signature || !company.signature ? active.company : { ...active.company, signature: company.signature }}
              startDate={active.startDate}
              endDate={active.endDate}
              onNewProject={() => {
                closeProject();
                requestNewProject();
              }}
              onExit={closeProject}
            />
          ) : (
            <>
              <Dashboard
                projects={projects}
                companyMissing={companyMissing}
                onNew={requestNewProject}
                onOpen={openProject}
                onEdit={(id) => setSheet({ type: 'edit', id })}
                onSettings={() => setSheet({ type: 'settings' })}
                onPro={() => openPaywall('promo')}
              />
              <BottomNav
                active={navActive}
                onProjects={() => setSheet(null)}
                onSettings={() => setSheet({ type: 'settings' })}
                onNew={requestNewProject}
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
              onLogout={logout}
              onClose={() => setSheet(null)}
            />
          )}
          {paywall && <ProPaywall feature={paywall} onClose={() => setPaywall(null)} />}
        </>
      )}
    </I18nProvider>
  );
}
