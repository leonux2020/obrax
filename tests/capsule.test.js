// "Deterministic capsule": the quote is a pure function of the project JSON.
//   1. the budget lines (draft.partidas) are merged line by line, not overwritten
//   2. prices, rental rates and tax are copied INTO the project (capsule); the engine never reads the price book / market clock for them
//   3. after a merge the project is recalculated (capsule sealed, totals rewritten) BEFORE it is saved
import { describe, it, expect, beforeEach } from 'vitest';
import { newProject } from '../src/lib/projects.js';
import { newPartida, normalizeDraft } from '../src/lib/draft.js';
import { canon, mergeProject, mergeProjectLists, stampProject } from '../src/lib/merge.js';
import { mergeCapsule, normalizeCapsule, releaseCapsule, withCapsuleRent } from '../src/lib/capsule.js';
import { computeAll } from '../src/lib/engine.js';
import { computeTotals, projectTotal, recalculateProjectTotals, repriceProject, sealProject } from '../src/lib/projectTotals.js';
import { publish, resetRegistry } from '../src/lib/priceRegistry.js';
import { normalizeProject } from '../src/lib/projects.js';
import { collectBackup, mergeBackup, parseBackup, restoreBackup, serializeBackup } from '../src/lib/backup.js';
import { normalizeCompany } from '../src/lib/draft.js';
import { getRegion } from '../src/lib/regions.js';

const NOW = Date.parse('2026-11-04T09:00:00Z');
const HOUR = 3_600_000;

const part = (task, dims, extra = {}) => ({ ...newPartida(task), dims: { ...newPartida(task).dims, ...dims }, ...extra });
const SLAB = (extra) => part('slab', { length: 6, width: 4 }, extra);
const PAINT = (extra) => part('paint', { length: 20, height: 2.5 }, extra);
const FLOOR = (extra) => part('floor', { length: 5, width: 4 }, extra);

function project(partidas, extra = {}) {
  const p = newProject({ regionCode: 'CL', mode: 'project', name: 'Casa', now: 1000 });
  return { ...p, draft: { ...p.draft, partidas }, ...extra };
}
const ids = (p) => p.draft.partidas.map((x) => x.id);

/** A material price in the price book of THIS device (what makes devices disagree). */
const bookWith = (materials) => ({ region: 'CL', at: 5, materials, rent: {} });
const bookForAll = (factor) => {
  const probe = computeAll(project([SLAB(), PAINT(), FLOOR()]).draft, NOW, { book: null, chains: false });
  return bookWith(Object.fromEntries(probe.quote.items.map((i) => [i.id, Math.round(i.unitPrice * factor)])));
};

beforeEach(() => resetRegistry());

describe('1. deep merge of the budget lines (partidas)', () => {
  it('device A adds "Cerámica", device B adds "Pintura": BOTH survive, in both directions', () => {
    const shared = SLAB({ updatedAt: 100 });
    const root = project([shared], { updatedAt: 500 });
    const onA = stampProject(root, { ...root, updatedAt: 900, draft: { ...root.draft, partidas: [shared, FLOOR()] } }, 900);
    const onB = stampProject(root, { ...root, updatedAt: 800, draft: { ...root.draft, partidas: [shared, PAINT()] } }, 800);
    const ab = mergeProject(onA, onB);
    const ba = mergeProject(onB, onA);
    expect(ab.draft.partidas.map((p) => p.task).sort()).toEqual(['floor', 'paint', 'slab']);
    expect(ab.draft.partidas).toHaveLength(3);
    expect(canon(ab)).toBe(canon(ba)); // symmetric: both devices converge on the same quote
    expect(ids(ab)[0]).toBe(shared.id); // the base's own order first, the other device's extra lines after
  });

  it('on the same line the newest change wins; a deletion newer than the line stays deleted', () => {
    const a1 = SLAB({ updatedAt: 100 });
    const b1 = PAINT({ updatedAt: 100 });
    const root = project([a1, b1], { updatedAt: 500 });
    // device A edits the slab (newer) and removes the paint
    const editedSlab = { ...a1, dims: { ...a1.dims, length: 9 } };
    const onA = stampProject(root, { ...root, updatedAt: 700, draft: { ...root.draft, partidas: [editedSlab] } }, 700);
    expect(onA.tomb[b1.id]).toBe(700);
    expect(onA.draft.partidas[0].updatedAt).toBe(700);
    // device B (the project record is NEWER there) only touched an unrelated field and still has the old lines
    const onB = { ...root, updatedAt: 900, startDate: '2026-11-10' };
    const m = mergeProject(onA, onB);
    expect(m.draft.partidas.map((p) => p.id)).toEqual([a1.id]);
    expect(m.draft.partidas[0].dims.length).toBe(9); // A's newer edit of the line survives although B's PROJECT is newer
    expect(m.startDate).toBe('2026-11-10'); // the scalars still come from the newest project
    expect(canon(m)).toBe(canon(mergeProject(onB, onA)));
  });

  it('a quick quote stays ONE partida', () => {
    const q = newProject({ regionCode: 'CL', mode: 'quick', now: 10 });
    const a = { ...q, updatedAt: 20, draft: { ...q.draft, partidas: [{ ...q.draft.partidas[0], updatedAt: 20 }] } };
    const b = { ...q, updatedAt: 30, draft: { ...q.draft, partidas: [{ ...newPartida('slab'), updatedAt: 30 }] } };
    expect(mergeProject(a, b).draft.partidas).toHaveLength(1);
  });

  it('partida stamps survive the normalization of a stored project', () => {
    const p = project([SLAB({ updatedAt: 321 })]);
    expect(normalizeProject(JSON.parse(JSON.stringify(p))).draft.partidas[0].updatedAt).toBe(321);
  });
});

describe('2. the capsule: prices, rentals and tax live INSIDE the project', () => {
  const make = () => project([SLAB(), PAINT(), FLOOR()], { startDate: '2026-11-01', endDate: '2026-11-20' });

  it('sealing copies the price of every material, the rate of every machine and the tax rate into the draft', () => {
    publish('CL', { book: bookForAll(1.3) });
    const sealed = sealProject(make(), { now: NOW });
    const cap = sealed.draft.capsule;
    const live = computeAll(sealed.draft, NOW, { chains: false, timeline: { startDate: '2026-11-01', endDate: '2026-11-20' } });
    expect(Object.keys(cap.prices.best).sort()).toEqual(live.quote.items.map((i) => i.id).sort());
    expect(cap.tax.rate).toBe(getRegion('CL').taxRate);
    expect(live.sealed).toBe(true);
    expect(sealProject(sealed, { now: NOW + 5 })).toBe(sealed); // nothing missing: the same object
  });

  it('a sealed quote ignores a different price book, new supplier prices and the market clock', () => {
    publish('CL', { book: bookForAll(1.3) });
    const sealed = sealProject(make(), { now: NOW });
    const before = projectTotal(sealed, NOW);
    expect(before).toBeGreaterThan(0);
    publish('CL', { book: bookForAll(0.4) }); // another device would hold other prices...
    expect(projectTotal(sealed, NOW)).toBe(before);
    expect(projectTotal(sealed, NOW + 5 * HOUR)).toBe(before); // ...and another market window
    publish('CL', { book: null });
    expect(projectTotal(sealed, NOW + 40 * HOUR)).toBe(before);
    // control: the SAME project without a capsule does follow the global state
    const loose = make();
    publish('CL', { book: bookForAll(0.4) });
    expect(projectTotal(loose, NOW)).not.toBe(before);
  });

  it('the tax rate comes from the capsule; a rate typed in the project (editable markets) still wins', () => {
    const sealed = sealProject(make(), { now: NOW });
    const withTax = (rate) => ({ ...sealed.draft, capsule: { ...sealed.draft.capsule, tax: { rate, at: 1 } } });
    expect(computeAll(withTax(0.5), NOW, { chains: false }).quote.taxRate).toBe(0.5);
    const us = newProject({ regionCode: 'US', mode: 'project', now: 1 });
    const draft = { ...us.draft, partidas: [SLAB()], finance: { ...us.draft.finance, tax: 7 } };
    const sealedUs = sealProject({ ...us, draft }, { now: NOW });
    expect(computeAll(sealedUs.draft, NOW, { chains: false }).quote.taxRate).toBe(0.07);
  });

  it('a price typed in the project (manual override) beats the capsule; the capsule keeps the market one for when it is reset', () => {
    const sealed = sealProject(make(), { now: NOW });
    const id = Object.keys(sealed.draft.capsule.prices.best)[0];
    const typed = { ...sealed.draft, overrides: { [id]: 777 } };
    const r = computeAll(typed, NOW, { chains: false });
    expect(r.prices[id]).toMatchObject({ price: 777, source: 'manual' });
    expect(computeAll(sealed.draft, NOW, { chains: false }).prices[id].price).toBe(sealed.draft.capsule.prices.best[id].p);
  });

  it('a NEW material (a partida added later) is sealed at that moment and the old ones keep their price', () => {
    publish('CL', { book: bookForAll(1) });
    const first = sealProject(project([SLAB()]), { now: NOW });
    const oldPrices = JSON.stringify(first.draft.capsule.prices.best);
    publish('CL', { book: bookForAll(2) });
    const grown = sealProject({ ...first, draft: { ...first.draft, partidas: [...first.draft.partidas, PAINT()] } }, { now: NOW + HOUR });
    const prices = grown.draft.capsule.prices.best;
    for (const [id, e] of Object.entries(JSON.parse(oldPrices))) expect(prices[id]).toEqual(e); // untouched
    expect(Object.keys(prices).length).toBeGreaterThan(Object.keys(JSON.parse(oldPrices)).length);
  });

  it('typed rental rates go into the capsule and survive; "update prices" releases the market ones but not those', () => {
    const sealed = sealProject(make(), { now: NOW });
    const machine = Object.keys(sealed.draft.capsule.rents)[0];
    expect(machine).toBeTruthy();
    const typed = withCapsuleRent(sealed.draft, machine, 12345, NOW);
    expect(computeAll(typed, NOW, { chains: false }).machinery.items.find((i) => i.id === machine).rate).toBe(12345);
    const released = releaseCapsule(typed);
    expect(released.capsule.prices).toEqual({});
    expect(released.capsule.rents[machine]).toMatchObject({ p: 12345, u: true });
    expect(released.capsule.tax).toBeTruthy();
    const frozen = { ...typed, frozen: { at: 1, pricedAt: 1, total: 0, timeline: { startDate: '', endDate: '' } } };
    expect(releaseCapsule(frozen)).toBe(frozen); // a frozen / signed quote never reprices
    const again = repriceProject({ ...make(), draft: released }, { now: NOW });
    expect(Object.keys(again.draft.capsule.prices.best).length).toBeGreaterThan(0);
  });

  it('the capsule is validated like everything stored: junk entries are dropped', () => {
    const cap = normalizeCapsule({ tax: { rate: 9 }, prices: { best: { cement_bag: { p: -1 }, nonsense: { p: 5 } }, 'BAD KEY': {} }, rents: { mixer: { p: 'abc' }, ghost: { p: 1 } } });
    expect(cap).toBeNull();
    expect(normalizeDraft({ ...project([SLAB()]).draft, capsule: 'x' }, 'CL').capsule).toBeUndefined();
  });

  it('the merge of two capsules is entry by entry: union, newest wins, symmetric', () => {
    const x = { v: 1, tax: { rate: 0.19, at: 5 }, prices: { best: { cement_bag: { p: 100, s: 'ref', c: 'sodimac', at: 10 }, sand: { p: 5, s: 'ref', c: 'sodimac', at: 3 } } }, rents: { mixer: { p: 50, s: 'ref', at: 7 } } };
    const y = { v: 1, tax: { rate: 0.2, at: 9 }, prices: { best: { cement_bag: { p: 90, s: 'ai', c: 'easy', at: 20 } }, other: { gravel: { p: 8, s: 'ref', c: 'easy', at: 1 } } }, rents: { scaffold: { p: 9, s: 'ref', at: 2 } } };
    const m = mergeCapsule(x, y);
    expect(m.prices.best.cement_bag.p).toBe(90); // newest
    expect(m.prices.best.sand.p).toBe(5); // only on one side: kept
    expect(Object.keys(m.rents).sort()).toEqual(['mixer', 'scaffold']);
    expect(m.tax.rate).toBe(0.2);
    expect(JSON.stringify(mergeCapsule(y, x))).toBe(JSON.stringify(m));
    // the same stamp is decided by the content, the same on both sides
    const t1 = { v: 1, prices: { best: { cement_bag: { p: 100, s: 'ref', c: 'a', at: 4 } } }, rents: {} };
    const t2 = { v: 1, prices: { best: { cement_bag: { p: 120, s: 'ref', c: 'a', at: 4 } } }, rents: {} };
    expect(JSON.stringify(mergeCapsule(t1, t2))).toBe(JSON.stringify(mergeCapsule(t2, t1)));
  });
});

describe('3. post-merge recalculation (the totals stored in the project)', () => {
  const payments = (...amounts) => amounts.map((amount, i) => ({ id: `pay${i}aaaa`, amount, at: 1, note: '', updatedAt: 10 + i }));

  it('recalculateProjectTotals seals the project and writes total / paid / pending / expensesTotal', () => {
    const p = project([SLAB()], { payments: payments(100, '250'), expenses: [{ id: 'exp1aaaa', amount: 40, at: 1, supplier: '', description: '', category: 'other', projectId: 'x' }] });
    const r = recalculateProjectTotals(p, { now: NOW });
    expect(r.draft.capsule).toBeTruthy();
    const total = projectTotal(r, NOW);
    expect(r.totals).toEqual({ total, paid: 350, pending: Math.max(0, total - 350), expensesTotal: 40 });
    expect(r.totals).toEqual(computeTotals(r, NOW));
    expect(recalculateProjectTotals(r, { now: NOW + HOUR })).toBe(r); // idempotent: the same object, nothing to save
    expect(normalizeProject(JSON.parse(JSON.stringify(r))).totals).toEqual(r.totals); // and the stored JSON keeps them
  });

  it('a project without valid measures stores total null (never NaN) and pending null', () => {
    const q = newProject({ regionCode: 'CL', now: 5 });
    const r = recalculateProjectTotals(q, { now: NOW });
    expect(r.totals).toMatchObject({ total: null, pending: null, paid: 0 });
    expect(r.draft.capsule).toBeUndefined();
  });

  it('mergeProject drops the stale totals of both sides; mergeProjectLists runs the middleware on each merged project', () => {
    const base = recalculateProjectTotals(project([SLAB()], { updatedAt: 100, payments: payments(100) }), { now: NOW });
    const other = recalculateProjectTotals({ ...base, updatedAt: 200, payments: [...base.payments, ...payments(0, 900).slice(1)] }, { now: NOW });
    expect(mergeProject(base, other).totals).toBeUndefined();
    const { projects } = mergeProjectLists([base], [other], {}, 200, (p) => recalculateProjectTotals(p, { now: NOW }));
    expect(projects[0].payments.map((x) => x.amount).sort((a, b) => a - b)).toEqual([100, 900]);
    expect(projects[0].totals.paid).toBe(1000); // the cache already reflects the merged payments when it is saved
  });

  it('TWO devices with different price books end with the SAME total and the same JSON after exchanging their projects', () => {
    const legacy = project([SLAB(), PAINT()], { updatedAt: 100, startDate: '2026-11-01', endDate: '2026-11-15', payments: payments(5000) });
    // each device seals the legacy project with ITS OWN prices (the old behaviour: two different totals)
    publish('CL', { book: bookForAll(1.4) });
    const deviceA = recalculateProjectTotals(legacy, { now: NOW });
    publish('CL', { book: bookForAll(0.6) });
    const deviceB = recalculateProjectTotals(legacy, { now: NOW + 3 * HOUR });
    expect(deviceA.totals.total).not.toBe(deviceB.totals.total);
    // they sync: each merges the other's version (with ITS global state, which no longer matters)
    const finalize = (p) => recalculateProjectTotals(p, { now: NOW + 9 * HOUR });
    publish('CL', { book: bookForAll(1.4) });
    const onA = mergeProjectLists([deviceA], [deviceB], {}, 200, finalize).projects[0];
    publish('CL', { book: bookForAll(0.6) });
    const onB = mergeProjectLists([deviceB], [deviceA], {}, 200, finalize).projects[0];
    expect(onA.totals).toEqual(onB.totals);
    expect(canon(onA)).toBe(canon(onB));
    expect(onA.totals.pending).toBe(Math.max(0, onA.totals.total - 5000));
    // and a third market window later the number is still the same
    publish('CL', { book: null });
    expect(projectTotal(onA, NOW + 100 * HOUR)).toBe(onA.totals.total);
  });

  it('device A adds Pintura, device B adds Cerámica, each with the prices of its own device: the merged quote has both with THEIR prices', () => {
    publish('CL', { book: bookForAll(1) });
    const root = recalculateProjectTotals(project([SLAB()], { updatedAt: 100 }), { now: NOW });
    const edit = (p, partida, at, factor) => {
      publish('CL', { book: bookForAll(factor) });
      const grown = { ...p, updatedAt: at, draft: { ...p.draft, partidas: [...p.draft.partidas, partida] } };
      return recalculateProjectTotals(stampProject(p, grown, at), { now: at, at });
    };
    const onA = edit(root, PAINT(), 2000, 1.5);
    const onB = edit(root, FLOOR(), 3000, 0.7);
    const finalize = (p) => recalculateProjectTotals(p, { now: NOW });
    publish('CL', { book: bookForAll(5) }); // a third, unrelated state while merging
    const ab = mergeProjectLists([onA], [onB], {}, 200, finalize).projects[0];
    const ba = mergeProjectLists([onB], [onA], {}, 200, finalize).projects[0];
    expect(ab.draft.partidas.map((x) => x.task).sort()).toEqual(['floor', 'paint', 'slab']);
    expect(canon(ab)).toBe(canon(ba));
    expect(ab.totals.total).toBe(ba.totals.total);
    expect(ab.totals.total).toBeGreaterThan(0);
    // every material of the merged quote is covered by prices that came from the devices' capsules
    expect(computeAll(ab.draft, NOW, { chains: false, timeline: { startDate: '', endDate: '' } }).sealed).toBe(true);
  });
});

describe('3b. the middleware runs before the merged project is compared and saved (backup restore)', () => {
  const company = normalizeCompany({ name: 'Aurora' });
  const device = (projects) => ({ settings: { region: 'CL', lang: 'es' }, company, meta: { onboarded: true, drive: true }, logo: '', projects });

  it('restoreBackup writes the merged project with its capsule and fresh totals', async () => {
    const local = project([SLAB()], { updatedAt: 100, payments: [{ id: 'pay1aaaa', amount: 1000, at: 1, note: '', updatedAt: 100 }] });
    const remote = { ...local, updatedAt: 50, payments: [...local.payments, { id: 'pay2bbbb', amount: '2500', at: 2, note: '', updatedAt: 60 }] };
    const file = parseBackup(serializeBackup(await collectBackup({ ...device([remote]) })));
    const saved = [];
    const stores = { projectStore: { save: async (p) => saved.push(p), remove: async () => {} }, photoStoreFor: () => ({ save: async () => {}, load: async () => [] }), logoStore: { save: async () => {} } };
    const merged = await restoreBackup({ ...device([local]), tombs: { projects: {}, workers: {} } }, file, stores);
    expect(merged.wonProjects).toEqual([local.id]);
    expect(saved).toHaveLength(1);
    expect(saved[0].payments.map((p) => p.amount).sort((a, b) => a - b)).toEqual([1000, 2500]); // the string amount became a number
    expect(saved[0].draft.capsule).toBeTruthy();
    expect(saved[0].totals.paid).toBe(3500);
    expect(saved[0].totals.total).toBe(projectTotal(saved[0], NOW + 50 * HOUR));
  });

  it('identical data on both sides is still "nothing to do" (the derived fields do not cause a sync loop)', async () => {
    const same = recalculateProjectTotals(project([SLAB()], { updatedAt: 100 }), { now: NOW });
    const file = parseBackup(serializeBackup(await collectBackup({ ...device([same]) })));
    const m = mergeBackup({ ...device([same]), tombs: { projects: {}, workers: {} } }, file);
    expect(m.wonProjects).toEqual([]);
    expect(m.needsPush).toBe(false);
  });
});
