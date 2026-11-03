// @vitest-environment happy-dom
// Financial integrity across devices: payments (cobros), advances (anticipos) and expenses (gastos) are UNIONED by id (never overwritten as a
// block), amounts are forced to real numbers while merging and while adding up, and a background pull refreshes the open screen at once.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, q, flush, click, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { collectBackup, serializeBackup } from '../src/lib/backup.js';
import { createDriveClient } from '../src/lib/drive.js';
import { clearDriveToken, setDriveToken } from '../src/lib/driveToken.js';
import { projectStore } from '../src/lib/projectStore.js';
import { newProject } from '../src/lib/projects.js';
import { normalizeCompany } from '../src/lib/draft.js';
import { canon, mergeProject } from '../src/lib/merge.js';
import { cashSummary, laborPool, liquidity, expensesTotal, toAmount } from '../src/lib/ledger.js';
import { postMortem } from '../src/lib/postMortem.js';

const rec = (id, amount, updatedAt, extra = {}) => ({ id, amount, at: 1, note: '', updatedAt, ...extra });
const base = { id: 'p1', updatedAt: 500 };

describe('deep merge of the money vectors', () => {
  it('a payment / advance / expense that only one device has is KEPT: the merge is a union, in both directions', () => {
    const tablet = { ...base, updatedAt: 900, payments: [rec('pay1aa', 1000, 100)], advances: [], expenses: [rec('exp1aa', 50, 100, { supplier: 'A', description: '', category: 'other' })] };
    const phone = {
      ...base,
      updatedAt: 500, // the OLDER project record: whole-project "newest wins" would have thrown all of this away
      payments: [rec('pay1aa', 1000, 100), rec('pay2bb', 2500, 400)],
      advances: [{ id: 'adv1cc', worker: 'Juan', amount: 300, at: 1, updatedAt: 450 }],
      expenses: [rec('exp1aa', 50, 100, { supplier: 'A', description: '', category: 'other' })],
    };
    for (const merged of [mergeProject(tablet, phone), mergeProject(phone, tablet)]) {
      expect(merged.payments.map((p) => p.id).sort()).toEqual(['pay1aa', 'pay2bb']);
      expect(merged.advances.map((p) => p.id)).toEqual(['adv1cc']);
      expect(merged.expenses.map((p) => p.id)).toEqual(['exp1aa']);
    }
    expect(canon(mergeProject(tablet, phone))).toBe(canon(mergeProject(phone, tablet))); // both devices converge on the same data
  });

  it('on the same record the newest change wins; a deletion (tomb) newer than the record stays deleted', () => {
    const a = { ...base, payments: [rec('pay1aa', 1000, 100), rec('pay2bb', 700, 100)], tomb: { pay2bb: 300 } };
    const b = { ...base, payments: [rec('pay1aa', 1200, 200), rec('pay2bb', 700, 100)] };
    const m = mergeProject(a, b);
    expect(m.payments.map((p) => [p.id, p.amount])).toEqual([['pay1aa', 1200]]);
  });

  it('amounts that arrive as strings become numbers: no "100" + 20 concatenation, no NaN', () => {
    const a = { ...base, payments: [rec('pay1aa', '100', 100), rec('pay2bb', '1250,50', 100)] };
    const b = { ...base, payments: [rec('pay3cc', 20, 100), rec('pay4dd', 'abc', 100)] };
    const m = mergeProject(a, b);
    expect(m.payments.every((p) => typeof p.amount === 'number' && Number.isFinite(p.amount))).toBe(true);
    expect(m.payments.map((p) => p.amount).sort((x, y) => x - y)).toEqual([0, 20, 100, 1250.5]);
    expect(cashSummary(5000, m.payments).paid).toBe(1370.5);
  });

  it('any other list of records with ids (invoices, future ledgers) is unioned too, never taken as a block from one side', () => {
    const a = { ...base, updatedAt: 900, invoices: [{ id: 'inv1aa', amount: 10, updatedAt: 1 }] };
    const b = { ...base, updatedAt: 100, invoices: [{ id: 'inv2bb', amount: 20, updatedAt: 1 }] };
    expect(mergeProject(a, b).invoices.map((i) => i.id).sort()).toEqual(['inv1aa', 'inv2bb']);
    expect(canon(mergeProject(a, b))).toBe(canon(mergeProject(b, a)));
  });
});

describe('type-safe amounts in the derived figures ("Da incassare")', () => {
  it('toAmount never returns NaN and understands the comma', () => {
    expect([toAmount('100'), toAmount('1250,50'), toAmount(' 7 '), toAmount(null), toAmount(undefined), toAmount('abc'), toAmount(NaN), toAmount('12abc'), toAmount(5)]).toEqual([100, 1250.5, 7, 0, 0, 0, 0, 12, 5]);
  });

  it('cashSummary / laborPool / liquidity / expensesTotal / postMortem add strings as numbers', () => {
    const payments = [{ amount: '100' }, { amount: 20 }, { amount: null }, { amount: 'x' }];
    expect(cashSummary(1000, payments)).toMatchObject({ paid: 120, pending: 880 });
    expect(cashSummary('1000', payments)).toMatchObject({ total: 1000, paid: 120, pending: 880 }); // the budget itself may be a string
    expect(laborPool('500', [{ amount: '100' }, { amount: 20 }])).toEqual({ pool: 500, advanced: 120, available: 380 });
    expect(liquidity(payments, [{ amount: '50' }], [{ amount: '10' }])).toBe(60);
    expect(expensesTotal([{ amount: '1.5' }, { amount: 2 }])).toBe(3.5);
    const p = { payments, advances: [{ amount: '30' }, { amount: 5 }], expenses: [{ amount: '15' }] };
    const pm = postMortem(p, { total: 1000 });
    expect(Number.isFinite(pm.profit)).toBe(true);
  });
});

describe('app: a background pull recalculates the open project at once', () => {
  let App;
  let resetBoot;
  let drive;
  let h;
  beforeAll(async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
    const mod = await import('../src/App.jsx');
    App = mod.default;
    resetBoot = mod.resetBoot;
  });
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    clearDriveToken();
    resetBoot();
    for (const p of await projectStore.load()) await projectStore.remove(p.id);
    drive = createFakeDrive();
    vi.stubGlobal('fetch', drive.fetchImpl);
    installFakeGoogle(drive);
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
    localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'google', name: 'Ana', email: 'ana@example.com' }));
    localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora' }));
    localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: true }));
    localStorage.setItem('cp.drive.linked.v1', '1');
    setDriveToken(drive.token, 3600);
  });
  afterEach(() => {
    h?.unmount();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.google;
  });
  const put = async (project) => {
    const text = serializeBackup(await collectBackup({ settings: { region: 'CL', lang: 'es' }, company: normalizeCompany({ name: 'Aurora' }), meta: { onboarded: true, drive: true }, logo: '', projects: [project], loadPhotos: async () => [] }));
    await createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl }).saveBackup(text);
  };

  it('the phone registers a cobro: the tablet, with the project OPEN, shows the new "Da incassare" without reloading', async () => {
    const p0 = newProject({ regionCode: 'CL', name: 'Casa Cobros', now: 100, company: { name: 'Aurora' } });
    p0.draft.partidas[0].dims = { ...p0.draft.partidas[0].dims, length: 6, width: 4 };
    const tablet = { ...p0, payments: [{ id: 'pay1aa', amount: 10000, at: 1, note: '', updatedAt: 200 }], updatedAt: 900 };
    await projectStore.save(tablet);
    await put({ ...p0, payments: [{ id: 'pay1aa', amount: 10000, at: 1, note: '', updatedAt: 200 }], updatedAt: 200 }); // Drive: the older record, same cobro
    h = createHost(App);
    await h.mount();
    await flush(400);
    await click(q('project-card') ?? document.querySelector('[data-testid="project-card"]'));
    await flush(300);
    const before = q('ws-due').textContent;
    expect(q('ws-collected').textContent).toContain('10.000');
    // the phone (older project stamp!) adds a cobro and a string-typed one; Drive now holds both
    await put({
      ...p0,
      payments: [
        { id: 'pay1aa', amount: 10000, at: 1, note: '', updatedAt: 200 },
        { id: 'pay2bb', amount: '5000', at: 2, note: '', updatedAt: 400 },
      ],
      updatedAt: 450,
    });
    const events = [];
    window.addEventListener('cubrax:synced', (e) => events.push(e.detail));
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000); // past the 15 s throttle
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(events.length).toBeGreaterThan(0); // the pull announced what it changed
    expect(q('ws-collected').textContent).toContain('15.000'); // 10 000 + 5 000, as numbers: the open header recalculated by itself
    expect(q('ws-due').textContent).not.toBe(before);
    const stored = (await projectStore.load()).find((x) => x.id === p0.id);
    expect(stored.payments.map((x) => x.amount).sort((a, b) => a - b)).toEqual([5000, 10000]);
  }, 30_000);
});
