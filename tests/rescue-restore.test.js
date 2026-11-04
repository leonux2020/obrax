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

describe('Phase 8: minimalism in Gastos y Caja', () => {
  const files = {
    cash: 'src/components/workspace/CashBlock.jsx',
    cashSheet: 'src/components/CashSheet.jsx',
    expenses: 'src/components/workspace/ExpensesBlock.jsx',
    stack: 'src/components/workspace/ReceiptStack.jsx',
    queue: 'src/components/workspace/QueueList.jsx',
    receipt: 'src/components/ReceiptSheet.jsx',
    pad: 'src/components/workspace/NumberPad.jsx',
  };
  const all = Object.values(files);

  it('the shared input style is the soft fill: bg-neutral-900 + 1 px white/10, no heavy borders in any money form', () => {
    expect(read('src/index.css')).toMatch(/\.field-input\s*\{\s*@apply[^}]*border border-white\/10 bg-neutral-900/);
    for (const f of all) expect(read(f), f).not.toMatch(/\bborder-2\b|border-neutral-700|border-white\/(15|20|25|30)\b/);
    expect(read(files.cash)).toMatch(/data-testid="cash-amount" className="[^"]*border border-white\/10 bg-neutral-900/);
  });

  it('no ghost (outline-only) buttons: primaries are solid brand, secondaries a soft white/5 fill', () => {
    expect(read(files.receipt)).not.toContain('variant="ghost"');
    expect(read(files.cashSheet)).not.toContain('variant="ghost"');
    expect(read(files.cash)).toMatch(/data-testid="cash-add" className="[^"]*bg-brand[^"]*text-black/);
    for (const f of [files.cash, files.cashSheet, files.queue, files.pad]) expect(read(f), f).toMatch(/border border-white\/10 bg-white\/5/);
    expect(read(files.stack)).not.toMatch(/borderColor/); // the due-date tool no longer gets a gold outline
  });

  it('the history rows are clean: no box around each item, date on the left, amount on the right, calm colours', () => {
    const cash = read(files.cash);
    expect(cash).toMatch(/divide-y divide-white\/5" data-testid="cash-list"/);
    expect(cash).toMatch(/data-testid=\{`cash-amount-\$\{p\.id\}`\}/);
    expect(cash).toContain('text-neutral-200');
    expect(read(files.cashSheet)).not.toMatch(/rounded-2xl border border-white\/10" data-testid="cash-list"/);
    const stack = read(files.stack);
    expect(stack).not.toMatch(/<section[^>]*rounded-xl border/); // no card per supplier
    expect(stack).toMatch(/text-sm tabular-nums \$\{e\.amount < 0 \? 'text-brand-500' : 'text-neutral-200'\}/);
    // the delete cross is neutral until touched; no permanent red in a normal history
    expect(cash).toMatch(/text-neutral-500 tabular-nums hover:text-red-400/);
    expect(read(files.expenses)).not.toContain('e8c35f');
  });

  it('every financial modal closes with swipe-to-close and none opts out', () => {
    for (const f of all) expect(read(f), f).not.toMatch(/swipeToClose=\{false\}/);
    expect(read(files.pad)).toMatch(/data-swipe-close="true"/);
    expect(read(files.receipt)).toContain('<BottomSheet');
    expect(read(files.cashSheet)).toContain('<BottomSheet');
  });

  it('the minimum type size is 12 px (no text-[10px]/[11px]) in every money module', () => {
    for (const f of all) expect(read(f), f).not.toMatch(/text-\[(8|9|10|11)px\]/);
  });
});
