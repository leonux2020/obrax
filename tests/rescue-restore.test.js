// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

describe('rescue: the business modules deleted by mistake are back', () => {
  it('every restored module exists and is a real component / lib', () => {
    for (const f of [
      'src/components/CashSheet.jsx',
      'src/components/HseSheet.jsx',
      'src/components/InvoiceSheet.jsx',
      'src/components/PhotoGallery.jsx',
      'src/components/ProfileSheet.jsx',
      'src/components/MachineryCard.jsx',
      'src/components/SignatureField.jsx',
      'src/components/TrafficLight.jsx',
      'src/components/workspace/MachineryBlock.jsx',
      'src/lib/hse.js',
    ]) {
      expect(existsSync(f), f).toBe(true);
      expect(read(f), f).toMatch(/export /);
    }
  });

  it('the routes stay gone: Wizard, ProjectView and steps are NOT restored', () => {
    for (const f of ['src/components/Wizard.jsx', 'src/components/ProjectView.jsx', 'src/components/steps', 'src/lib/flags.js']) expect(existsSync(f), f).toBe(false);
  });

  it('the HSE guide is reachable again from every partida of the workspace', () => {
    const src = read('src/components/workspace/PartidaList.jsx');
    expect(src).toContain("import HseButton from '../HseSheet.jsx'");
    expect(src).toMatch(/<HseButton task=\{p\.task\} \/>/);
  });
});

describe('neon hairlines', () => {
  it('the project card has a thin left thread, not a thick bar', () => {
    const src = read('src/components/ProjectCard.jsx');
    expect(src).toContain('border-l-2');
    expect(src).not.toMatch(/border-l-\[?[3-9]/);
  });

  it('the dashboard triangles use a hairline stroke and light numbers', () => {
    const src = read('src/components/Dashboard.jsx');
    expect(src).toMatch(/strokeWidth="1\.25"/);
    expect(src).toMatch(/text-xl font-light leading-none tabular-nums/);
  });
});

describe('Contabilidad ergonomics', () => {
  const src = read('src/components/GlobalAccounting.jsx');
  it('no helmet logo floats at the top', () => {
    expect(src).not.toMatch(/<Logo\b/);
  });
  it('the export button is solid and in the page flow: never fixed, never translucent', () => {
    const i = src.indexOf('data-testid="acc-export-bar"');
    expect(i).toBeGreaterThan(0);
    const bar = src.slice(i - 80, i + 700);
    expect(bar).not.toMatch(/fixed|sticky|absolute|bg-black\/|backdrop|bg-white\//);
    expect(src).not.toMatch(/no-print fixed/);
  });
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe('restored sheets still mount and work on their own', async () => {
  const { act } = await import('react');
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { I18nProvider } = await import('../src/lib/i18n.jsx');
  const { default: HseButton } = await import('../src/components/HseSheet.jsx');
  const { default: CashSheet } = await import('../src/components/CashSheet.jsx');
  const { default: ProfileSheet } = await import('../src/components/ProfileSheet.jsx');
  const { hseFor } = await import('../src/lib/hse.js');
  const { TASKS } = await import('../src/lib/tasks.js');

  const mount = async (node) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, node)));
    return { host, unmount: () => act(async () => root.unmount()) };
  };

  it('HSE: the button opens the guide of the task', async () => {
    const task = Object.keys(TASKS).find((k) => hseFor(k));
    expect(task).toBeTruthy();
    const { unmount } = await mount(React.createElement(HseButton, { task }));
    const btn = document.querySelector('[data-testid="hse-open"]');
    expect(btn).toBeTruthy();
    await act(async () => btn.click());
    expect(document.body.textContent).toMatch(/EPP|HSE|PPE/i);
    await unmount();
  });

  it('Cash sheet renders with the payments of the project', async () => {
    const { unmount } = await mount(React.createElement(CashSheet, { total: 1000, payments: [{ id: 'p1', amount: 250, at: Date.now(), note: 'anticipo' }], onChange: () => {}, onClose: () => {} }));
    expect(document.body.textContent).toContain('anticipo');
    await unmount();
  });

  it('Profile sheet renders and saves through onSave', async () => {
    let saved = null;
    const { unmount } = await mount(React.createElement(ProfileSheet, { company: { name: 'Obras SL' }, logo: '', drive: false, onSave: async (d) => { saved = d; }, onClose: () => {} }));
    const btn = document.querySelector('[data-testid="profile-save"]');
    expect(btn).toBeTruthy();
    await act(async () => btn.click());
    expect(saved?.name).toBe('Obras SL');
    await unmount();
  });
});

describe('Phase 7: OLED calm (less light, less stress)', () => {
  const dash = read('src/components/Dashboard.jsx');
  const nav = read('src/components/BottomNav.jsx');

  it('BottomNav: hairline icons and light 12 px labels', () => {
    expect(nav).toContain('strokeWidth="1.5"');
    expect(nav).not.toMatch(/strokeWidth="2"/);
    expect(nav).toMatch(/text-xs font-light/);
    expect(nav).not.toMatch(/font-semibold|font-bold/);
  });

  it('Dashboard tabs: a 1 px line (no border-b-2), normal weight, inactive neutral-400', () => {
    const i = dash.indexOf('role="tablist"');
    const tabs = dash.slice(i, i + 1400);
    expect(tabs).toContain('border-b border-neutral-700/50');
    expect(tabs).not.toMatch(/border-b-2|font-semibold/);
    expect(tabs).toContain('font-normal');
    expect(tabs).toContain('text-neutral-400');
  });

  it('FAB: matte green and not a single shadow / ring', () => {
    const i = dash.indexOf('data-testid="fab-new"');
    const fab = dash.slice(i, dash.indexOf('</button>', i));
    expect(fab).toContain('bg-[#16a34a]');
    expect(fab).not.toMatch(/shadow|ring/);
  });

  it('PRO badge: no helmet, no glow, small flat tag on the same line as logo and bell', () => {
    const i = dash.indexOf('data-testid="pro-pill"');
    const pro = dash.slice(i - 200, dash.indexOf('PRO</span>', i));
    expect(dash).not.toMatch(/HelmetIcon/);
    expect(pro).not.toMatch(/shadow|Helmet/);
    expect(pro).toContain('px-1.5 py-0.5');
    // header line: everything centred on one axis
    expect(dash).toMatch(/data-testid="dash-header">/);
    expect(dash).toMatch(/mb-2 flex items-center gap-2" data-testid="dash-header"/);
  });

  it('the status triangles are untouched (hairline 1.25 stroke, light numbers, glow kept)', () => {
    expect(dash).toContain('<polygon points="30,3 57,51 3,51"');
    expect(dash).toMatch(/strokeWidth="1\.25"/);
    expect(dash).toMatch(/text-xl font-light leading-none tabular-nums/);
    expect(dash).toContain('drop-shadow(0 0 3px ${color}55)');
  });
});
