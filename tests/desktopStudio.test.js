// @vitest-environment happy-dom
// CUBRAX Studio, phase 2 step 1: responsive switch (phone <1024 / desktop >=1024), three-column layout, Copilot mock chat, OLED markup.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import App from '../src/App.jsx';
import DesktopLayout from '../src/components/DesktopLayout.jsx';
import AgentChat from '../src/components/AgentChat.jsx';
import { I18nProvider } from '../src/lib/i18n.jsx';
import { DESKTOP_MIN_WIDTH, isDesktopWidth } from '../src/lib/useIsDesktop.js';
import { COPILOT_LIMITS, cleanReply, createEchoCopilot } from '../src/lib/copilot.js';
import { newProject } from '../src/lib/projects.js';
import { projectStore } from '../src/lib/projectStore.js';
import { DICT } from '../src/lib/dict.js';
import { q, flush, click, createHost, createProjectViaDraft } from './helpers/appHarness.js';
import { setViewport, PHONE, DESKTOP } from './helpers/viewport.js';
import { geminiFetch, geminiReply, seedKey, TEST_KEY } from './helpers/gemini.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const wrap = (el) => h(I18nProvider, { lang: 'es', regionCode: 'CL' }, el);
const echoChat = () => h(AgentChat, { reply: createEchoCopilot({ delayMs: 0 }) });
const read = (f) => readFileSync(`src/${f}`, 'utf8');
const setNative = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('the rule: from 1024 px it is a desktop', () => {
  it('isDesktopWidth: 1023 no, 1024 yes, garbage never', () => {
    expect(DESKTOP_MIN_WIDTH).toBe(1024);
    expect(isDesktopWidth(1023)).toBe(false);
    expect(isDesktopWidth(1024)).toBe(true);
    expect(isDesktopWidth(1920)).toBe(true);
    for (const bad of [NaN, undefined, null, '1280', 0, -5, Infinity, {}]) expect(isDesktopWidth(bad)).toBe(false);
  });
});

describe('the echo agent contract', () => {
  const t = (k) => ({ 'studio.chat.echo': 'Analizando...' })[k];
  it('answers "Analizando... <text>" and nothing leaves the device (a pure local function)', async () => {
    const echo = createEchoCopilot({ delayMs: 0 });
    expect(await echo('losa de 20 m2', { t })).toBe('Analizando... losa de 20 m2');
  });
  it('cleanReply keeps strings, trims and bounds them; anything else is an empty answer', () => {
    expect(cleanReply('  hola ')).toBe('hola');
    expect(cleanReply('x'.repeat(COPILOT_LIMITS.replyChars + 50))).toHaveLength(COPILOT_LIMITS.replyChars);
    for (const bad of [undefined, null, NaN, 42, {}, []]) expect(cleanReply(bad)).toBe('');
  });
});

describe('AgentChat', () => {
  let host;
  let root;
  const draw = async (el) => act(async () => root.render(wrap(el)));
  const scoped = (id) => host.querySelector(`[data-testid="${id}"]`);
  const send = async (text) => {
    await setNative(scoped('agent-input'), text);
    await act(async () => {
      scoped('agent-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush(10);
  };
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('starts clean: an invitation, no messages, the send button waits for text', async () => {
    await draw(echoChat());
    expect(scoped('agent-empty')).not.toBeNull();
    expect(scoped('agent-send').disabled).toBe(true);
    await setNative(scoped('agent-input'), '   ');
    expect(scoped('agent-send').disabled).toBe(true); // blank is nothing
  });

  it('a question shows on the right, the echo "Analizando..." answers on the left, the input is cleared', async () => {
    await draw(echoChat());
    await send('  ¿Cuánto cemento?  ');
    const msgs = [...host.querySelectorAll('[data-role]')];
    expect(msgs.map((m) => m.dataset.role)).toEqual(['user', 'agent']);
    expect(msgs[0].textContent).toBe('¿Cuánto cemento?');
    expect(msgs[1].textContent).toBe('Analizando... ¿Cuánto cemento?');
    expect(scoped('agent-input').value).toBe('');
    expect(scoped('agent-empty')).toBeNull();
    expect(scoped('agent-thinking')).toBeNull();
  });

  it('shows the typing dots while the agent works, and accepts one question at a time', async () => {
    let finish;
    const slow = () => new Promise((resolve) => (finish = resolve));
    await draw(h(AgentChat, { reply: slow }));
    await send('uno');
    expect(scoped('agent-thinking')).not.toBeNull();
    expect(scoped('agent-send').disabled).toBe(true);
    await send('dos'); // ignored while thinking
    expect(host.querySelectorAll('[data-role="user"]')).toHaveLength(1);
    await act(async () => finish('respuesta'));
    expect(scoped('agent-thinking')).toBeNull();
    expect(host.querySelectorAll('[data-role="agent"]')[0].textContent).toBe('respuesta');
  });

  it('a failing or empty agent never breaks the panel: a quiet apology', async () => {
    await draw(h(AgentChat, { reply: async () => { throw new Error('boom'); } }));
    await send('hola');
    expect(host.querySelector('[data-role="agent"]').textContent).toBe(DICT.es['studio.chat.error']);
    await draw(h(AgentChat, { reply: async () => null }));
    await send('otra');
    expect(scoped('agent-thinking')).toBeNull();
  });

  it('each failure of the agent has its own quiet sentence, is flagged and does NOT travel as part of the conversation', async () => {
    const seen = [];
    let n = 0;
    const codes = ['no_key', 'bad_key', 'rate_limited', 'timeout'];
    const reply = async (text, { history, signal }) => {
      seen.push({ text, history, aborted: signal?.aborted });
      if (n < codes.length) throw Object.assign(new Error('x'), { code: codes[n++] });
      return 'respuesta real';
    };
    await draw(h(AgentChat, { reply }));
    for (const text of ['uno', 'dos', 'tres', 'cuatro']) await send(text);
    const agents = [...host.querySelectorAll('[data-role="agent"]')].map((el) => el.textContent);
    expect(agents).toEqual(['no_key', 'bad_key', 'rate_limited', 'network'].map((k) => DICT.es[`studio.chat.err.${k}`]));
    await send('cinco');
    expect([...host.querySelectorAll('[data-role="agent"]')].pop().textContent).toBe('respuesta real');
    // the apologies are in the panel, but the next question carries only real turns (here: the 4 user questions, no agent answers)
    const last = seen.at(-1);
    expect(last.history.filter((m) => m.error)).toHaveLength(0);
    expect(last.history.every((m) => m.role === 'user')).toBe(true);
    expect(seen.every((s) => s.aborted === false)).toBe(true);
  });

  it('closing the panel cancels the question in flight and nothing is painted afterwards', async () => {
    let signal;
    let release;
    await draw(h(AgentChat, { reply: (text, ctx) => { signal = ctx.signal; return new Promise((r) => { release = r; }); } }));
    await send('hola');
    expect(signal.aborted).toBe(false);
    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
    release('tarde');
    root = createRoot(host); // (afterEach unmounts it)
  });

  it('long input is bounded and HTML is only text', async () => {
    await draw(echoChat());
    await setNative(scoped('agent-input'), 'a'.repeat(COPILOT_LIMITS.inputChars + 200));
    expect(scoped('agent-input').value.length).toBeLessThanOrEqual(COPILOT_LIMITS.inputChars);
    await setNative(scoped('agent-input'), '<img src=x onerror=alert(1)>');
    await act(async () => scoped('agent-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush(10);
    expect(host.querySelector('img')).toBeNull();
  });
});

describe('DesktopLayout (three columns)', () => {
  let host;
  let root;
  const calls = [];
  const mk = (name, client) => {
    const p = newProject({ regionCode: 'CL', name, client });
    return p;
  };
  const projects = [mk('Casa Norte', 'Ana'), mk('Bodega Sur', '')];
  const draw = async (props = {}, child = h('p', { 'data-testid': 'child' }, 'hoy')) =>
    act(async () =>
      root.render(
        wrap(
          h(
            DesktopLayout,
            {
              projects,
              tab: 'projects',
              onProjects: () => calls.push('projects'),
              onAccounting: () => calls.push('accounting'),
              onSettings: () => calls.push('settings'),
              onOpenProject: (id) => calls.push(`open:${id}`),
              onNew: () => calls.push('new'),
              ...props,
            },
            child
          )
        )
      )
    );
  beforeEach(() => {
    calls.length = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('three columns: a 250 px menu, a fluid centre holding the screen, a 300 px copilot', async () => {
    await draw();
    expect(q('desktop-sidebar').className).toContain('w-[250px]');
    expect(q('desktop-center').contains(q('child'))).toBe(true);
    expect(q('desktop-center').className).toContain('flex-1');
    expect(q('desktop-copilot').className).toContain('w-[300px]');
    expect(q('desktop-copilot').contains(q('agent-chat'))).toBe(true);
    expect(q('desktop-center').className).toContain('translateZ(0)'); // fixed sheets / dock stay inside the work panel
  });

  it('the menu lists the active projects (closed ones are History) and calls back with the right action', async () => {
    const closed = { ...mk('Cerrada', ''), closedAt: Date.now() };
    await draw({ projects: [...projects, closed] });
    expect(q('side-projects-list').querySelectorAll('li')).toHaveLength(2);
    expect(q('side-projects-list').textContent).not.toContain('Cerrada');
    await click(q(`side-project-${projects[0].id}`));
    await click(q('side-accounting'));
    await click(q('side-settings'));
    await click(q('side-projects'));
    await click(q('side-new'));
    expect(calls).toEqual([`open:${projects[0].id}`, 'accounting', 'settings', 'projects', 'new']);
  });

  it('empty / garbage project lists heal to a quiet message, never a crash', async () => {
    for (const bad of [[], null, undefined, [null, undefined]]) {
      await draw({ projects: bad });
      expect(q('side-empty')).not.toBeNull();
    }
  });

  it('marks where you are (aria-current) and a project without a name still has a label', async () => {
    await draw({ tab: 'accounting' });
    expect(q('side-accounting').getAttribute('aria-current')).toBe('page');
    expect(q('side-projects').getAttribute('aria-current')).toBeNull();
    await draw({ openId: projects[1].id });
    expect(q(`side-project-${projects[1].id}`).getAttribute('aria-current')).toBe('page');
    expect(q('side-projects').getAttribute('aria-current')).toBeNull();
    await draw({ projects: [{ ...mk('', ''), name: '' }] });
    expect(q('side-projects-list').textContent.trim().length).toBeGreaterThan(0);
  });

  it('locked (a draft is open): the menu waits', async () => {
    await draw({ locked: true });
    for (const id of ['side-projects', 'side-accounting', 'side-settings', 'side-new', `side-project-${projects[0].id}`]) expect(q(id).disabled, id).toBe(true);
  });

  it('the copilot folds to a rail and unfolds KEEPING the conversation', async () => {
    await draw();
    await setNative(q('agent-input'), 'hola');
    await act(async () => q('agent-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush(600); // the echo's human pause
    expect(host.querySelectorAll('[data-role]')).toHaveLength(2);
    await click(q('copilot-toggle'));
    expect(q('desktop-copilot').dataset.open).toBe('false');
    expect(q('desktop-copilot').className).toContain('w-14');
    expect(q('copilot-toggle').getAttribute('aria-expanded')).toBe('false');
    await click(q('copilot-toggle'));
    expect(q('desktop-copilot').dataset.open).toBe('true');
    expect(host.querySelectorAll('[data-role]')).toHaveLength(2);
  });

  it('the banner (offline / update) sits on top of the work panel', async () => {
    await draw({ banner: h('p', { 'data-testid': 'banner' }, 'sin conexión') });
    expect(q('desktop-center').contains(q('banner'))).toBe(true);
  });
});

describe('App: phone interface under 1024 px, CUBRAX Studio from 1024 px, live', () => {
  let h;
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana' }));
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true }));
    for (const p of await projectStore.load()) await projectStore.remove(p.id);
    await setViewport(PHONE);
    h = createHost(App);
    await h.mount();
  });
  afterEach(async () => {
    h?.unmount();
    vi.unstubAllGlobals();
    localStorage.clear();
    await setViewport(PHONE);
  });

  it('phone: bottom tab bar, no desktop frame', () => {
    expect(q('nav-projects')).not.toBeNull();
    expect(q('desktop-layout')).toBeNull();
    expect(q('agent-chat')).toBeNull();
  });

  it('crossing 1024 px swaps the bottom bar for the three columns, and back, without losing the screen', async () => {
    await setViewport(1023);
    expect(q('desktop-layout')).toBeNull();
    await setViewport(1024);
    expect(q('desktop-layout')).not.toBeNull();
    expect(q('nav-projects')).toBeNull(); // no bottom bar on the desktop
    expect(q('fab-new')).not.toBeNull(); // the list is the same screen, in the centre
    expect(q('desktop-center').contains(q('fab-new'))).toBe(true);
    await setViewport(DESKTOP);
    expect(q('desktop-layout')).not.toBeNull();
    await setViewport(PHONE);
    expect(q('desktop-layout')).toBeNull();
    expect(q('nav-projects')).not.toBeNull();
  });

  it('desktop: the menu navigates (accounting, settings, projects) and a saved project opens from the side list', async () => {
    await setViewport(DESKTOP);
    await click(q('side-accounting'));
    expect(q('side-accounting').getAttribute('aria-current')).toBe('page');
    await click(q('side-settings'));
    expect(q('side-settings').getAttribute('aria-current')).toBe('page');
    await click(q('side-projects'));
    expect(q('side-projects').getAttribute('aria-current')).toBe('page');
    expect(await createProjectViaDraft('Casa Norte')).toBe(true);
    // back to the list: the new project is in the side menu and opens the workspace in the centre
    await act(async () => window.history.back());
    await flush(60);
    const item = q('side-projects-list')?.querySelector('button');
    expect(item).toBeTruthy();
    await click(item);
    expect(q('project-workspace')).not.toBeNull();
    expect(q('desktop-center').contains(q('project-workspace'))).toBe(true);
    expect(item.isConnected ? item.getAttribute('aria-current') : 'page').toBe('page');
  });

  it('desktop: a new draft locks the side menu until it is saved or left', async () => {
    await setViewport(DESKTOP);
    await click(q('side-new'));
    expect(q('draft-bar')).not.toBeNull();
    expect(q('side-settings').disabled).toBe(true);
    expect(q('side-new').disabled).toBe(true);
  });

  const ask = async (question) => {
    await setNative(q('agent-input'), question);
    await act(async () => q('agent-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush(700);
    return [...document.querySelectorAll('[data-role="agent"]')].pop()?.textContent;
  };

  it('the copilot inside the app, without a Gemini key: a quiet sentence that points to Settings, and nothing leaves the device', async () => {
    const seen = [];
    vi.stubGlobal('fetch', geminiFetch((url, init) => (seen.push(init), geminiReply('x'))));
    await setViewport(DESKTOP);
    expect(await ask('plazos')).toBe(DICT.es['studio.chat.err.no_key']);
    expect(seen).toHaveLength(0);
  });

  it('the copilot inside the app: Gemini with the user key + the data of the open project as hidden system context', async () => {
    const calls = [];
    vi.stubGlobal('fetch', geminiFetch((url, init) => (calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) }), geminiReply('El saldo es 1.000.'))));
    seedKey();
    await setViewport(DESKTOP);
    expect(await createProjectViaDraft('Casa Norte')).toBe(true);
    expect(q('project-workspace')).not.toBeNull();
    expect(await ask('¿Cuánto me queda?')).toBe('El saldo es 1.000.');
    expect(calls).toHaveLength(1);
    const { body } = calls[0];
    const system = body.systemInstruction.parts.map((p) => p.text).join('\n');
    expect(system).toContain('Eres el analista financiero y técnico de CUBRAX. Tu trabajo es responder de forma concisa, profesional y analítica.');
    expect(system).toContain('Casa Norte'); // the open project is injected as context
    expect(body.contents.at(-1)).toEqual({ role: 'user', parts: [{ text: '¿Cuánto me queda?' }] });
    expect(JSON.stringify(body)).not.toContain(TEST_KEY); // the key never travels inside the conversation
    expect(calls[0].url).toContain('generativelanguage.googleapis.com'); // straight to Google, with the user's own key
    expect(document.body.textContent).not.toContain(TEST_KEY); // the key is never painted
  });
});

describe('Zero-Stress markup and languages', () => {
  const files = ['components/DesktopLayout.jsx', 'components/AgentChat.jsx'];
  // the only greys allowed: DesktopLayout's anthracite floor (neutral-900) and its neutral-800 floating cards (asked for by name, desktop only)
  const markup = (f) => read(f).replace(/data-outline-icon/g, '').replace(/bg-neutral-(?:900|800)(?![\w/-])/g, f.endsWith('DesktopLayout.jsx') ? '' : '$&');
  it('desktop ergonomics: anthracite floor, three floating cards with a soft shadow, high-contrast text; the phone keeps pure black', () => {
    const layout = read('components/DesktopLayout.jsx');
    expect(layout).toMatch(/studio-surface[^"]*bg-neutral-900/); // the floor
    expect(layout.match(/rounded-2xl bg-neutral-800/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(layout.match(/bg-neutral-800[^"`]*shadow-md/g)?.length).toBe(3); // sidebar, centre, copilot: all floating cards
    expect(layout).not.toMatch(/bg-black(?![\w/-])/); // no pure black inside the desktop frame
    expect(layout).not.toMatch(/text-neutral-(500|600|700)/); // the secondary text stays above AA on the anthracite
    // the remap of the screens drawn inside lives in a class only DesktopLayout carries: the phone is never under it
    const css = read('index.css');
    expect(css).toMatch(/\.studio-surface \.bg-black\s*\{\s*background-color:\s*#262626/);
    for (const f of ['App.jsx', 'components/BottomNav.jsx', 'components/Header.jsx']) expect(read(f), f).not.toContain('studio-surface');
    expect(read('App.jsx')).toContain('<DesktopLayout');
    expect(read('index.css')).toMatch(/html,\s*body,\s*#root\s*\{[^}]*#000000/); // the base layers stay OLED black
  });
  it('no borders, outlines, grey/neutral fills, tracking-wide, tiny or heavy type', () => {
    for (const f of files) {
      const src = markup(f);
      expect(src, f).not.toMatch(/\bborder(-|\b)/);
      expect(src, f).not.toMatch(/\boutline\b|divide-|<hr|ring-/);
      expect(src, f).not.toMatch(/\bbg-(gray|zinc|slate|stone|neutral)-/);
      expect(src, f).not.toMatch(/tracking-wide|font-semibold|font-bold|text-\[(\d|1[01])px\]|text-(xxs|2xs)/);
      expect(src, f).toContain('bg-white/');
    }
  });
  it('every interactive control gives physical feedback', () => {
    for (const f of files) {
      const src = read(f);
      // each <button ...> element: from its opening tag to its className
      for (const part of src.split('<button').slice(1)) {
        const cls = part.slice(part.indexOf('className'), part.indexOf('className') + 400);
        expect(cls, f).toMatch(/active:scale-95|navClass/);
        expect(cls, f).toMatch(/active:opacity-70|navClass/);
      }
    }
    expect(read('components/DesktopLayout.jsx')).toContain('active:scale-95 active:opacity-70');
  });
  it('the chat and copilot modules own no key, no URL and no raw request: the only way out is the shared Gemini transport with the user key', () => {
    for (const f of ['components/AgentChat.jsx', 'lib/copilot.js', 'lib/copilotContext.js']) expect(read(f), f).not.toMatch(/fetch\(|XMLHttpRequest|AIza|generativelanguage|apiKey/i);
  });
  it('studio.* texts exist in the 6 languages with the same keys', () => {
    const keys = Object.keys(DICT.es).filter((k) => k.startsWith('studio.'));
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const lang of ['en', 'pt', 'it', 'fr', 'de']) {
      for (const k of keys) expect(DICT[lang]?.[k], `${lang}:${k}`).toBeTruthy();
    }
  });
});
