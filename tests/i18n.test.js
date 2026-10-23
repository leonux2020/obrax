import { describe, it, expect } from 'vitest';
import { DICT, LANG_CODES } from '../src/lib/dict.js';
import { makeI18n, effectiveLocale } from '../src/lib/i18n.jsx';
import { LANGS, LANG_NAMES, REGIONS, REGION_CODES, langForRegion, regionName, searchRegions } from '../src/lib/regions.js';
import { normalizeSettings } from '../src/lib/draft.js';
import { newDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { buildClientModel, buildTechModel } from '../src/lib/reports.js';
import { renderClientPdf, renderTechPdf, pdfMoneyFormatter, pdfFileName, pdfSafe } from '../src/lib/pdf.js';

const params = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();

describe('language bound to country', () => {
  const expected = (code) => {
    if (['BR', 'PT'].includes(code)) return 'pt';
    if (['FR', 'BE'].includes(code)) return 'fr';
    if (code === 'IT') return 'it';
    if (['DE', 'AT'].includes(code)) return 'de';
    if (code === 'ES') return 'es';
    const spanishAmerica = ['MX', 'GT', 'SV', 'HN', 'NI', 'CR', 'PA', 'DO', 'CO', 'VE', 'EC', 'PE', 'BO', 'CL', 'AR', 'UY', 'PY'];
    if (spanishAmerica.includes(code)) return 'es';
    return 'en'; // USA, Canada, UK, Jamaica, Trinidad and the rest of Europe
  };

  it('every country (America + Europe) maps to the specified language', () => {
    expect(REGION_CODES.length).toBeGreaterThanOrEqual(50);
    for (const code of REGION_CODES) expect(REGIONS[code].lang, code).toBe(expected(code));
  });

  it('named examples from the spec', () => {
    const pairs = { BR: 'pt', PT: 'pt', FR: 'fr', BE: 'fr', IT: 'it', DE: 'de', AT: 'de', ES: 'es', MX: 'es', CL: 'es', AR: 'es', US: 'en', CA: 'en', GB: 'en', NL: 'en', PL: 'en', SE: 'en', CH: 'en' };
    for (const [code, lang] of Object.entries(pairs)) expect(langForRegion(code), code).toBe(lang);
    expect(langForRegion('ZZ')).toBe('en');
  });

  it('every language used by a country has a dictionary', () => {
    for (const r of Object.values(REGIONS)) expect(DICT[r.lang], r.code).toBeTruthy();
  });

  it('settings accept the six languages and fall back to the country language', () => {
    expect([...LANGS]).toEqual(['es', 'en', 'pt', 'fr', 'it', 'de']);
    expect(LANG_CODES).toEqual([...LANGS]);
    for (const l of LANGS) expect(normalizeSettings({ region: 'CL', lang: l }).lang).toBe(l);
    expect(normalizeSettings({ region: 'BR', lang: 'xx' }).lang).toBe('pt');
    expect(normalizeSettings({ region: 'DE' }).lang).toBe('de');
    expect(normalizeSettings({}).lang).toBe('es');
  });

  it('language names are native', () => {
    expect(LANG_NAMES).toEqual({ es: 'Español', en: 'English', pt: 'Português', fr: 'Français', it: 'Italiano', de: 'Deutsch' });
  });
});

// Language-neutral templates and genuine ES/PT/IT cognates (identical words in the target language).
const LEGIT_SAME = new Set(['com.taxLine', 'fin.taxLine', 'mat.stud', 'prices.qty', 'company.configure', 'report.commercial', 'report.print', 'pdf.leftoverValue', 'region.listLabel', 'photo.count', 'light.late', 'sign.title', 'mach.line', 'mach.compactor', 'sched.legend.dead', 'splash.credit']);

describe('six complete dictionaries', () => {
  const esKeys = Object.keys(DICT.es).sort();

  it('all languages have exactly the same keys', () => {
    for (const l of LANGS) expect(Object.keys(DICT[l]).sort(), l).toEqual(esKeys);
  });

  it('no empty value and identical {placeholders} everywhere', () => {
    for (const l of LANGS) {
      for (const k of esKeys) {
        expect(String(DICT[l][k]).trim().length, `${l}:${k}`).toBeGreaterThan(0);
        expect(params(DICT[l][k]), `${l}:${k}`).toBe(params(DICT.es[k]));
      }
    }
  });

  it('is really translated, not copied from Spanish', () => {
    for (const l of ['en', 'pt', 'fr', 'it', 'de']) {
      const same = esKeys.filter((k) => !k.startsWith('company.taxId.') && !LEGIT_SAME.has(k) && DICT.es[k].length >= 14 && DICT[l][k] === DICT.es[k]);
      expect(same, l).toEqual([]);
    }
  });

  it('covers tasks, partidas, units, company header and PDF titles', () => {
    const must = ['task.slab', 'task.roof', 'task.floor', 'task.paint', 'unit.bag', 'unit.box', 'company.title', 'company.taxId.CL', 'tech.heading', 'com.heading', 'photo.pdfTitle', 'pdf.file.client', 'pdf.file.tech', 'tech.leftover.title'];
    for (const l of LANGS) for (const k of must) expect(DICT[l][k], `${l}:${k}`).toBeTruthy();
    expect(DICT.pt['tech.leftover.title']).toBe('Inventário de Sobras Reutilizáveis');
    expect(DICT.fr['tech.heading']).toBe('Rapport technique de chantier');
    expect(DICT.it['com.heading']).toBe('Preventivo');
    expect(DICT.de['com.heading']).toBe('Kostenvoranschlag');
  });

  it('PDF file name prefixes are plain ASCII in every language', () => {
    for (const l of LANGS) for (const k of ['pdf.file.client', 'pdf.file.tech']) expect(DICT[l][k]).toMatch(/^[A-Za-z]+$/);
  });
});

describe('i18n engine per language', () => {
  it('t() translates and falls back es -> key', () => {
    expect(makeI18n('de', 'DE').t('step.report')).toBe('Bericht');
    expect(makeI18n('fr', 'FR').t('common.next')).toBe('Suivant');
    expect(makeI18n('xx', 'CL').t('common.next')).toBe('Siguiente');
    expect(makeI18n('it', 'IT').t('does.not.exist')).toBe('does.not.exist');
    expect(makeI18n('pt', 'BR').t('err.range', { min: 1, max: 9 })).toBe('Deve estar entre 1 e 9');
  });

  it('locale follows the active language (region locale only when it speaks it)', () => {
    expect(effectiveLocale('pt', REGIONS.BR)).toBe('pt-BR');
    expect(effectiveLocale('de', REGIONS.AT)).toBe('de-AT');
    expect(effectiveLocale('fr', REGIONS.BE)).toBe('fr-BE');
    expect(effectiveLocale('de', REGIONS.CL)).toBe('de-DE');
    expect(effectiveLocale('en', REGIONS.CL)).toBe('en-US');
    expect(effectiveLocale('es', REGIONS.CL)).toBe('es-CL');
    expect(makeI18n('de', 'DE').num(1234.5)).toBe('1.234,5');
    expect(makeI18n('en', 'US').num(1234.5)).toBe('1,234.5');
    expect(makeI18n('de', 'CL').num(1234.5)).toBe('1.234,5');
  });

  it('country names are localised', () => {
    expect(regionName(REGIONS.DE, 'de')).toBe('Deutschland');
    expect(regionName(REGIONS.FR, 'it')).toBe('Francia');
    expect(regionName(REGIONS.BR, 'pt')).toBe('Brasil');
    expect(regionName(REGIONS.DE, 'fr')).toBe('Allemagne');
    expect(regionName(REGIONS.ES, 'es')).toBe('España');
    expect(searchRegions('deutschland', 'de').map((r) => r.code)).toContain('DE');
    expect(searchRegions('allemagne', 'fr').map((r) => r.code)).toContain('DE');
  });

  it('generic reference chains are translated', () => {
    const hn = makeI18n('de', 'HN');
    expect(hn.t('chain.ferreterialocal')).toBe('Lokaler Baumarkt');
  });
});

describe('PDF titles translate in every language', () => {
  const raw = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');

  for (const lang of LANGS) {
    it(`client and technical PDF headings (${lang})`, async () => {
      const region = lang === 'pt' ? 'BR' : lang === 'fr' ? 'FR' : lang === 'it' ? 'IT' : lang === 'de' ? 'DE' : lang === 'en' ? 'US' : 'CL';
      const d = newDraft(region);
      d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
      const result = computeAll(d, 1_700_000_000_000);
      const i = makeI18n(lang, region);
      expect(i.lang).toBe(lang);
      const money = pdfMoneyFormatter(i.region, i.locale);
      const base = { draft: d, result, company: { name: 'Obra SA', taxId: '', phone: '', email: '', city: '' }, region: i.region, t: i.t, num: i.num, unit: i.unit, date: i.date };

      const client = raw(await renderClientPdf(buildClientModel(base), { money, photos: [] }));
      const tech = raw(await renderTechPdf(buildTechModel({ ...base, money }), { t: i.t, num: i.num, money }));

      expect(client).toContain(pdfSafe(DICT[lang]['com.heading'].toUpperCase()));
      expect(tech).toContain(pdfSafe(DICT[lang]['tech.heading'].toUpperCase()));
      expect(tech).toContain(pdfSafe(DICT[lang]['tech.leftover.title']));
      expect(pdfFileName(i.t('pdf.file.client'), 'Casa 1', new Date(2026, 0, 5))).toBe(`${DICT[lang]['pdf.file.client']}-Casa-1-2026-01-05.pdf`);
    });
  }
});
