import { describe, it, expect } from 'vitest';
import {
  LIGHT_RULES,
  adoptCompany,
  dayDiff,
  newProject,
  normalizeProject,
  normalizeProjects,
  parseDay,
  snapshotCompany,
  sortProjects,
  toDayString,
  trafficLight,
} from '../src/lib/projects.js';
import { newDraft } from '../src/lib/draft.js';

// Fixed "today": Wed 21 Oct 2026, 15:30 local time.
const NOW = new Date(2026, 9, 21, 15, 30).getTime();
const day = (offset, base = new Date(2026, 9, 21)) => toDayString(new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset));
const light = (start, end) => trafficLight(start, end, NOW);

describe('date helpers', () => {
  it('parses strict local dates and rejects impossible ones', () => {
    expect(parseDay('2026-10-21')).toBeInstanceOf(Date);
    for (const bad of ['2026-02-30', '2026-13-01', '21/10/2026', '', null, undefined, 20261021, '2026-1-5']) {
      expect(parseDay(bad), String(bad)).toBeNull();
    }
    expect(toDayString(parseDay('2026-02-28'))).toBe('2026-02-28');
  });

  it('counts whole calendar days (DST safe)', () => {
    expect(dayDiff(parseDay('2026-03-27'), parseDay('2026-03-30'))).toBe(3); // Europe DST change
    expect(dayDiff(parseDay('2026-10-21'), parseDay('2026-10-21'))).toBe(0);
    expect(dayDiff(parseDay('2026-10-22'), parseDay('2026-10-21'))).toBe(-1);
  });
});

describe('time traffic light', () => {
  it('rules are the agreed ones: 3 days or 20 %', () => {
    expect(LIGHT_RULES).toEqual({ orangeDays: 3, orangeFraction: 0.2 });
  });

  it('green = on time', () => {
    expect(light(day(-10), day(30)).level).toBe('green');
    expect(light(day(0), day(10)).level).toBe('green');
    expect(light(day(-5), day(4)).level).toBe('green'); // 4 days left of 9 (44 %)
  });

  it('orange = 3 days or fewer left', () => {
    expect(light(day(-100), day(3)).level).toBe('orange');
    expect(light(day(-100), day(2)).level).toBe('orange');
    expect(light(day(-100), day(1)).level).toBe('orange');
  });

  it('due today is orange, not red', () => {
    const l = light(day(-10), day(0));
    expect(l.level).toBe('orange');
    expect(l.daysLeft).toBe(0);
  });

  it('orange = 20 % of the schedule or less remains (long schedules)', () => {
    // 100-day schedule: 20 days left = exactly 20 % -> orange; 21 days left -> green
    expect(light(day(-80), day(20)).level).toBe('orange');
    expect(light(day(-79), day(21)).level).toBe('green');
    expect(light(day(-79), day(21)).fractionLeft).toBeCloseTo(0.21, 2);
  });

  it('red = past the estimated end date', () => {
    const l = light(day(-30), day(-1));
    expect(l.level).toBe('red');
    expect(l.daysLeft).toBe(-1);
    expect(light(day(-30), day(-45)).level).toBe('none'); // end before start is invalid
    expect(light(day(-60), day(-40)).level).toBe('red');
  });

  it('a job that has not started yet is green (or orange if the deadline is near)', () => {
    expect(light(day(5), day(60)).level).toBe('green');
    expect(light(day(1), day(3)).level).toBe('orange');
  });

  it('only an end date: falls back to the 3-day rule', () => {
    expect(light('', day(10)).level).toBe('green');
    expect(light('', day(3)).level).toBe('orange');
    expect(light('', day(-1)).level).toBe('red');
  });

  it('no end date, junk or inverted range -> neutral', () => {
    expect(light(day(0), '').level).toBe('none');
    expect(light('', '').level).toBe('none');
    expect(light('x', 'y').level).toBe('none');
    expect(light(day(10), day(2)).level).toBe('none');
  });

  it('is calculated against the real "now": the light changes as days pass', () => {
    const start = day(-10);
    const end = day(12);
    expect(trafficLight(start, end, NOW).level).toBe('green');
    expect(trafficLight(start, end, new Date(2026, 9, 31, 8).getTime()).level).toBe('orange'); // 2 days left
    expect(trafficLight(start, end, new Date(2026, 10, 3, 8).getTime()).level).toBe('red'); // 1 day late
  });

  it('time of day does not matter (whole days)', () => {
    const end = day(0);
    expect(trafficLight(day(-9), end, new Date(2026, 9, 21, 0, 1).getTime()).level).toBe('orange');
    expect(trafficLight(day(-9), end, new Date(2026, 9, 21, 23, 59).getTime()).level).toBe('orange');
    expect(trafficLight(day(-9), end, new Date(2026, 9, 22, 0, 1).getTime()).level).toBe('red');
  });
});

describe('dashboard ordering', () => {
  const mk = (id, start, end, updatedAt = 1) => ({ ...newProject({ regionCode: 'CL', startDate: start, endDate: end, now: updatedAt }), id });
  it('most urgent first: red, orange, green, undated', () => {
    const list = [
      mk('greenaaa', day(-5), day(40)),
      mk('nodateaa', '', ''),
      mk('redaaaaa', day(-30), day(-2)),
      mk('orangeaa', day(-30), day(2)),
      mk('redlater', day(-30), day(-10)),
    ];
    expect(sortProjects(list, NOW).map((p) => p.id)).toEqual(['redlater', 'redaaaaa', 'orangeaa', 'greenaaa', 'nodateaa']);
  });
});

describe('company snapshot embedded in each project', () => {
  const company = { name: 'Constructora Aurora SpA', taxId: '76.123.456-7', phone: '+56 9 1111 2222', email: 'a@b.cl', city: 'Santiago' };
  const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  it('copies name, tax id and logo into the project', () => {
    const p = newProject({ regionCode: 'CL', company, logo: LOGO });
    expect(p.company).toMatchObject({ name: company.name, taxId: company.taxId, phone: company.phone, city: 'Santiago' });
    expect(p.company.logo).toBe(LOGO);
  });

  it('is immutable: changing the global profile later never alters an issued project', () => {
    const profile = { ...company };
    const p2026 = newProject({ regionCode: 'CL', company: profile, logo: LOGO });
    // 2027: the user rebrands
    profile.name = 'Obras Nuevo Nombre';
    profile.taxId = '99.999.999-9';
    const newLogo = 'data:image/png;base64,AAAA';
    const p2027 = newProject({ regionCode: 'CL', company: profile, logo: newLogo });
    expect(p2026.company.name).toBe('Constructora Aurora SpA');
    expect(p2026.company.taxId).toBe('76.123.456-7');
    expect(p2026.company.logo).toBe(LOGO);
    expect(p2027.company.name).toBe('Obras Nuevo Nombre');
    expect(p2027.company.logo).toBe(newLogo);
  });

  it('survives normalisation (what comes back from IndexedDB) untouched', () => {
    const p = newProject({ regionCode: 'CL', company, logo: LOGO });
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.company).toEqual(p.company);
  });

  it('adoptCompany fills only EMPTY snapshots and never overwrites a populated one', () => {
    const empty = newProject({ regionCode: 'CL' });
    const adopted = adoptCompany(empty, company, LOGO);
    expect(adopted.company.name).toBe(company.name);
    expect(adopted.company.logo).toBe(LOGO);
    const issued = newProject({ regionCode: 'CL', company, logo: LOGO });
    const other = { ...company, name: 'Otra', taxId: '1-9' };
    expect(adoptCompany(issued, other, '')).toBe(issued);
    expect(adoptCompany(empty, { name: '', taxId: '', phone: '', email: '', city: '' }, '')).toBe(empty);
  });

  it('rejects hostile logo values', () => {
    expect(snapshotCompany(company, 'javascript:alert(1)').logo).toBe('');
    expect(snapshotCompany(company, 'data:image/svg+xml;base64,PHN2Zz4=').logo).toBe('');
    expect(snapshotCompany(company, 'data:text/html;base64,AAAA').logo).toBe('');
  });
});

describe('project model', () => {
  it('new project carries its own draft, dates and client data', () => {
    const p = newProject({ regionCode: 'MX', name: 'Casa Roble', client: 'Ana', startDate: '2026-10-01', endDate: '2026-12-15', now: 5 });
    expect(p.draft.regionCode).toBe('MX');
    expect(p.draft.project).toEqual({ name: 'Casa Roble', client: 'Ana' });
    expect([p.startDate, p.endDate, p.createdAt, p.updatedAt]).toEqual(['2026-10-01', '2026-12-15', 5, 5]);
    expect(p.draft.mode).toBe(newDraft('MX').mode);
    expect(p.draft.partidas).toHaveLength(1);
  });

  it('drops invalid / inverted dates', () => {
    expect(newProject({ regionCode: 'CL', startDate: '2026-02-30', endDate: '2026-12-01' }).startDate).toBe('');
    const inverted = newProject({ regionCode: 'CL', startDate: '2026-12-01', endDate: '2026-10-01' });
    expect(inverted.endDate).toBe('');
  });

  it('normalizeProject rejects garbage and unknown regions', () => {
    for (const bad of [null, 5, 'x', {}, { id: '!!' }, { id: 'abcdefgh', draft: { regionCode: 'ZZ' } }]) expect(normalizeProject(bad)).toBeNull();
    const ok = newProject({ regionCode: 'CL' });
    expect(normalizeProject({ ...ok, startDate: 'nope', endDate: 7 })).toMatchObject({ startDate: '', endDate: '' });
  });

  it('normalizeProjects removes duplicates and invalid entries', () => {
    const a = newProject({ regionCode: 'CL' });
    expect(normalizeProjects([a, a, { nope: true }, null])).toHaveLength(1);
    expect(normalizeProjects('x')).toEqual([]);
  });
});
