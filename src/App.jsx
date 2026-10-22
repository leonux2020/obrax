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
  // 'splash' -> 'setup' only on a brand-new install (nothing saved at all); 'app' for everybody else, always.
  const [stage, setStage] = useState(() => (!settings.region && !user && isCompanyEmpty(company) && !meta.onboarded ? 'splash' : 'app'));
  const [sheet, setSheet] = useState(null); // { type: 'new' | 'edit' | 'settings' | 'profile', id? } (profile is reached from Ajustes)
  const [pickingRegion, setPickingRegion] = useState(false);
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
      if (list.length > 0) setStage('app'); // saved work exists: never greet an existing user with the splash
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
  const logout = useCallback(() => {
    closeProject();
    setSheet(null);
    setUser(null);
  }, [closeProject]);

  const companyMissing = isCompanyEmpty(company) && !logo;
  const editing = sheet?.type === 'edit' ? projects?.find((p) => p.id === sheet.id) : null;
  const navActive = sheet?.type === 'settings' || sheet?.type === 'profile' ? 'settings' : 'projects';

  return (
    <I18nProvider lang={settings.lang} regionCode={active ? active.draft.regionCode : settings.region}>
      {stage === 'splash' ? (
        <SplashScreen onStart={() => setStage('setup')} />
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
        <Login onLogin={setUser} />
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
              company={active.company}
              onNewProject={() => {
                closeProject();
                setSheet({ type: 'new' });
              }}
              onExit={closeProject}
            />
          ) : (
            <>
              <Dashboard
                projects={projects}
                companyMissing={companyMissing}
                onNew={() => setSheet({ type: 'new' })}
                onOpen={openProject}
                onEdit={(id) => setSheet({ type: 'edit', id })}
                onSettings={() => setSheet({ type: 'settings' })}
              />
              <BottomNav
                active={navActive}
                onProjects={() => setSheet(null)}
                onSettings={() => setSheet({ type: 'settings' })}
                onNew={() => setSheet({ type: 'new' })}
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
              onEditProfile={() => setSheet({ type: 'profile' })}
              onChangeLang={changeLang}
              onChangeRegion={() => {
                setSheet(null);
                setPickingRegion(true);
              }}
              onLogout={logout}
              onClose={() => setSheet(null)}
            />
          )}
        </>
      )}
    </I18nProvider>
  );
}
