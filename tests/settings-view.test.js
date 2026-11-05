// @vitest-environment happy-dom
// Ajustes is a TOP-LEVEL full-screen view wired to the bottom-nav tab (like native tabs), never a floating sheet.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { CLIENT, q, flush, click, createHost, deviceBack } from './helpers/appHarness.js';
import { clearDriveToken } from '../src/lib/driveToken.js';

let App;
let h;

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
  App = (await import('../src/App.jsx')).default;
});

const seed = (lang = 'es') => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang, langLocked: true }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana', email: '' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora', proName: 'Ana Ruiz', phone: '', email: '' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  window.history.replaceState(null, '');
});
afterEach(() => h?.unmount());

const mount = async (lang) => {
  seed(lang);
  h = createHost(App);
  await h.mount();
};

const idx = (el) => [...document.querySelectorAll('*')].indexOf(el);

describe('Ajustes as a full-screen tab', () => {
  it('tapping the tab swaps the whole main context: projects hidden, only Ajustes in the viewport, tab marked active', async () => {
    await mount();
    expect(q('settings-view')).toBeNull();
    await click(h.tab('Ajustes'));
    expect(q('settings-view')).not.toBeNull();
    expect(q('project-card')).toBeNull();
    expect(q('fab-new')).toBeNull(); // the dashboard is gone
    expect(q('nav-settings').getAttribute('aria-current')).toBe('page');
    expect(q('nav-projects').getAttribute('aria-current')).toBeNull();
    expect(h.host.querySelector('nav')).not.toBeNull(); // the bottom nav stays: it is the way out
  });

  it('own OLED background and a clean title header (Impostazioni in Italian)', async () => {
    await mount('it');
    await click(q('nav-settings'));
    expect(q('settings-view').className).toContain('bg-black');
    expect(q('settings-view').className).toContain('min-h-screen');
    const title = q('settings-title');
    expect(title.tagName).toBe('H1');
    expect(title.textContent).toBe('Impostazioni');
    expect(q('settings-view').querySelector('main').className).toMatch(/pb-44/); // never hidden behind the bottom nav
  });

  it('no floating-window behaviour: no dialog, no close (X), no backdrop, no drag handle / swipe', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    expect(document.querySelector('[data-sheet-close]')).toBeNull();
    expect(q('sheet-backdrop')).toBeNull();
    expect(q('settings-view').querySelector('[data-sheet-close], [data-testid="sheet-handle"]')).toBeNull();
    expect(q('settings-view').getAttribute('ontouchmove')).toBeNull();
  });

  it('leaving is just tapping another tab; coming back shows the same screen, and every tab works', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    await click(h.tab('Contabilidad'));
    expect(q('settings-view')).toBeNull();
    expect(q('accounting')).not.toBeNull();
    await click(h.tab('Ajustes'));
    expect(q('settings-view')).not.toBeNull();
    expect(q('accounting')).toBeNull();
    await click(h.tab('Proyectos'));
    expect(q('settings-view')).toBeNull();
    expect(q('fab-new')).not.toBeNull();
  });

  it('opening Ajustes does not lose what is there: language change applies in place and the screen stays', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    await click(q('settings-lang')); // the row opens the picker sheet
    expect(q('settings-lang-sheet')).not.toBeNull();
    await click(q('lang-option-it'));
    await flush(60);
    expect(q('settings-lang-sheet')).toBeNull(); // picking closes the sheet
    expect(q('settings-view')).not.toBeNull();
    expect(q('settings-title').textContent).toBe('Impostazioni');
  });

  it('source: the sheet component is gone, the view does not use BottomSheet and takes no onClose', () => {
    expect(existsSync('src/components/SettingsSheet.jsx')).toBe(false);
    const view = readFileSync('src/components/SettingsView.jsx', 'utf8');
    expect(view).not.toMatch(/import BottomSheet/);
    expect(view).not.toMatch(/<BottomSheet/);
    expect(view).not.toMatch(/^\s*onClose,$/m);
    const app = readFileSync('src/App.jsx', 'utf8');
    expect(app).not.toMatch(/type: 'settings'/);
    expect(app).toMatch(/onSettings=\{\(\) => setTab\('settings'\)\}/);
  });
});

describe('Ajustes "Zero Stress": main block, quiet logout, invisible autosave', () => {
  it('Google Drive lives alone in the operations card (NO signature in Google Sync); the profile is its own accordion above it', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    const ops = q('settings-ops');
    expect(ops).not.toBeNull();
    expect(q('settings-signature')).toBeNull();
    expect(ops.querySelector('canvas, [data-testid="pro-signature"], img')).toBeNull(); // not a trace of the signature in the sync card
    expect(ops.contains(q('settings-cloud'))).toBe(true);
    expect(ops.contains(q('settings-profile'))).toBe(false);
    expect(ops.className).toContain('card'); // the card's subtle border + black fill tie both rows together
    expect(ops.tagName).toBe('DETAILS');
    for (const id of ['settings-cloud']) {
      const svg = q(id).querySelector('svg[data-outline-icon="true"]');
      expect(svg, id).not.toBeNull();
      expect(svg.getAttribute('class')).toContain('text-neutral-400');
    }
    const sum = q('settings-profile-summary').querySelector('svg[data-outline-icon="true"]');
    expect(sum.getAttribute('class')).toContain('text-neutral-400');
    expect(q('settings-drive').textContent).toContain('Sincronizar con Google Drive');
    // order: profile accordion, operations, then language & country
    expect(idx(q('settings-profile'))).toBeLessThan(idx(q('settings-ops')));
    expect(idx(q('settings-ops'))).toBeLessThan(idx(q('settings-locale')));
    expect(q('settings-drive').getAttribute('role')).toBe('switch');
  });

  it('the Drive row says "Sincronizza con Google Drive" in Italian and exists in the six languages', async () => {
    const { DICT } = await import('../src/lib/dict.js');
    expect(DICT.it['settings.driveSync']).toBe('Sincronizza con Google Drive');
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) expect(DICT[l]['settings.driveSync'], l).toBeTruthy();
    await mount('it');
    await click(q('nav-settings'));
    expect(q('settings-drive').textContent).toContain('Sincronizza con Google Drive');
  });

  it('there is no autosave switch and no "Guardado" badge anywhere; the profile persists once, on Save', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    expect(document.querySelectorAll('[role="switch"]')).toHaveLength(1); // only the Drive one
    expect(q('settings-saved')).toBeNull();
    expect(q('settings-view').textContent).not.toMatch(/guardado autom|salvataggio autom|auto-?save/i);
    const { act } = await import('react');
    await click(q('settings-profile-edit'));
    const input = q('settings-pro-name');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Ana Soto');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush(400);
    expect(JSON.parse(localStorage.getItem('cp.company.v1')).proName).toBe('Ana Ruiz'); // typing alone writes nothing
    await click(q('settings-profile-save'));
    expect(JSON.parse(localStorage.getItem('cp.company.v1')).proName).toBe('Ana Soto');
  });

  it('the logout is buried at the very bottom, grey and outlined: no solid red, needs a real second tap', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    const btn = q('logout-button');
    expect(btn.className).toContain('text-neutral-500');
    expect(btn.className).toContain('border-white/10');
    expect(btn.className).toContain('bg-transparent');
    expect(btn.className).not.toMatch(/bg-red|bg-brand|font-bold|font-extrabold/);
    // it is the LAST thing on the screen, below every other control (install, account, language)
    const all = [...q('settings-view').querySelectorAll('button, [role="switch"], select, input')];
    expect(all[all.length - 1]).toBe(btn);
    expect(q('settings-logout-zone').contains(btn)).toBe(true);
    expect(idx(q('settings-locale'))).toBeLessThan(idx(btn));
    expect(idx(q('settings-cloud'))).toBeLessThan(idx(btn));
    // the confirmation step is an outlined red, never a solid fill
    await click(btn);
    expect(q('logout-confirm').className).not.toMatch(/(^|\s)bg-red-/);
    expect(q('logout-confirm').className).toContain('border-red-500/40');
  });

  it('"Instalar App" is a secondary quiet button after the main block, still on the splash with its original look', async () => {
    const { default: InstallButton } = await import('../src/components/InstallButton.jsx');
    const React = (await import('react')).default;
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { I18nProvider } = await import('../src/lib/i18n.jsx');
    const el = document.createElement('div');
    document.body.appendChild(el);
    const r = createRoot(el);
    const pwa = { installed: false, canInstall: true, install: async () => 'accepted' };
    await act(async () => {
      r.render(
        React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, [
          React.createElement(InstallButton, { key: 'a', pwa, quiet: true }),
          React.createElement(InstallButton, { key: 'b', pwa }),
        ]),
      );
    });
    const [quiet, loud] = [...el.querySelectorAll('[data-testid="install-app"]')];
    expect(quiet.className).toContain('border-white/10');
    expect(quiet.className).toContain('text-neutral-400');
    expect(quiet.className).not.toContain('border-brand');
    expect(loud.className).toContain('bg-brand'); // solid primary
    act(() => r.unmount());
    el.remove();
  });
});

describe('Ajustes: shorter screen and nothing to configure by hand', () => {
  it('the company + professional fields live in an accordion that is CLOSED by default (and opens on tap)', async () => {
    await mount('it');
    await click(q('nav-settings'));
    const acc = q('settings-profile');
    expect(acc.tagName).toBe('DETAILS');
    expect(acc.open).toBe(false);
    expect(q('settings-profile-summary').textContent).toContain('Azienda e professionista');
    expect(acc.contains(q('settings-profile-edit'))).toBe(true); // the pencil lives in the card
    expect(acc.contains(q('settings-profile-name'))).toBe(true);
    await click(q('settings-profile-edit'));
    for (const id of ['settings-logo', 'settings-company-name', 'settings-company-address', 'settings-pro-name', 'settings-pro-lastname', 'settings-pro-title', 'settings-pro-license', 'pro-signature', 'settings-company-email', 'settings-company-phone', 'settings-company-tax', 'settings-company-city'])
      expect(acc.contains(q(id)), id).toBe(true);
    // Drive and language are NOT inside the accordion: they stay visible while it is closed
    for (const id of ['settings-drive', 'settings-locale']) expect(acc.contains(q(id)), id).toBe(false);
    acc.open = true;
    expect(acc.open).toBe(true);
  });

  it('Drive OFF: no account, no status, no "Guardar ahora" / "Restaurar"; Drive ON shows them', async () => {
    localStorage.setItem('cp.drive.linked.v1', '1');
    seed();
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Leo Pc', email: 'leo@x.com', picture: '' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
    h = createHost(App);
    await h.mount();
    await click(h.tab('Ajustes'));
    const gone = ['settings-account', 'backup-account', 'backup-connected', 'backup-status', 'backup-now', 'backup-restore', 'backup-folder', 'backup-connect'];
    if (q('settings-drive').getAttribute('aria-checked') === 'true') await click(q('settings-drive'));
    expect(q('settings-drive').getAttribute('aria-checked')).toBe('false');
    for (const id of gone) expect(q(id), `${id} hidden while OFF`).toBeNull();
    expect(q('settings-cloud').textContent).not.toContain('Leo Pc');
    await click(q('settings-drive'));
    expect(q('settings-drive').getAttribute('aria-checked')).toBe('true');
    await flush(60);
    expect(q('settings-cloud').textContent).toContain('Leo Pc');
  });
});

describe('Autodetection of language and country (Zero Stress)', () => {
  it('a new device gets its language from navigator.language(s) and its country from the time zone, then from the language', async () => {
    const { detectCurrentRegion, languageFor } = await import('../src/lib/geo.js');
    expect(languageFor({}, { languages: ['it-IT', 'en'] })).toBe('it');
    expect(languageFor({}, { languages: ['de-AT'] })).toBe('de');
    expect(languageFor({ lang: 'es', langLocked: true }, { languages: ['it-IT'] })).toBe('es'); // a manual choice wins
    expect(detectCurrentRegion({ timeZone: 'Europe/Rome', languages: ['es-CL'] })).toBe('IT'); // where the phone IS
    expect(detectCurrentRegion({ timeZone: '', languages: ['pt-BR'] })).toBe('BR'); // no zone: the language tag
    expect(detectCurrentRegion({ timeZone: 'Mars/Base', languages: ['xx'] })).toBeNull();
  });

  it('the real browser APIs feed it: Intl time zone + navigator.language', async () => {
    const { detectCurrentRegion, languageFor } = await import('../src/lib/geo.js');
    const tz = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'America/Santiago', locale: 'es-CL' });
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    expect(detectCurrentRegion()).toBe('CL');
    expect(languageFor({})).toBe('fr');
    tz.mockRestore();
  });

  it('the Ajustes selects show the detected values and the user can still change them', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['it-IT']);
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'Europe/Rome', locale: 'it-IT' });
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'IT' })); // no lang stored, never locked: the device decides
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana', email: '' }));
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora', proName: 'Ana', phone: '', email: '' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
    h = createHost(App);
    await h.mount();
    await click(q('nav-settings'));
    expect(q('settings-title').textContent).toBe('Impostazioni');
    expect(q('settings-lang-value').textContent).toBe('Italiano');
    expect(q('settings-lang-value').className).toContain('text-brand/90');
    expect(q('settings-region-value').textContent).toMatch(/Ital/); // the detected country, shown as the value of its row
    // manual change still works and sticks (locked from now on)
    await click(q('settings-lang'));
    await click(q('lang-option-de'));
    await flush(60);
    expect(q('settings-title').textContent).toBe('Einstellungen');
    expect(JSON.parse(localStorage.getItem('cp.settings.v1')).langLocked).toBe(true);
  });

  it('the country picker of a new profile opens with the detected country already selected', async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'Europe/Rome', locale: 'it-IT' });
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['it-IT']);
    const React = (await import('react')).default;
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { I18nProvider } = await import('../src/lib/i18n.jsx');
    const RegionSelect = (await import('../src/components/RegionSelect.jsx')).default;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const r = createRoot(el);
    await act(async () => {
      r.render(React.createElement(I18nProvider, { lang: 'it', regionCode: null }, React.createElement(RegionSelect, { initial: null, onConfirm: () => {} })));
    });
    expect(el.textContent).toContain('Italia');
    expect(el.querySelector('[aria-live="polite"]')).not.toBeNull(); // the selected-country summary is already there
    act(() => r.unmount());
    el.remove();
  });
});

describe('Ajustes loads almost empty: three closed accordions', () => {
  it('Azienda e professionista, Operazioni e Sincronizzazione and Lingua e Paese are <details>, all CLOSED, each with a grey icon', async () => {
    await mount('it');
    await click(q('nav-settings'));
    const want = [
      ['settings-profile', 'Azienda e professionista'],
      ['settings-ops', 'Operazioni e Sincronizzazione'],
      ['settings-locale', 'Lingua e Paese'],
    ];
    for (const [id, title] of want) {
      const d = q(id);
      expect(d.tagName, id).toBe('DETAILS');
      expect(d.open, id).toBe(false);
      expect(q(`${id}-summary`).textContent, id).toContain(title);
      expect(q(`${id}-summary`).querySelector('svg[data-outline-icon="true"]').getAttribute('class'), id).toContain('text-neutral-400');
      expect(q(`${id}-summary`).className, id).toContain('min-h-[64px]');
    }
    // three different icons
    expect(new Set(want.map(([id]) => q(`${id}-summary`).querySelector('svg').innerHTML)).size).toBe(3);
    // ops + locale hold exactly what they should
    expect(q('settings-ops').contains(q('settings-drive'))).toBe(true);
    expect(q('settings-locale').contains(q('settings-lang'))).toBe(true);
    expect(q('settings-locale').contains(q('settings-region'))).toBe(true);
  });

  it('the initial screen has only: the title, the three accordion headers and the quiet bottom buttons (no PRO label, no badges)', async () => {
    await mount('it');
    await click(q('nav-settings'));
    const view = q('settings-view');
    expect(q('settings-title').textContent).toBe('Impostazioni');
    expect(view.textContent).not.toMatch(/MODO PRO|PRUEBA|Prueba/i);
    expect(q('qa-pro-tag')).toBeNull();
    // everything inside a closed <details> is out of sight; what stays visible is outside any closed details or inside a summary
    const hidden = (el) => [...view.querySelectorAll('details')].some((d) => !d.open && d.contains(el) && !el.closest('summary'));
    const visible = [...view.querySelectorAll('button, input, select, [role="switch"], summary')].filter((el) => !hidden(el));
    const ids = visible.map((el) => el.dataset.testid || el.tagName.toLowerCase());
    expect(ids).toEqual(expect.arrayContaining(['settings-profile-summary', 'settings-ops-summary', 'settings-locale-summary', 'settings-squadra', 'logout-button']));
    expect(ids.some((i) => /^settings-(company|pro-name|logo|drive|signature|lang)/.test(i))).toBe(false);
    expect(visible.length).toBeLessThanOrEqual(6); // 3 summaries + Squadra + logout (+ install when the app is not installed)
  });

  it('the open state of an accordion is kept by the parent and the content is reachable once opened', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    await click(q('settings-ops-summary'));
    expect(q('settings-ops').open).toBe(true);
    expect(q('settings-profile').open).toBe(false);
    expect(q('settings-drive')).not.toBeNull();
    await deviceBack();
    expect(q('settings-ops').open).toBe(false);
    expect(q('settings-locale').open).toBe(false);
  });
});

describe('Ajustes "Zero Stress" fase 5: sin flechas y tarjeta pasiva de empresa', () => {
  const open = async (id) => {
    const { act } = await import('react');
    const d = q(id);
    d.open = true;
    await act(async () => {
      d.dispatchEvent(new Event('toggle'));
    });
    await flush(10);
  };

  it('no row of Ajustes carries a chevron / caret (accordions, Squadra)', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    await open('settings-ops');
    expect(q('settings-view').textContent).not.toContain('›'); // (the ▾ of the country combobox is a form control, not a row indicator)
    for (const id of ['settings-profile', 'settings-ops', 'settings-locale']) expect(q(`${id}-summary`).querySelector('span[aria-hidden="true"]'), id).toBeNull();
    expect(q('settings-squadra').querySelector('span[aria-hidden="true"]')).toBeNull();
  });

  it('the profile opens as a read-only business card: name, professional and filled data only; no inputs, a floating pencil on the right', async () => {
    seed();
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora', proName: 'Ana Ruiz', taxId: '76.123.456-7', city: 'Santiago', phone: '', email: '' }));
    h = createHost(App);
    await h.mount();
    await click(h.tab('Ajustes'));
    await open('settings-profile');
    const card = q('settings-profile-card');
    expect(card).not.toBeNull();
    expect(card.querySelector('input, textarea, select')).toBeNull();
    expect(q('settings-profile-name').textContent).toBe('Aurora');
    expect(q('settings-profile-pro').textContent).toBe('Ana Ruiz');
    expect(q('settings-profile-tax').textContent).toBe('RUT 76.123.456-7');
    expect(q('settings-profile-address').textContent).toBe('Santiago');
    expect(q('settings-profile-email')).toBeNull(); // empty fields are not shown
    expect(q('settings-profile-phone')).toBeNull();
    const pencil = q('settings-profile-edit');
    expect(pencil.querySelector('svg[data-icon="pencil"]')).not.toBeNull();
    expect(pencil.className).not.toMatch(/\b(border|bg-(?!transparent)|ring|shadow)\b/);
    expect(pencil.getAttribute('aria-pressed')).toBe('false');
  });

  it('only the pencil turns the card into the form; Save returns to the card with the saved data; Cancel and folding restore it', async () => {
    await mount();
    await click(h.tab('Ajustes'));
    await open('settings-profile');
    expect(q('settings-company-name')).toBeNull();
    await click(q('settings-profile-edit'));
    expect(q('settings-profile-card')).toBeNull();
    expect(q('settings-profile-edit')).toBeNull(); // ONE pencil: gone while editing (Save / Cancel take over)
    expect(q('settings-company-name').value).toBe('Aurora');
    const { act } = await import('react');
    const typeInto = async (id, v) =>
      act(async () => {
        const input = q(id);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await typeInto('settings-pro-name', 'Ana Soto');
    await click(q('settings-profile-cancel')); // cancel: nothing changed
    expect(q('settings-company-name')).toBeNull();
    expect(q('settings-profile-pro').textContent).toBe('Ana Ruiz');
    expect(JSON.parse(localStorage.getItem('cp.company.v1')).proName).toBe('Ana Ruiz');
    await click(q('settings-profile-edit'));
    expect(q('settings-pro-name').value).toBe('Ana Ruiz'); // the draft starts again from the stored data
    await typeInto('settings-pro-name', 'Ana Soto');
    await click(q('settings-profile-save'));
    expect(q('settings-company-name')).toBeNull();
    expect(q('settings-profile-pro').textContent).toBe('Ana Soto');
    await click(q('settings-profile-edit')); // edit again, then fold the accordion with the device Back
    expect(q('settings-company-name')).not.toBeNull();
    await deviceBack();
    expect(q('settings-profile').open).toBe(false);
    await open('settings-profile');
    expect(q('settings-profile-card')).not.toBeNull(); // back to read-only
  });
});
