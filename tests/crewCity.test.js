// @vitest-environment happy-dom
// The Radar de Cercanía compares the job's city with the worker's dedicated "Ciudad / Localidad" field (exact, accents and case ignored),
// and falls back to the old free-text address for files that have no city yet.
import { describe, it, expect } from 'vitest';
import { proximity, rankWorkers } from '../src/lib/crewMatch.js';
import { normalizeWorker } from '../src/lib/workers.js';
import { collectBackup, parseBackup } from '../src/lib/backup.js';
import { saveWorkers } from '../src/lib/workers.js';

const job = (cityOrRegion) => ({ cityOrRegion });
const w = (id, extra) => ({ id, name: `Worker ${id}`, specialties: [], rating: 3, ...extra });

describe('exact city match', () => {
  it('"Milán" = "milan" = "MILAN": accents and case never matter', () => {
    for (const typed of ['Milán', 'milan', 'MILÁN', '  Milan ']) expect(proximity(job('Milan, Lombardía'), { city: typed }), typed).toBe(0);
    expect(proximity(job('MILÁN'), { city: 'milan' })).toBe(0);
  });

  it('the street of the address can no longer fake a "local": only the city field decides', () => {
    // "Calle Santiago" is a street in Valparaíso: with a city field it is NOT in Santiago
    expect(proximity(job('Santiago'), { city: 'Valparaíso', address: 'Calle Santiago 12' })).toBe(2);
    // and the old way would have said local:
    expect(proximity(job('Santiago'), { address: 'Calle Santiago 12, Valparaíso' })).toBe(0);
  });

  it('a city that merely contains the job city is NOT the same city (exact match)', () => {
    expect(proximity(job('Roma'), { city: 'Romagnano' })).toBe(2);
    expect(proximity(job('Santiago'), { city: 'Santiago, RM' })).toBe(0); // a comma-separated field still has the city as a part
  });

  it('regional: the worker\'s city / address names another part of the place (region, province)', () => {
    expect(proximity(job('Valparaíso, Región Metropolitana'), { city: 'Maipú', address: 'Región Metropolitana' })).toBe(1);
    expect(proximity(job('Milán, Lombardía'), { city: 'Bérgamo, Lombardía' })).toBe(1);
    expect(proximity(job('Milán, Lombardía'), { city: 'Nápoles' })).toBe(2);
  });
});

describe('backwards compatibility', () => {
  it('a worker without city is found through the old address text', () => {
    expect(proximity(job('Maipú'), { address: 'Av. Pajaritos 1234, Maipú' })).toBe(0);
    expect(proximity(job('Maipú'), { city: '', address: 'Av. Pajaritos 1234, Maipú' })).toBe(0);
    expect(proximity(job('Maipú'), { address: 'Av. Libertad 10, Viña del Mar' })).toBe(2);
  });

  it('no city nor address (or no job place) cannot be placed: only in "all"', () => {
    expect(proximity(job('Maipú'), {})).toBe(3);
    expect(proximity(job(''), { city: 'Maipú' })).toBe(3);
  });

  it('rankWorkers: old and new files mix in the Local list; the others only in Regional / Todos', () => {
    const list = [
      w('wk000001', { name: 'Old', address: 'Calle 5, Maipú' }),
      w('wk000002', { name: 'New', city: 'maipu' }),
      w('wk000003', { name: 'Far', city: 'Viña del Mar', address: 'Av. Maipú 1' }), // the street is named Maipú, but the town is not
      w('wk000004', { name: 'Blank' }),
    ];
    const names = (range) => rankWorkers(list, { project: job('Maipú'), range }).rows.map((r) => r.worker.name).sort();
    expect(names('local')).toEqual(['New', 'Old']);
    expect(names('all')).toEqual(['Blank', 'Far', 'New', 'Old']);
    expect(rankWorkers(list, { project: job('Maipú'), range: 'local' }).hidden).toBe(1); // "Blank": no city nor address
  });
});

describe('the field travels with the file', () => {
  it('normalizeWorker keeps `city` (and reads the Spanish alias `ciudad`), trimmed and bounded; old files get ""', () => {
    expect(normalizeWorker({ name: 'Ana', city: '  Maipú  ' }).city).toBe('Maipú');
    expect(normalizeWorker({ name: 'Ana', ciudad: 'Milán' }).city).toBe('Milán');
    expect(normalizeWorker({ name: 'Ana' }).city).toBe('');
    expect(normalizeWorker({ name: 'Ana', city: 'x'.repeat(200) }).city.length).toBeLessThanOrEqual(60);
  });

  it('it is in the Drive backup payload and survives the parse', async () => {
    localStorage.clear();
    saveWorkers([{ id: 'wk000001', name: 'Ana Ruiz', specialties: [], rating: 0, city: 'Maipú', address: 'Calle 5', updatedAt: 500 }]);
    const backup = await collectBackup({ settings: {}, company: {}, meta: {}, logo: '', projects: [] });
    expect(backup.workers[0]).toMatchObject({ city: 'Maipú', address: 'Calle 5' });
    expect(parseBackup(JSON.stringify(backup)).workers[0].city).toBe('Maipú');
    localStorage.clear();
  });
});
