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
