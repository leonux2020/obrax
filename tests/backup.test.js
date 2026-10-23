import { describe, it, expect } from 'vitest';
import { BACKUP_VERSION, collectBackup, isDeviceEmpty, mergeBackup, parseBackup, restoreBackup, serializeBackup } from '../src/lib/backup.js';
import { newProject } from '../src/lib/projects.js';
import { normalizeCompany } from '../src/lib/draft.js';

const JPEG = `data:image/jpeg;base64,${'A'.repeat(200)}`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const photo = (slot) => ({ slot, dataUrl: JPEG, width: 800, height: 600, at: 5 });
const proj = (name, updatedAt, extra = {}) => ({ ...newProject({ regionCode: 'CL', name, now: updatedAt, company: { name: 'Aurora', signature: { dataUrl: PNG, w: 10, h: 10 } } }), updatedAt, ...extra });
const company = normalizeCompany({ name: 'Aurora', taxId: '76.1', signature: { dataUrl: PNG, w: 120, h: 40 } });
const base = (projects = []) => ({ settings: { region: 'CL', lang: 'es' }, company, meta: { onboarded: true, drive: true }, logo: '', projects });

describe('backup document', () => {
  it('collect -> serialize -> parse is lossless for projects, photos, profile and signature', async () => {
    const a = proj('Casa', 100);
    const b = proj('Bodega', 200);
    const text = serializeBackup(
      await collectBackup({ ...base([a, b]), loadPhotos: async (id) => (id === a.id ? [photo(0), null, photo(2), null] : [null, null, null, null]), now: 999 })
    );
    const got = parseBackup(text);
    expect(got.version).toBe(BACKUP_VERSION);
    expect(got.createdAt).toBe(999);
    expect(got.projects.map((p) => p.draft.project.name).sort()).toEqual(['Bodega', 'Casa']);
    expect(Object.keys(got.photos)).toEqual([a.id]); // projects without photos carry none
    expect(got.photos[a.id].map((p) => p.slot)).toEqual([0, 2]);
    expect(got.company.signature).toEqual({ dataUrl: PNG, w: 120, h: 40 });
    expect(got.company.name).toBe('Aurora');
    expect(got.settings).toEqual({ region: 'CL', lang: 'es' });
  });

  it('rejects anything that is not a usable CUBRAX backup', () => {
    for (const bad of ['', 'nope', '[]', 'null', '{"app":"other","version":1}', `{"app":"cubrax","version":${BACKUP_VERSION + 1}}`, '{"app":"cubrax","version":"x"}', 'x'.repeat(61_000_000)]) {
      expect(parseBackup(bad), bad.slice(0, 30)).toBeNull();
    }
    expect(parseBackup(null)).toBeNull();
  });

  it('untrusted content is sanitised: broken projects, scripts in the signature and non-JPEG photos are dropped', async () => {
    const p = proj('Casa', 100);
    const raw = JSON.parse(serializeBackup(await collectBackup({ ...base([p]), loadPhotos: async () => [photo(0)] })));
    raw.projects.push({ id: 'zzz', junk: true }, 'string', null);
    raw.company.signature = { dataUrl: 'javascript:alert(1)', w: 1, h: 1 };
    raw.photos[p.id].push({ slot: 1, dataUrl: 'data:text/html;base64,AAAA', width: 10, height: 10 }, { slot: 99, dataUrl: JPEG, width: 10, height: 10 });
    raw.photos.ghost = [photo(0)]; // photos of a project that is not in the file
    const got = parseBackup(JSON.stringify(raw));
    expect(got.projects).toHaveLength(1);
    expect(got.company.signature).toBeNull();
    expect(got.photos[p.id]).toHaveLength(1);
    expect(got.photos.ghost).toBeUndefined();
  });
});

describe('merging a backup into a device (never destructive)', () => {
  it('union of projects; the newest updatedAt of each id wins, ties keep the local one', async () => {
    const shared = proj('Compartida', 100);
    const localOnly = proj('Solo local', 50);
    const remoteOnly = proj('Solo Drive', 70);
    const sharedNew = { ...shared, updatedAt: 300, draft: { ...shared.draft, project: { name: 'Compartida v2', client: '' } } };
    const sharedOld = { ...shared, updatedAt: 10 };
    const remote = parseBackup(serializeBackup(await collectBackup({ ...base([remoteOnly, sharedNew]) })));
    const m = mergeBackup(base([localOnly, shared]), remote);
    expect(m.projects.map((p) => p.draft.project.name)).toEqual(['Compartida v2', 'Solo Drive', 'Solo local']);
    expect(m.wonProjects.sort()).toEqual([remoteOnly.id, shared.id].sort());
    const keepLocal = mergeBackup(base([shared]), parseBackup(serializeBackup(await collectBackup({ ...base([sharedOld]) }))));
    expect(keepLocal.projects[0].updatedAt).toBe(100);
    expect(keepLocal.wonProjects).toEqual([]);
    const tie = mergeBackup(base([shared]), parseBackup(serializeBackup(await collectBackup({ ...base([{ ...shared, draft: { ...shared.draft, project: { name: 'otro', client: '' } } }]) }))));
    expect(tie.projects[0].draft.project.name).toBe('Compartida');
  });

  it('the profile, signature and settings fill an EMPTY device only; an existing profile is never overwritten', async () => {
    const remote = parseBackup(serializeBackup(await collectBackup({ ...base([proj('X', 1)]), logo: '' })));
    const empty = { settings: { region: null, lang: 'es' }, company: normalizeCompany({}), meta: { onboarded: false, drive: true }, logo: '', projects: [] };
    expect(isDeviceEmpty(empty)).toBe(true);
    const fresh = mergeBackup(empty, remote);
    expect(fresh.profileRestored).toBe(true);
    expect(fresh.company.name).toBe('Aurora');
    expect(fresh.company.signature.w).toBe(120);
    expect(fresh.settings.region).toBe('CL');
    expect(fresh.meta).toEqual({ onboarded: true, drive: true });

    const mine = { ...empty, company: normalizeCompany({ name: 'Mi empresa' }), meta: { onboarded: true, drive: false }, settings: { region: 'AR', lang: 'es' } };
    expect(isDeviceEmpty(mine)).toBe(false);
    const kept = mergeBackup(mine, remote);
    expect(kept.profileRestored).toBe(false);
    expect(kept.company.name).toBe('Mi empresa');
    expect(kept.settings.region).toBe('AR');
    expect(kept.meta.drive).toBe(false);
  });

  it('restoreBackup writes only the projects that won, with their photos, and the logo, through the stores', async () => {
    const a = proj('Casa', 100);
    const b = proj('Local', 500);
    const remote = parseBackup(serializeBackup(await collectBackup({ ...base([a, { ...b, updatedAt: 1 }]), loadPhotos: async (id) => (id === a.id ? [photo(1)] : [photo(0)]), logo: '' })));
    const saved = [];
    const photos = {};
    const stores = {
      projectStore: { save: async (p) => saved.push(p.id) },
      photoStoreFor: (id) => ({ save: async (ph) => (photos[id] ||= []).push(ph.slot) }),
      logoStore: { save: async () => { throw new Error('no logo expected'); } },
    };
    const empty = { settings: { region: null, lang: 'es' }, company: normalizeCompany({}), meta: { onboarded: false, drive: true }, logo: '' };
    const merged = await restoreBackup({ ...empty, projects: [b] }, remote, stores);
    expect(saved).toEqual([a.id]); // b is newer locally: untouched
    expect(photos).toEqual({ [a.id]: [1] });
    expect(merged.projects).toHaveLength(2);
  });
});
