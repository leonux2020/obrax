import { useCallback, useEffect, useState } from 'react';
import { I18nProvider } from './lib/i18n.jsx';
import { getRegion } from './lib/regions.js';
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
      if (changed || !draft) setDraft(newDraft(code));
      setPickingRegion(false);
    },
    [settings, draft]
  );

  const newProject = useCallback(() => {
    clearDraft();
    setDraft(newDraft(settings.region));
  }, [settings.region]);

  const logout = useCallback(() => setUser(null), []);
  const toggleLang = useCallback(
    () => setSettings((s) => ({ ...s, lang: s.lang === 'es' ? 'en' : 'es' })),
    []
  );

  return (
    <I18nProvider lang={settings.lang} regionCode={settings.region}>
      {!region || pickingRegion ? (
        <RegionSelect
          initial={settings.region}
          onConfirm={confirmRegion}
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
            onToggleLang={toggleLang}
            onLogout={logout}
          />
          <Wizard
            draft={draft}
            setDraft={setDraft}
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
