// @vitest-environment happy-dom
// Fase 4: "Squadra / Maestranze": the global directory of workers in Ajustes (list, worker file with the health block) and the
// corrected operating margin (collected - (expenses + advances)).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { CLIENT, q, flush, click, typeInto, createHost, deviceBack } from './helpers/appHarness.js';
import { clearDriveToken } from '../src/lib/driveToken.js';
import { collectBackup, parseBackup, restoreBackup } from '../src/lib/backup.js';
import { liquidity, normalizeAdvances, normalizeExpenses, normalizePayments, profitability } from '../src/lib/ledger.js';
import { BLOOD_TYPES, WORKERS_KEY, WORKER_LIMIT, cleanBirthDate, hasHealthNotes, loadWorkers, mergeWorkers, normalizeWorker, normalizeWorkers, removeWorker, saveWorkers, upsertWorker } from '../src/lib/workers.js';
import { wipeLocalData } from '../src/lib/session.js';
import { DICT } from '../src/lib/dict.js';

let App;
let h;

beforeAll(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT);
  App = (await import('../src/App.jsx')).default;
});

const seed = () => {
  localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'es' }));
  localStorage.setItem('cp.user.v1', JSON.stringify({ provider: 'local', name: 'Ana', email: '' }));
  localStorage.setItem('cp.company.v1', JSON.stringify({ name: 'Aurora', proName: 'Ana Ruiz', phone: '', email: '' }));
  localStorage.setItem('cp.profile.v1', JSON.stringify({ onboarded: true, drive: false }));
};
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDriveToken();
  window.history.replaceState(null, '');
  seed();
});
afterEach(() => h?.unmount());

const openAjustes = async () => {
  h = createHost(App);
  await h.mount();
  await click(h.tab('Ajustes'));
};
const typeArea = (el, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('corrected operating margin: collected - (expenses + advances)', () => {
  const project = () => ({
    payments: normalizePayments([{ id: 'adel0001', amount: 150000, at: 1 }]),
    expenses: normalizeExpenses([{ id: 'gasto001', amount: 50000, category: 'material', supplier: 'Sodimac' }, { id: 'gasto002', amount: 20000, category: 'transport', supplier: 'Copec' }]),
    advances: normalizeAdvances([{ id: 'ant00001', worker: 'Juan', amount: 30000, at: 2, workerId: 'w1' }]),
  });
  it('the advances to the staff are subtracted too, and the figure is the SAME as the global liquidity (no discrepancy with Contabilidad)', () => {
    const p = project();
    const x = profitability(p, 0);
    expect(x).toMatchObject({ collected: 150000, spent: 70000, advanced: 30000, margin: 50000 });
    expect(x.margin).toBe(liquidity(p.payments, p.expenses, p.advances));
  });
  it('advances can turn a profit into a loss', () => {
    const p = project();
    p.advances = normalizeAdvances([{ id: 'ant00001', worker: 'Juan', amount: 100000, at: 2, workerId: 'w1' }]);
    expect(profitability(p, 0).margin).toBe(-20000);
  });
  it('the supplier shares are still over the EXPENSES only (advances are not a supplier)', () => {
    const x = profitability(project(), 0);
    expect(x.suppliers.map((s) => [s.name, Math.round(s.share)])).toEqual([['Sodimac', 71], ['Copec', 29]]);
  });
});

describe('workers.js: the Worker entity', () => {
  it('normalizeWorker: needs a name; specialties = known ids, unique, max 6; rating 0..5; junk is cleaned', () => {
    expect(normalizeWorker({ name: '   ' })).toBeNull();
    expect(normalizeWorker(null)).toBeNull();
    const w = normalizeWorker({
      name: '  <b>Juan</b>  Pérez ',
      specialties: ['mason', 'electrician', 'mason', 'astronaut', 'plumber', 'welder', 'tiler', 'painter', 'smith'],
      rating: 9,
      phone: 'abc +56 9 1234-5678',
      sex: 'robot',
      birthDate: '2999-01-01',
      allergies: 'Penicilina <script>',
      emergencyName: 'María',
      emergencyPhone: '+56 9 8888 7777',
    });
    expect(w.name).toBe('bJuan/b Pérez');
    expect(w.specialties).toEqual(['mason', 'electrician', 'plumber', 'welder', 'tiler', 'painter']); // known, unique, 6 at most
    expect(w.rating).toBe(0); // out of range: not rated
    expect(w.phone).toBe('+56 9 1234-5678');
    expect(w.sex).toBe('');
    expect(w.birthDate).toBe(''); // the future is not a birth date
    expect(w.allergies).not.toMatch(/[<>]/);
    expect(w.emergencyPhone).toBe('+56 9 8888 7777');
    expect(w.id).toMatch(/^[a-z0-9]{4,24}$/);
    expect(normalizeWorker({ name: 'A', rating: 4.4 }).rating).toBe(4);
    expect(normalizeWorker({ name: 'A', rating: 3, sex: 'f', birthDate: '1985-02-28' })).toMatchObject({ rating: 3, sex: 'f', birthDate: '1985-02-28' });
  });
  it('cleanBirthDate: real calendar days only', () => {
    expect(cleanBirthDate('1990-02-30')).toBe('');
    expect(cleanBirthDate('1899-12-31')).toBe('');
    expect(cleanBirthDate('1990-06-15')).toBe('1990-06-15');
    expect(cleanBirthDate('15/06/1990')).toBe('');
    expect(cleanBirthDate(undefined)).toBe('');
  });
  it('hasHealthNotes: a limiting condition OR an allergy', () => {
    expect(hasHealthNotes({ limiting: 'vértigo' })).toBe(true);
    expect(hasHealthNotes({ allergies: 'látex' })).toBe(true);
    expect(hasHealthNotes({ emergencyName: 'María' })).toBe(false);
    expect(hasHealthNotes(null)).toBe(false);
  });
  it('storage: upsert / reload / remove; alphabetical; ids unique; a corrupt value reads as empty; the list is bounded', () => {
    expect(loadWorkers()).toEqual([]);
    const a = upsertWorker({ id: 'wk000001', name: 'Zoe Díaz', specialties: ['mason'] }, 100).worker;
    upsertWorker({ id: 'wk000002', name: 'Ana Ruiz', rating: 5 }, 200);
    expect(loadWorkers().map((w) => w.name)).toEqual(['Ana Ruiz', 'Zoe Díaz']);
    const edited = upsertWorker({ id: a.id, name: 'Zoe Díaz', specialties: ['mason', 'plumber'] }, 300).worker;
    expect(edited).toMatchObject({ createdAt: 100, updatedAt: 300, specialties: ['mason', 'plumber'] });
    expect(loadWorkers()).toHaveLength(2);
    expect(upsertWorker({ name: '' }).worker).toBeNull();
    expect(removeWorker('wk000001').map((w) => w.id)).toEqual(['wk000002']);
    removeWorker('wk000002');
    expect(localStorage.getItem(WORKERS_KEY)).toBeNull();
    localStorage.setItem(WORKERS_KEY, '{not json');
    expect(loadWorkers()).toEqual([]);
    expect(normalizeWorkers(Array.from({ length: WORKER_LIMIT + 20 }, (_, i) => ({ id: `wk${String(i).padStart(6, '0')}`, name: `W${i}` })))).toHaveLength(WORKER_LIMIT);
    expect(saveWorkers([{ name: 'X' }, { name: 'X' }])).toHaveLength(2); // no id = two people
  });
  it('mergeWorkers: union by id, the newest updatedAt wins', () => {
    const local = [{ id: 'wk000001', name: 'Ana', updatedAt: 200 }, { id: 'wk000002', name: 'Luis', updatedAt: 100 }];
    const incoming = [{ id: 'wk000001', name: 'Ana OLD', updatedAt: 100 }, { id: 'wk000002', name: 'Luis NEW', updatedAt: 300 }, { id: 'wk000003', name: 'Eva', updatedAt: 1 }];
    expect(mergeWorkers(local, incoming).map((w) => w.name)).toEqual(['Ana', 'Eva', 'Luis NEW']);
  });
});

describe('the directory travels with the backup (and is not lost on logout)', () => {
  const dummyStores = () => ({ projectStore: { save: async () => {} }, photoStoreFor: () => ({ save: async () => {} }), logoStore: { save: async () => {} } });
  it('collect -> parse -> restore round trip keeps the health data; a backup without workers adds no key', async () => {
    saveWorkers([{ id: 'wk000001', name: 'Ana Ruiz', specialties: ['electrician'], rating: 4, allergies: 'Penicilina', limiting: 'Vértigo', emergencyName: 'María', emergencyPhone: '+56 9 1111 2222', updatedAt: 500 }]);
    const backup = await collectBackup({ settings: {}, company: {}, meta: {}, logo: '', projects: [] });
    expect(backup.workers).toHaveLength(1);
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.workers[0]).toMatchObject({ name: 'Ana Ruiz', allergies: 'Penicilina', limiting: 'Vértigo', emergencyPhone: '+56 9 1111 2222', rating: 4 });
    localStorage.clear(); // new device / after logout
    expect(loadWorkers()).toEqual([]);
    await restoreBackup({ projects: [], company: {}, meta: {}, settings: {} }, parsed, dummyStores());
    expect(loadWorkers().map((w) => w.name)).toEqual(['Ana Ruiz']);
    localStorage.clear();
    const empty = await collectBackup({ settings: {}, company: {}, meta: {}, logo: '', projects: [] });
    expect('workers' in empty).toBe(false);
    expect('workers' in parseBackup(JSON.stringify(empty))).toBe(false);
  });
  it('a hostile backup cannot inject rows: invalid ones are dropped and text is cleaned', () => {
    const raw = { app: 'cubrax', version: 1, createdAt: 1, projects: [], workers: [{ name: '' }, 'x', { name: 'Eva <img onerror=x>', specialties: ['hacker'], allergies: '<script>' }] };
    const w = parseBackup(JSON.stringify(raw)).workers;
    expect(w).toHaveLength(2); // the nameless row is dropped; a plain string is an OLD-style worker (legacy adapter) named "x"
    expect(w.map((x) => x.name)).toContain('x');
    expect(w.every((x) => !/[<>]/.test(x.name))).toBe(true);
    expect(w.find((x) => x.name.startsWith('Eva')).specialties).toEqual([]);
  });
  it('logging out wipes the device (health data included): that is why the backup carries it', async () => {
    saveWorkers([{ name: 'Ana' }]);
    await wipeLocalData();
    expect(loadWorkers()).toEqual([]);
  });
});

describe('Ajustes: the "Squadra / Maestranzas" button', () => {
  it('sits in its own card, BELOW every other control and ABOVE the logout, which stays the absolute bottom limit', async () => {
    await openAjustes();
    const btn = q('settings-squadra');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Elenco de Trabajadores');
    const all = [...q('settings-view').querySelectorAll('button, [role="switch"], select, input, summary')];
    const logout = q('logout-button');
    expect(all[all.length - 1]).toBe(logout);
    expect(all[all.length - 2]).toBe(btn); // right above Esci, nothing in between
    expect(q('settings-logout-zone').contains(btn)).toBe(false); // clearly apart from the logout zone
    expect(btn.compareDocumentPosition(q('settings-logout-zone')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q('settings-locale').compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(btn.className).toContain('min-h-[64px]');
  });
  it('is named in the language of the app', async () => {
    localStorage.setItem('cp.settings.v1', JSON.stringify({ region: 'CL', lang: 'it', langLocked: true }));
    h = createHost(App);
    await h.mount();
    await click(q('nav-settings'));
    expect(q('settings-squadra').textContent).toContain('Elenco Lavoratori');
  });
});

describe('Squadra: the directory (list)', () => {
  it('opens full screen from Ajustes; with no workers it invites to add the first one; the device Back closes it', async () => {
    await openAjustes();
    await click(q('settings-squadra'));
    expect(q('squadra')).not.toBeNull();
    expect(q('squadra-empty').textContent).toContain('Aún no hay trabajadores');
    expect(q('squadra-new')).not.toBeNull();
    await deviceBack();
    expect(q('squadra')).toBeNull();
    expect(q('settings-view')).not.toBeNull();
  });

  it('every row: full name, 1-5 stars (amber) and small specialty chips (text-xs bg-neutral-800 text-neutral-300)', async () => {
    saveWorkers([
      { id: 'wk000001', name: 'Juan Pérez Soto', specialties: ['mason', 'electrician'], rating: 4 },
      { id: 'wk000002', name: 'Ana Ruiz', specialties: ['plumber', 'welder', 'tiler', 'painter'], rating: 0, allergies: 'Penicilina' },
    ]);
    await openAjustes();
    await click(q('settings-squadra'));
    const rows = [...document.querySelectorAll('[data-testid="squadra-list"] > li')];
    expect(rows.map((r) => r.querySelector('[data-testid="worker-row-name"]').textContent)).toEqual(['Ana Ruiz', 'Juan Pérez Soto']); // alphabetical
    const juan = q('worker-wk000001');
    const stars = juan.querySelector('[data-testid="stars"]');
    expect(stars.dataset.rating).toBe('4');
    expect(stars.getAttribute('aria-label')).toBe('4 de 5 estrellas');
    expect(stars.querySelectorAll('svg')).toHaveLength(5);
    expect(stars.querySelectorAll('svg.text-amber-400')).toHaveLength(4); // 4 filled in amber, the 5th an outline
    expect([...juan.querySelectorAll('[data-testid="worker-chip"]')].map((c) => c.textContent)).toEqual(['Albañil', 'Electricista']);
    for (const c of juan.querySelectorAll('[data-testid="worker-chip"]')) for (const cls of ['text-xs', 'bg-neutral-800', 'text-neutral-300']) expect(c.className).toContain(cls);
    // more than 3 specialties: 3 chips + "+1"
    const ana = q('worker-wk000002');
    expect(ana.querySelectorAll('[data-testid="worker-chip"]')).toHaveLength(3);
    expect(ana.querySelector('[data-testid="worker-chip-more"]').textContent).toBe('+1');
    expect(ana.querySelector('[data-testid="stars"]').querySelectorAll('svg.text-amber-400')).toHaveLength(0); // not rated
    // only the file with health notes carries the orange mark
    expect(ana.querySelector('[data-testid="worker-health-flag"]')).not.toBeNull();
    expect(juan.querySelector('[data-testid="worker-health-flag"]')).toBeNull();
  });

  it('NICKNAME: the optional "Apodo" is written after the name in a quiet tone; a row without one shows nothing extra', async () => {
    saveWorkers([
      { id: 'wk000001', name: 'Juan Pérez', apodo: 'El Flaco', specialties: ['mason'], rating: 4 },
      { id: 'wk000002', name: 'Ana Ruiz', specialties: ['painter'], rating: 3 },
    ]);
    await openAjustes();
    await click(q('settings-squadra'));
    const juan = q('worker-wk000001');
    expect(juan.querySelector('[data-testid="worker-row-name"]').textContent).toBe('Juan Pérez “El Flaco”');
    expect(juan.querySelector('[data-testid="worker-row-apodo"]').className).toContain('text-neutral-400');
    expect(q('worker-wk000002').querySelector('[data-testid="worker-row-apodo"]')).toBeNull();
    expect(q('worker-wk000002').querySelector('[data-testid="worker-row-name"]').textContent).toBe('Ana Ruiz');
  });
});

describe('Squadra: the worker file', () => {
  const openNew = async () => {
    await openAjustes();
    await click(q('settings-squadra'));
    await click(q('squadra-new'));
  };

  it('the form has an optional "Apodo" field under the name (inside the professional block, OLED like the rest) and it is saved with the file', async () => {
    await openNew();
    const field = q('worker-apodo');
    expect(field).not.toBeNull();
    expect(q('worker-block-pro').contains(field)).toBe(true);
    expect(q('worker-name').compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(field.maxLength).toBe(40);
    expect(field.className).not.toMatch(/bg-neutral-[3-9]00(?!\/)/);
    expect(q('worker-block-pro').textContent).toContain('Apodo');
    expect(q('worker-block-pro').textContent).toContain(DICT.es['common.optional']);
    await typeInto(q('worker-name'), 'Juan Pérez');
    await typeInto(field, 'El Flaco');
    await click(q('worker-save'));
    expect(loadWorkers()[0]).toMatchObject({ name: 'Juan Pérez', apodo: 'El Flaco' });
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de']) expect(DICT[l]['squadra.apodo'], l).toBeTruthy();
  });

  it('three blocks in order: professional, personal and SAFETY AND HEALTH framed in a soft orange panel', async () => {
    await openNew();
    const ids = [...document.querySelectorAll('[data-testid^="worker-block-"]')].map((b) => b.dataset.testid);
    expect(ids).toEqual(['worker-block-pro', 'worker-block-personal', 'worker-block-safety']);
    const pro = q('worker-block-pro');
    for (const id of ['worker-name', 'worker-specialties', 'worker-rating', 'worker-phone', 'worker-city', 'worker-address']) expect(pro.contains(q(id)), id).toBe(true);
    const personal = q('worker-block-personal');
    for (const id of ['worker-document', 'worker-nationality', 'worker-sex', 'worker-birth']) expect(personal.contains(q(id)), id).toBe(true);
    const safety = q('worker-block-safety');
    for (const cls of ['border-orange-500/30', 'bg-orange-500/5']) expect(safety.className).toContain(cls);
    for (const id of ['worker-limiting', 'worker-allergies', 'worker-em-name', 'worker-em-phone']) expect(safety.contains(q(id)), id).toBe(true);
    expect(safety.textContent).toContain('Condiciones limitantes');
    expect(safety.textContent).toContain('Alergias');
    expect(safety.textContent).toContain('Contacto de emergencia');
    expect(q('worker-block-pro').className).not.toContain('orange'); // only the health block is highlighted
    expect(q('worker-block-personal').className).not.toContain('orange');
  });

  it('a name is required; a complete file is saved with its specialties (array), rating and health data, and shows up in the list', async () => {
    await openNew();
    await click(q('worker-save'));
    expect(q('worker-error').textContent).toContain('nombre');
    expect(loadWorkers()).toHaveLength(0);
    await typeInto(q('worker-name'), 'Juan Pérez');
    await click(q('worker-spec-mason'));
    await click(q('worker-spec-electrician'));
    expect(q('worker-spec-mason').getAttribute('aria-pressed')).toBe('true');
    await click(q('worker-star-4'));
    expect(q('worker-rating').dataset.rating).toBe('4');
    await typeInto(q('worker-phone'), '+56 9 1234 5678');
    expect(q('worker-city-hint')).not.toBeNull(); // strongly recommended, never blocking
    await typeInto(q('worker-city'), 'Maipú');
    expect(q('worker-city-hint')).toBeNull();
    await typeInto(q('worker-address'), 'Av. Pajaritos 1234');
    await typeInto(q('worker-document'), '12.345.678-9');
    await typeInto(q('worker-nationality'), 'Chilena');
    await click(q('worker-sex-m'));
    await typeInto(q('worker-birth'), '1988-04-12');
    await typeArea(q('worker-limiting'), 'Vértigo: no trabajar en altura');
    await typeArea(q('worker-allergies'), 'Penicilina');
    await typeInto(q('worker-em-name'), 'María Soto');
    await typeInto(q('worker-em-phone'), '+56 9 8765 4321');
    await click(q('worker-save'));
    expect(q('worker-form')).toBeNull(); // back to the list
    const [w] = loadWorkers();
    expect(w).toMatchObject({
      name: 'Juan Pérez',
      specialties: ['mason', 'electrician'],
      rating: 4,
      phone: '+56 9 1234 5678',
      city: 'Maipú',
      address: 'Av. Pajaritos 1234',
      document: '12.345.678-9',
      nationality: 'Chilena',
      sex: 'm',
      birthDate: '1988-04-12',
      limiting: 'Vértigo: no trabajar en altura',
      allergies: 'Penicilina',
      emergencyName: 'María Soto',
      emergencyPhone: '+56 9 8765 4321',
    });
    const row = q(`worker-${w.id}`);
    expect(row.textContent).toContain('Juan Pérez');
    expect(row.querySelector('[data-testid="worker-health-flag"]')).not.toBeNull();
  });

  it('tapping a worker opens HIS file; editing saves in place (no duplicates); the same star / sex taps clear the value', async () => {
    saveWorkers([{ id: 'wk000001', name: 'Ana Ruiz', specialties: ['plumber'], rating: 3, sex: 'f' }]);
    await openAjustes();
    await click(q('settings-squadra'));
    await click(q('worker-wk000001'));
    expect(q('worker-name')).toBeNull(); // an existing file opens as a read-only card...
    await click(q('worker-edit')); // ...the pencil reveals the form
    expect(q('worker-name').value).toBe('Ana Ruiz');
    expect(q('worker-spec-plumber').getAttribute('aria-pressed')).toBe('true');
    expect(q('worker-rating').dataset.rating).toBe('3');
    await click(q('worker-star-3')); // the same star again: not rated
    expect(q('worker-rating').dataset.rating).toBe('0');
    await click(q('worker-sex-f')); // the same option again: not specified
    expect(q('worker-sex-f').getAttribute('aria-checked')).toBe('false');
    await click(q('worker-spec-welder'));
    await click(q('worker-save'));
    const list = loadWorkers();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'wk000001', rating: 0, sex: '', specialties: ['plumber', 'welder'] });
  });

  it('at most 6 specialties: the rest of the chips lock until one is removed', async () => {
    await openNew();
    for (const id of ['mason', 'electrician', 'plumber', 'welder', 'tiler', 'painter']) await click(q(`worker-spec-${id}`));
    expect(q('worker-spec-smith').disabled).toBe(true);
    await click(q('worker-spec-mason'));
    expect(q('worker-spec-smith').disabled).toBe(false);
  });

  it('Cancel / the device Back close the file WITHOUT saving; the directory underneath stays open', async () => {
    await openNew();
    await typeInto(q('worker-name'), 'Nadie');
    await click(q('worker-cancel'));
    expect(q('worker-form')).toBeNull();
    expect(q('squadra')).not.toBeNull();
    await click(q('squadra-new'));
    await typeInto(q('worker-name'), 'Nadie');
    await deviceBack();
    expect(q('worker-form')).toBeNull();
    expect(q('squadra')).not.toBeNull(); // only the top layer closes
    expect(loadWorkers()).toHaveLength(0);
  });

  it('a new worker has no delete button; deleting an existing one needs a second tap', async () => {
    await openNew();
    expect(q('worker-delete')).toBeNull();
    await click(q('worker-cancel'));
    h.unmount();
    saveWorkers([{ id: 'wk000001', name: 'Ana Ruiz' }]);
    await openAjustes();
    await click(q('settings-squadra'));
    await click(q('worker-wk000001'));
    await click(q('worker-edit'));
    await click(q('worker-delete'));
    expect(loadWorkers()).toHaveLength(1); // one tap deletes nothing
    expect(q('worker-delete-confirm')).not.toBeNull();
    await click(q('worker-delete-cancel'));
    expect(q('worker-delete')).not.toBeNull();
    await click(q('worker-delete'));
    await click(q('worker-delete-confirm'));
    expect(loadWorkers()).toEqual([]);
    expect(q('worker-form')).toBeNull();
    expect(q('squadra-empty')).not.toBeNull();
  });
});

describe('Grupo sanguíneo (closed list, inside Seguridad y Salud)', () => {
  it('BLOOD_TYPES is the 8 ABO/Rh groups, and the entity only keeps one of them (anything else = not specified)', () => {
    expect([...BLOOD_TYPES]).toEqual(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
    for (const b of BLOOD_TYPES) expect(normalizeWorker({ name: 'X', bloodType: b }).bloodType).toBe(b);
    for (const bad of ['', 'C+', 'o+', 'A', 'O positivo', '<b>', null, undefined, 5]) expect(normalizeWorker({ name: 'X', bloodType: bad }).bloodType).toBe('');
    expect(normalizeWorker({ name: 'X' })).toHaveProperty('bloodType', '');
  });

  it('is stored in localStorage and read back; it travels in the backup and a hostile value in a backup is dropped', async () => {
    upsertWorker({ id: 'wk000001', name: 'Ana Ruiz', bloodType: 'AB-' });
    expect(JSON.parse(localStorage.getItem(WORKERS_KEY))[0].bloodType).toBe('AB-');
    expect(loadWorkers()[0].bloodType).toBe('AB-');
    const backup = await collectBackup({ settings: {}, company: {}, meta: {}, logo: '', projects: [] });
    expect(parseBackup(JSON.stringify(backup)).workers[0].bloodType).toBe('AB-');
    const hostile = { ...backup, workers: [{ id: 'wk000002', name: 'Eva', bloodType: 'Z+' }] };
    expect(parseBackup(JSON.stringify(hostile)).workers[0].bloodType).toBe('');
    // an older file of the directory (written before this field existed) still loads: not specified
    localStorage.setItem(WORKERS_KEY, JSON.stringify([{ id: 'wk000003', name: 'Luis', allergies: 'Látex' }]));
    expect(loadWorkers()[0]).toMatchObject({ name: 'Luis', bloodType: '', allergies: 'Látex' });
  });

  it('the form: 8 chips + "No especificado" (default), inside the orange safety block, no free text; the choice is saved and shown again on reopening', async () => {
    await openAjustes();
    await click(q('settings-squadra'));
    await click(q('squadra-new'));
    const blood = q('worker-blood');
    expect(q('worker-block-safety').contains(blood)).toBe(true);
    expect(blood.querySelector('input, textarea, select')).toBeNull(); // strict options only
    const options = [...blood.querySelectorAll('button')];
    expect(options.map((b) => b.textContent)).toEqual(['No especificado', ...BLOOD_TYPES]);
    expect(options.every((b) => b.getAttribute('role') === 'radio')).toBe(true);
    expect(q('worker-blood-none').getAttribute('aria-checked')).toBe('true'); // default
    expect(options.filter((b) => b.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    await typeInto(q('worker-name'), 'Juan Pérez');
    await click(q('worker-blood-O+'));
    expect(q('worker-blood-O+').getAttribute('aria-checked')).toBe('true');
    expect(q('worker-blood-none').getAttribute('aria-checked')).toBe('false');
    await click(q('worker-blood-A-')); // one at a time
    expect(q('worker-blood-O+').getAttribute('aria-checked')).toBe('false');
    await click(q('worker-blood-O-'));
    await click(q('worker-save'));
    expect(loadWorkers()[0].bloodType).toBe('O-');
    await click(q(`worker-${loadWorkers()[0].id}`));
    expect(q('worker-card-blood').textContent).toBe('O-'); // the card shows it...
    await click(q('worker-edit'));
    expect(q('worker-blood-O-').getAttribute('aria-checked')).toBe('true'); // ...and the form has it hydrated
    await click(q('worker-blood-none')); // back to not specified
    await click(q('worker-save'));
    expect(loadWorkers()[0].bloodType).toBe('');
  });
});
