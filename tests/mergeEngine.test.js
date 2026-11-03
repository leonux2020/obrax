// @vitest-environment happy-dom
// Granular, symmetric merge of this device with the Drive backup (projects, expenses, advances, payments, crew, logbook, workers, deletions)
// and the upload engine that merges BEFORE it uploads and never fails silently.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { canon, mergeProject, mergeProjectLists, stampProject, stampProjects } from '../src/lib/merge.js';
import { newProject, normalizeProject } from '../src/lib/projects.js';
import { normalizeExpenses, normalizeAdvances, normalizePayments } from '../src/lib/ledger.js';
import { collectBackup, mergeBackup, parseBackup, serializeBackup } from '../src/lib/backup.js';
import { loadTombs, markDeleted, mergeTomb, normalizeTomb } from '../src/lib/tombstones.js';
import { loadWorkers, mergeWorkers, normalizeWorkers, removeWorker, upsertWorker } from '../src/lib/workers.js';
import { createDriveSync, getSeenRemote, setSeenRemote } from '../src/lib/driveSync.js';
import { backupBadgeReason, backupBadgeState, backupBadgeTone } from '../src/lib/backupStatus.jsx';
import { normalizeCompany } from '../src/lib/draft.js';

const exp = (id, amount, at = 1, extra = {}) => normalizeExpenses([{ id, amount, at, supplier: 'S', ...extra }])[0];
const base = (name = 'Obra', now = 100) => newProject({ regionCode: 'CL', name, now, company: { name: 'Aurora' } });
const withExp = (p, list, updatedAt = p.updatedAt) => ({ ...p, expenses: list.map((e) => ({ ...e, projectId: p.id })), updatedAt });
const ids = (p) => p.expenses.map((e) => e.id).sort();

beforeEach(() => localStorage.clear());

describe('mergeProject: record by record', () => {
  it('a stale tablet (newer project stamp, missing the phone\'s expense) and the phone each keep what the other has', () => {
    const p = base();
    const tablet = withExp(p, [exp('e1aaaa', 100)], 900); // opened / touched later, but never saw the phone's expense
    const phone = withExp(p, [exp('e1aaaa', 100), exp('e2bbbb', 250, 2, { updatedAt: 500 })], 500);
    const m = mergeProject(tablet, phone);
    expect(ids(m)).toEqual(['e1aaaa', 'e2bbbb']);
    expect(m.updatedAt).toBe(900);
  });
  it('the same record edited on both: the newest record stamp wins, whatever the project stamps say', () => {
    const p = base();
    const a = withExp(p, [exp('e1aaaa', 100, 1, { updatedAt: 300 })], 300);
    const b = withExp(p, [exp('e1aaaa', 175, 1, { updatedAt: 800 })], 800);
    expect(mergeProject(a, b).expenses[0].amount).toBe(175);
    expect(mergeProject(b, a).expenses[0].amount).toBe(175);
    // the project of the OLD side is newer as a whole, but this record was edited later on the other one
    const c = withExp(p, [exp('e1aaaa', 100, 1, { updatedAt: 300 })], 1000);
    expect(mergeProject(c, b).expenses[0].amount).toBe(175);
  });
  it('advances and payments are merged too', () => {
    const p = base();
    const a = { ...p, advances: normalizeAdvances([{ id: 'a1aaaa', worker: 'Luca', amount: 50, updatedAt: 200 }]), updatedAt: 200 };
    const b = { ...p, advances: normalizeAdvances([{ id: 'a2bbbb', worker: 'Ana', amount: 80, updatedAt: 300 }]), payments: normalizePayments([{ id: 'p1cccc', amount: 1000, updatedAt: 300 }]), updatedAt: 300 };
    const m = mergeProject(a, b);
    expect(m.advances.map((x) => x.id).sort()).toEqual(['a1aaaa', 'a2bbbb']);
    expect(m.payments).toHaveLength(1);
  });
  it('is SYMMETRIC: merge(a,b) and merge(b,a) hold the same data (so two devices converge)', () => {
    const p = base();
    const a = withExp(p, [exp('e1aaaa', 100, 1, { updatedAt: 300 }), exp('e3dddd', 5)], 300);
    const b = withExp(p, [exp('e1aaaa', 120, 1, { updatedAt: 300 }), exp('e2bbbb', 9)], 300); // same stamps, different content
    expect(canon(mergeProject(a, b))).toBe(canon(mergeProject(b, a)));
    const once = mergeProject(a, b);
    expect(canon(mergeProject(once, b))).toBe(canon(once)); // idempotent
  });
  it('deleted stays deleted (tombstone newer than the record) and a later edit brings it back', () => {
    const p = base();
    const phone = { ...withExp(p, [], 600), tomb: { e1aaaa: 600 } }; // deleted on the phone at 600
    const tabletOld = withExp(p, [exp('e1aaaa', 100, 1, { updatedAt: 200 })], 200);
    expect(mergeProject(tabletOld, phone).expenses).toEqual([]);
    expect(mergeProject(phone, tabletOld).expenses).toEqual([]);
    const tabletEdited = withExp(p, [exp('e1aaaa', 100, 1, { updatedAt: 900 })], 900); // edited AFTER the deletion
    expect(ids(mergeProject(tabletEdited, phone))).toEqual(['e1aaaa']);
  });
});

describe('stamping edits (what makes the merge granular)', () => {
  it('new and changed records get updatedAt, deleted ones go to the tomb, untouched ones are left alone', () => {
    const p = withExp(base(), [exp('e1aaaa', 100), exp('e2bbbb', 50)]);
    const next = { ...p, expenses: [p.expenses[0], { ...p.expenses[1], amount: 75 }, { ...exp('e3cccc', 10), projectId: p.id }] };
    const s = stampProject(p, { ...next, expenses: next.expenses.filter((e) => e.id !== 'e1aaaa') }, 5000);
    expect(s.expenses.map((e) => [e.id, e.updatedAt])).toEqual([['e2bbbb', 5000], ['e3cccc', 5000]]);
    expect(s.tomb).toEqual({ e1aaaa: 5000 });
    expect(stampProject(p, p, 5000)).toBe(p);
    const same = { ...p, expenses: p.expenses.map((e) => ({ ...e })) }; // new objects, same content
    expect(stampProject(p, same, 5000).expenses.every((e) => e.updatedAt === undefined)).toBe(true);
  });
  it('stampProjects keeps the identity of the list when nothing changed', () => {
    const list = [withExp(base(), [exp('e1aaaa', 1)])];
    expect(stampProjects(list, list)).toBe(list);
  });
  it('the stamps and the tomb survive normalization (they are stored and backed up)', () => {
    const p = { ...withExp(base(), [exp('e1aaaa', 100, 1, { updatedAt: 321 })]), tomb: { x1aaaa: 77, bad: 'no' } };
    const n = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(n.expenses[0].updatedAt).toBe(321);
    expect(n.tomb).toEqual({ x1aaaa: 77 });
    expect(normalizeProject(JSON.parse(JSON.stringify(base()))).tomb).toBeUndefined();
  });
});

describe('merging a backup into a device', () => {
  const company = normalizeCompany({ name: 'Aurora' });
  const device = (projects, extra = {}) => ({ settings: { region: 'CL', lang: 'es' }, company, meta: { onboarded: true, drive: true }, logo: '', projects, ...extra });
  const backupOf = async (projects, extra = {}) => parseBackup(serializeBackup(await collectBackup({ ...device(projects), workers: [], tombs: { projects: {}, workers: {} }, ...extra })));

  it('a stale tablet does not crush the phone: both expenses survive and the merged state is marked to go back up', async () => {
    const p = base();
    const tablet = withExp(p, [exp('e1aaaa', 100)], 900);
    const phone = withExp(p, [exp('e1aaaa', 100), exp('e2bbbb', 250, 2, { updatedAt: 500 })], 500);
    const m = mergeBackup(device([tablet]), await backupOf([phone]));
    expect(ids(m.projects[0])).toEqual(['e1aaaa', 'e2bbbb']);
    expect(m.wonProjects).toEqual([p.id]);
    expect(m.needsPush).toBe(true); // the tablet's version of the project differs from Drive's
  });
  it('identical data: nothing changes and nothing needs uploading (no sync loop)', async () => {
    const p = withExp(base(), [exp('e1aaaa', 100)]);
    const m = mergeBackup(device([p]), await backupOf([p]));
    expect(m.wonProjects).toEqual([]);
    expect(m.needsPush).toBe(false);
  });
  it('a project deleted on the phone (tombstone) is removed from the tablet; a project edited after the deletion survives', async () => {
    const p = base('Borrada', 100);
    const m = mergeBackup(device([p]), await backupOf([], { tombs: { projects: { [p.id]: 500 }, workers: {} } }));
    expect(m.projects).toEqual([]);
    expect(m.removedProjects).toEqual([p.id]);
    const edited = { ...p, updatedAt: 900 };
    expect(mergeBackup(device([edited]), await backupOf([], { tombs: { projects: { [p.id]: 500 }, workers: {} } })).projects).toHaveLength(1);
  });
  it('mergeProjectLists unions by id', () => {
    const a = base('A', 10);
    const b = base('B', 20);
    const { projects } = mergeProjectLists([a], [b, { ...a, updatedAt: 5 }]);
    expect(projects.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe('workers and tombstones', () => {
  it('workers merge by id (newest wins) and a deleted file stays deleted', () => {
    const [w] = normalizeWorkers([{ id: 'w1aaaa', name: 'Luca', updatedAt: 100 }]);
    const newer = { ...w, name: 'Luca B.', updatedAt: 300 };
    expect(mergeWorkers([w], [newer])[0].name).toBe('Luca B.');
    expect(mergeWorkers([newer], [w])[0].name).toBe('Luca B.');
    expect(mergeWorkers([w], [], { w1aaaa: 200 })).toEqual([]);
    expect(mergeWorkers([newer], [], { w1aaaa: 200 })).toHaveLength(1);
  });
  it('removeWorker and markDeleted leave tombstones that survive reloads', () => {
    const { worker } = upsertWorker({ name: 'Ana Rossi' });
    removeWorker(worker.id);
    expect(loadWorkers()).toEqual([]);
    expect(loadTombs().workers[worker.id]).toBeGreaterThan(0);
    markDeleted('projects', 'abc123', 42);
    expect(loadTombs().projects.abc123).toBe(42);
  });
  it('tombstone maps: newest per id, invalid entries dropped, capped', () => {
    expect(mergeTomb({ a1: 5 }, { a1: 9, b2: 1 })).toEqual({ a1: 9, b2: 1 });
    expect(normalizeTomb({ ok1: 3, '!!': 4, neg1: -1, nan: 'x' })).toEqual({ ok1: 3 });
    expect(Object.keys(normalizeTomb(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`t${i}`, i + 1])), 10))).toHaveLength(10);
  });
});

describe('the upload engine: merges before uploading, never dies silently', () => {
  const mk = (over = {}) => {
    const calls = [];
    const client = { saveBackup: vi.fn(async () => ({ id: 'f1', modifiedTime: '2026-11-03T10:00:00.000Z' })) };
    const sync = createDriveSync({
      client,
      collect: async () => {
        calls.push('collect');
        return { app: 'cubrax', version: 1 };
      },
      ensureToken: async () => 'tok',
      storage: localStorage,
      isOnline: () => true,
      beforePush: async () => {
        calls.push('pull');
      },
      ...over,
    });
    return { sync, client, calls };
  };
  it('pulls and merges first, then collects and uploads; remembers the file it wrote', async () => {
    const { sync, client, calls } = mk();
    sync.markDirty();
    expect(await sync.flush()).toEqual({ ok: true });
    expect(calls).toEqual(['pull', 'collect']);
    expect(client.saveBackup).toHaveBeenCalledTimes(1);
    expect(getSeenRemote(localStorage)).toBe('2026-11-03T10:00:00.000Z');
    expect(sync.getState().status).toBe('synced');
  });
  it('if the merge cannot run the stale copy is NOT uploaded and the cloud says why', async () => {
    const { sync, client } = mk({
      beforePush: async () => {
        throw Object.assign(new Error('x'), { code: 'offline' });
      },
    });
    sync.markDirty();
    expect(await sync.flush()).toEqual({ ok: false, reason: 'offline' });
    expect(client.saveBackup).not.toHaveBeenCalled();
    expect(sync.getState()).toMatchObject({ status: 'pending', reason: 'offline', dirty: true });
  });
  it('a token renewal that throws, or an upload that explodes in the debounced timer, becomes pending (never an unhandled silence)', async () => {
    const a = mk({
      ensureToken: async () => {
        throw new Error('boom');
      },
    });
    a.sync.markDirty();
    expect(await a.sync.flush()).toEqual({ ok: false, reason: 'auth' });
    let fire;
    const b = mk({ setTimer: (fn) => (fire = fn), clearTimer: () => {}, collect: async () => { throw new Error('collect failed'); } });
    b.sync.markDirty();
    fire();
    await new Promise((r) => setTimeout(r, 10));
    expect(b.sync.getState()).toMatchObject({ status: 'pending', reason: 'error' });
  });
  it('reportPull lights and clears the cloud', () => {
    const { sync } = mk();
    sync.reportPull({ ok: false, reason: 'auth' });
    expect(sync.getState().pullError).toBe('auth');
    sync.reportPull({ ok: true });
    expect(sync.getState().pullError).toBe('');
    setSeenRemote('', localStorage);
    expect(getSeenRemote(localStorage)).toBe('');
  });
});

describe('the cloud badge for failures', () => {
  const s = { enabled: true, status: 'idle', reason: '', pullError: '', dirty: false, at: 5, held: false };
  it('a failed pull is a pending cloud; amber when it fixes itself or needs a tap, red when something is wrong', () => {
    expect(backupBadgeState({ ...s, pullError: 'auth' })).toBe('pending');
    expect(backupBadgeReason({ ...s, pullError: 'auth' })).toBe('auth');
    expect(backupBadgeTone('offline')).toBe('amber');
    expect(backupBadgeTone('auth')).toBe('amber');
    expect(backupBadgeTone('error')).toBe('red');
    expect(backupBadgeTone('quota')).toBe('red');
    expect(backupBadgeReason({ ...s, status: 'pending', reason: 'quota' })).toBe('quota');
    expect(backupBadgeState({ ...s, status: 'syncing', pullError: 'auth' })).toBe('syncing');
  });
});
