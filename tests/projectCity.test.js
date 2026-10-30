// "Ciudad o Región de la Obra": a free-text geographic context per project (money stays tied to the market / global settings).
import { describe, it, expect } from 'vitest';
import { cleanCityOrRegion, newExtension, newProject, normalizeProject } from '../src/lib/projects.js';

describe('project.cityOrRegion', () => {
  it('is stored on a new project, cleaned and capped, and does not touch the currency (regionCode)', () => {
    const p = newProject({ regionCode: 'CL', cityOrRegion: '  Valparaíso <b>, Región de Valparaíso  ' });
    expect(p.cityOrRegion).toBe('Valparaíso b, Región de Valparaíso');
    expect(p.draft.regionCode).toBe('CL');
    expect(newProject({ regionCode: 'CL' }).cityOrRegion).toBe('');
    expect(cleanCityOrRegion('x'.repeat(200))).toHaveLength(80);
  });

  it('survives the IndexedDB round trip (normalizeProject) and defaults to "" for older records', () => {
    const p = newProject({ regionCode: 'MX', cityOrRegion: 'Monterrey' });
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.cityOrRegion).toBe('Monterrey');
    const old = JSON.parse(JSON.stringify(p));
    delete old.cityOrRegion;
    expect(normalizeProject(old).cityOrRegion).toBe('');
    expect(typeof normalizeProject({ ...old, cityOrRegion: { evil: true } }).cityOrRegion).toBe('string'); // untrusted input is always reduced to text
  });

  it('an extension keeps the place of the original job', () => {
    const parent = newProject({ regionCode: 'CL', name: 'Casa', cityOrRegion: 'Temuco' });
    expect(newExtension(parent, [parent]).cityOrRegion).toBe('Temuco');
  });
});
