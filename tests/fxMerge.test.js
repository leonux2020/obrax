// @vitest-environment happy-dom
// FX snapshot in the sync pipeline: a scanned foreign-currency expense must travel between devices (merge keeps and reconciles the six FX
// fields) and saving it must always move the project's `updatedAt` forward so the Auto-Sync daemon pushes it.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createFakeDrive } from './helpers/fakeDrive.js';
import { CLIENT, flush, installFakeGoogle, createHost } from './helpers/appHarness.js';
import { collectBackup, mergeBackup, parseBackup, serializeBackup } from '../src/lib/backup.js';
import { createDriveClient } from '../src/lib/drive.js';
import { clearDriveToken, setDriveToken } from '../src/lib/driveToken.js';
import { projectStore } from '../src/lib/projectStore.js';
import { receiptQueue } from '../src/lib/receiptQueue.js';
import { newProject } from '../src/lib/projects.js';
import { normalizeCompany } from '../src/lib/draft.js';
import { FX_FIELDS, canon, mergeProject, nextStamp, stampProject } from '../src/lib/merge.js';
import { expensesTotal } from '../src/lib/ledger.js';
import { addExpenses } from '../src/lib/receiptSync.js';
import { freezeExpense } from '../src/lib/fx.js';
import { expensesFromRows } from '../src/lib/receipt.js';
import { recalculateProjectTotals } from '../src/lib/projectTotals.js';
import { AUTO_SYNC } from '../src/lib/driveSync.js';
import { geminiReply, isGemini, seedKey } from './helpers/gemini.js';

const company = normalizeCompany({ name: 'Aurora' });
const device = (projects) => ({ settings: { region: 'CL', lang: 'es' }, company, meta: { onboarded: true, drive: true }, logo: '', projects });
const frozen = (id, extra = {}) => ({ id, at: 5, supplier: 'Conad', description: 'Pane', category: 'food', currency: 'CLP', amount: 10000, currencyOriginal: 'EUR', amountOriginal: 10, exchangeRate: 1000, amountBase: 10000, fxSource: 'api', fxAt: 50, updatedAt: 500, ...extra });
const plainOf = (e) => Object.fromEntries(Object.entries(e).filter(([k]) => !FX_FIELDS.includes(k) && k !== 'amount'));
const base = (extra = {}) => ({ ...newProject({ regionCode: 'CL', name: 'Casa', now: 100 }), ...extra });

describe('merge: the FX snapshot travels', () => {
  it('an expense that only one device has arrives with the six fields and its base amount in the totals', () => {
    const a = base({ updatedAt: 10 });
    const b = { ...a, updatedAt: 600, expenses: [frozen('aaaaaa')] };
    for (const m of [mergeProject(a, b), mergeProject(b, a)]) {
      expect(m.expenses).toHaveLength(1);
      for (const k of FX_FIELDS) expect(m.expenses[0][k]).toBe(frozen('aaaaaa')[k]);
      expect(expensesTotal(m.expenses)).toBe(10000);
    }
  });
  it('two devices each add a foreign expense: both survive, in both merge directions', () => {
    const root = base({ updatedAt: 10 });
    const a = { ...root, updatedAt: 600, expenses: [frozen('aaaaaa')] };
    const b = { ...root, updatedAt: 700, expenses: [frozen('bbbbbb', { amountOriginal: 2, amountBase: 2000, amount: 2000, updatedAt: 700 })] };
    const ab = mergeProject(a, b);
    expect(ab.expenses.map((e) => e.id).sort()).toEqual(['aaaaaa', 'bbbbbb']);
    expect(canon(ab)).toBe(canon(mergeProject(b, a)));
    expect(expensesTotal(ab.expenses)).toBe(12000);
  });
  it('a backup that stored the numbers as text is reconciled to real numbers, amount following amountBase', () => {
    const a = base({ updatedAt: 10 });
    const dirty = { ...frozen('aaaaaa'), amountOriginal: '10,5', exchangeRate: '1000,5', amountBase: '10505,25', fxAt: '50', amount: '1' };
    const m = mergeProject(a, { ...a, updatedAt: 600, expenses: [dirty] });
    expect(m.expenses[0]).toMatchObject({ amountOriginal: 10.5, exchangeRate: 1000.5, amountBase: 10505.25, amount: 10505.25, fxAt: 50 });
  });
  it('an expense with a text amountBase missing is derived once from original x rate', () => {
    const a = base({ updatedAt: 10 });
    const e = { ...frozen('aaaaaa'), amountBase: undefined, amount: 3 };
    delete e.amountBase;
    const m = mergeProject(a, { ...a, updatedAt: 600, expenses: [e] });
    expect(m.expenses[0].amountBase).toBe(10000);
    expect(m.expenses[0].amount).toBe(10000);
  });
  it('the snapshot is immutable: a newer edit of the record (returned) keeps the frozen values of the other copy', () => {
    const root = base({ updatedAt: 10 });
    const withSnap = { ...root, updatedAt: 600, expenses: [frozen('aaaaaa')] };
    const newerNoSnap = { ...root, updatedAt: 900, expenses: [{ ...plainOf(frozen('aaaaaa')), amount: 10, updatedAt: 900, returned: true }] };
    for (const m of [mergeProject(withSnap, newerNoSnap), mergeProject(newerNoSnap, withSnap)]) {
      expect(m.expenses[0].returned).toBe(true); // the newest edit won...
      expect(m.expenses[0]).toMatchObject({ currencyOriginal: 'EUR', amountOriginal: 10, exchangeRate: 1000, amountBase: 10000, amount: 10000 }); // ...and the frozen value survived
    }
  });
  it('two different snapshots of the same expense resolve the same way on every device (the first frozen wins)', () => {
    const root = base({ updatedAt: 10 });
    const a = { ...root, updatedAt: 600, expenses: [frozen('aaaaaa', { exchangeRate: 1000, amountBase: 10000, amount: 10000, fxAt: 50, updatedAt: 600 })] };
    const b = { ...root, updatedAt: 700, expenses: [frozen('aaaaaa', { exchangeRate: 900, amountBase: 9000, amount: 9000, fxAt: 80, updatedAt: 700 })] };
    const ab = mergeProject(a, b);
    expect(canon(ab)).toBe(canon(mergeProject(b, a)));
    expect(ab.expenses[0]).toMatchObject({ exchangeRate: 1000, amountBase: 10000, amount: 10000, fxAt: 50 });
  });
});

describe('the whole pipeline: device A scans, Drive, device B pulls', () => {
  it('the foreign expense survives collect -> parse -> merge even when the other device has a project stamped in the FUTURE (clock skew)', async () => {
    const future = Date.now() + 86_400_000;
    const phone = recalculateProjectTotals(base({ updatedAt: future }));
    const lines = expensesFromRows([{ selected: true, amount: 10, description: 'Pane', category: 'food' }], { supplier: 'Conad', currency: 'EUR', date: '2026-11-02' }).map((e) => freezeExpense(e, { base: 'CLP', digits: 0, rate: 1000, source: 'api', at: 5 }));
    // the tablet's clock is behind the phone's: a plain Date.now() stamp would NOT be newer than the project's own
    const tablet = stampProject(phone, addExpenses(phone, lines, Date.now()), Date.now());
    expect(tablet.updatedAt).toBeGreaterThan(phone.updatedAt);
    const file = parseBackup(serializeBackup(await collectBackup(device([tablet]))));
    const m = mergeBackup({ ...device([phone]), tombs: { projects: {}, workers: {} } }, file);
    const got = m.projects.find((p) => p.id === phone.id);
    expect(got.expenses).toHaveLength(1);
    expect(got.expenses[0]).toMatchObject({ currencyOriginal: 'EUR', amountOriginal: 10, exchangeRate: 1000, amountBase: 10000, amount: 10000, fxSource: 'api', fxAt: 5 });
    expect(got.totals.expensesTotal).toBe(10000);
    expect(m.wonProjects).toEqual([phone.id]);
  });
});

describe('the stamp', () => {
  it('nextStamp is always strictly newer than the previous one, whatever the clock says', () => {
    expect(nextStamp(100, 50)).toBe(101);
    expect(nextStamp(100, 500)).toBe(500);
    expect(nextStamp(undefined, 7)).toBe(7);
    expect(nextStamp(0, 0)).toBe(1);
  });
  it('addExpenses moves updatedAt forward even against a project stamped in the future', () => {
    const p = base({ updatedAt: 9_000 });
    expect(addExpenses(p, [{ id: 'aaaaaa', amount: 5 }], 10).updatedAt).toBe(9_001);
    expect(addExpenses(p, [{ id: 'aaaaaa', amount: 5 }], 99_999).updatedAt).toBe(99_999);
  });
});

describe('the Auto-Sync daemon uploads a scanned foreign expense by itself', () => {
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
    for (const r of await receiptQueue.list()) await receiptQueue.remove(r.id);
    seedKey(); // BYOK: the user's own key is saved on this device
    drive = createFakeDrive();
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    vi.stubGlobal('fetch', async (url, init) => {
      const u = String(url);
      if (u.includes('open.er-api.com')) return json({ result: 'success', rates: { CLP: 1000 } });
      if (isGemini(u)) return geminiReply({ isReceipt: true, receipts: [{ isReceipt: true, vendorName: 'Conad', receiptDate: '2026-11-02', currency: 'EUR', purchaseType: 'food', totalText: '10,00', items: [{ description: 'PANE', amountText: '10,00', category: 'food' }] }] });
      if (u.includes('googleapis.com') || u.includes('google')) return drive.fetchImpl(url, init);
      return json({});
    });
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

  it('queued EUR receipt -> frozen in the project, updatedAt moves forward (even from the future), and Drive receives it without any user action', async () => {
    const future = Date.now() + 5 * 86_400_000;
    const p = recalculateProjectTotals(newProject({ regionCode: 'CL', name: 'Casa FX', now: 100, company: { name: 'Aurora' } }));
    const project = { ...p, updatedAt: future };
    await projectStore.save(project);
    const text = serializeBackup(await collectBackup({ ...device([project]), loadPhotos: async () => [] }));
    await createDriveClient({ getToken: async () => drive.token, fetchImpl: drive.fetchImpl }).saveBackup(text);
    h = createHost(App);
    await h.mount();
    await flush(600);
    await receiptQueue.enqueue({ projectId: project.id, image: `data:image/jpeg;base64,${Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 7) % 251)).toString('base64')}`, regionCode: 'CL', currency: 'CLP', lang: 'es' });
    drive.calls.length = 0;
    await act(async () => window.dispatchEvent(new Event('online')));
    await flush(1500);
    const stored = (await projectStore.load()).find((x) => x.id === project.id);
    expect(stored.expenses).toHaveLength(1);
    expect(stored.expenses[0]).toMatchObject({ currency: 'CLP', currencyOriginal: 'EUR', amountOriginal: 10, exchangeRate: 1000, amountBase: 10000, amount: 10000, fxSource: 'api' });
    expect(stored.updatedAt).toBeGreaterThan(future);
    expect(stored.totals.expensesTotal).toBe(10000);
    await flush(AUTO_SYNC.debounceMs + 2000); // nobody touches anything
    const uploads = drive.calls.filter((c) => c.method !== 'GET' && c.url.includes('/upload/'));
    expect(uploads.length).toBeGreaterThan(0);
    const remote = parseBackup(drive.backupFiles()[0].body).projects.find((x) => x.id === project.id);
    expect(remote.expenses).toHaveLength(1);
    for (const k of FX_FIELDS) expect(remote.expenses[0][k]).toBe(stored.expenses[0][k]);
    expect(remote.updatedAt).toBe(stored.updatedAt);
  }, 40_000);
});
