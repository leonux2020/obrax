import { useCallback, useEffect, useState } from 'react';
import { emptySlots } from './lib/photos.js';
import { photoStore } from './lib/photoStore.js';
import { I18nProvider } from './lib/i18n.jsx';
import { getRegion, LANGS } from './lib/regions.js';
import {
  loadSettings,
  saveSettings,
  loadUser,
  saveUser,
  loadDraft,
  saveDraft,
  clearDraft,
  newDraft,
  loadCompany,
  saveCompany,
  normalizeCompany,
} from './lib/draft.js';
import { usePWA } from './pwa/usePWA.js';
import RegionSelect from './components/RegionSelect.jsx';
import Login from './components/Login.jsx';
import Header from './components/Header.jsx';
import Wizard from './components/Wizard.jsx';
import CompanyModal from './components/CompanyModal.jsx';

export default function App() {
  const pwa = usePWA();
  const [settings, setSettings] = useState(loadSettings);
  const [user, setUser] = useState(loadUser);
  const [draft, setDraft] = useState(() => loadDraft(loadSettings().region));
  const [pickingRegion, setPickingRegion] = useState(false);
  const [company, setCompany] = useState(loadCompany);
  const [editingCompany, setEditingCompany] = useState(false);
  const [photos, setPhotos] = useState(emptySlots);

  // Photos live in IndexedDB (not in the draft): load them once on start.
  useEffect(() => {
    let alive = true;
    photoStore.load().then((p) => alive && setPhotos(p)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const region = getRegion(settings.region);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveUser(user), [user]);
  useEffect(() => saveCompany(company), [company]);
  useEffect(() => {
    if (draft) saveDraft(draft);
  }, [draft]);
  useEffect(() => {
    document.documentElement.lang = settings.lang;
  }, [settings.lang]);

  const confirmRegion = useCallback(
    (code) => {
      const r = getRegion(code);
      const changed = code !== settings.region;
      setSettings({ region: code, lang: changed ? r.lang : settings.lang });
      if (changed || !draft) {
        setDraft(newDraft(code, draft?.mode));
        photoStore.clear().catch(() => {});
        setPhotos(emptySlots());
      }
      setPickingRegion(false);
    },
    [settings, draft]
  );

  const newProject = useCallback(() => {
    clearDraft();
    photoStore.clear().catch(() => {});
    setPhotos(emptySlots());
    setDraft((d) => newDraft(settings.region, d?.mode));
  }, [settings.region]);

  const logout = useCallback(() => setUser(null), []);
  const changeLang = useCallback(
    (lang) => LANGS.includes(lang) && setSettings((s) => ({ ...s, lang })),
    []
  );

  return (
    <I18nProvider lang={settings.lang} regionCode={settings.region}>
      {!region || pickingRegion ? (
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
          <Header
            user={user}
            pwa={pwa}
            company={company}
            onEditCompany={() => setEditingCompany(true)}
            onChangeRegion={() => setPickingRegion(true)}
            onChangeLang={changeLang}
            onLogout={logout}
          />
          <Wizard
            draft={draft}
            setDraft={setDraft}
            photos={photos}
            setPhotos={setPhotos}
            company={company}
            onEditCompany={() => setEditingCompany(true)}
            onNewProject={newProject}
          />
          {editingCompany && (
            <CompanyModal
              company={company}
              onClose={() => setEditingCompany(false)}
              onSave={(c) => {
                setCompany(normalizeCompany(c));
                setEditingCompany(false);
              }}
            />
          )}
        </>
      )}
    </I18nProvider>
  );
}
