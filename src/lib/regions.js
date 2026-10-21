// Regions (countries) of the American continent and Europe.
//
// Each region carries: name (es/en), flag emoji (derived from the ISO code), currency code + symbol,
// official standard VAT / sales-tax rate, and reference hardware / building-supply chains.
//
// SIMULATION DATA: fx (local units per 1 USD) and priceFactor (local construction-materials price index)
// feed the price simulation engine; they are NOT live market data. Tax rates are the standard national
// rates; `taxEditable` regions (US, CA, BR) have no single national rate, so the user can adjust it.
// Chain lists are reference names of well-known retailers; `generic: true` regions use generic labels.

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** ISO 3166-1 alpha-2 code -> flag emoji (regional indicator symbols). */
export function flagEmoji(code) {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const GENERIC_ES = [
  ['Ferretería local', 1.0],
  ['Mayorista de construcción', 0.95],
];
const GENERIC_EN = [
  ['Local hardware store', 1.0],
  ['Building supply wholesaler', 0.95],
];

// [code, es, en, continent, currency, symbol, digits, locale, lang, fx, priceFactor, taxPct, taxName, chains, extra]
const RAW = [
  // ---------------- America ----------------
  ['US', 'Estados Unidos', 'United States', 'AM', 'USD', '$', 2, 'en-US', 'en', 1, 1.1, 8, 'Sales tax', [['Home Depot', 1.0], ["Lowe's", 1.02], ['Menards', 0.94]], { taxEditable: true }],
  ['CA', 'Canadá', 'Canada', 'AM', 'CAD', '$', 2, 'en-CA', 'en', 1.37, 1.15, 5, 'GST', [['The Home Depot', 1.0], ['RONA', 1.03], ['Canadian Tire', 1.02], ['Home Hardware', 1.04]], { taxEditable: true }],
  ['MX', 'México', 'Mexico', 'AM', 'MXN', '$', 2, 'es-MX', 'es', 18, 0.85, 16, 'IVA', [['The Home Depot', 1.05], ['Construrama', 0.95], ['Sodimac', 1.0]]],
  ['GT', 'Guatemala', 'Guatemala', 'AM', 'GTQ', 'Q', 2, 'es-GT', 'es', 7.7, 0.85, 12, 'IVA', [['Cemaco', 1.0], ['Novex', 0.97]]],
  ['SV', 'El Salvador', 'El Salvador', 'AM', 'USD', '$', 2, 'es-SV', 'es', 1, 0.9, 13, 'IVA', [['Freund', 1.0], ['Vidri', 1.02]]],
  ['HN', 'Honduras', 'Honduras', 'AM', 'HNL', 'L', 2, 'es-HN', 'es', 25.5, 0.85, 15, 'ISV', GENERIC_ES, { generic: true }],
  ['NI', 'Nicaragua', 'Nicaragua', 'AM', 'NIO', 'C$', 2, 'es-NI', 'es', 36.8, 0.85, 15, 'IVA', GENERIC_ES, { generic: true }],
  ['CR', 'Costa Rica', 'Costa Rica', 'AM', 'CRC', '₡', 0, 'es-CR', 'es', 510, 0.95, 13, 'IVA', [['Construplaza', 1.0], ['EPA', 0.98], ['El Lagar', 0.97]]],
  ['PA', 'Panamá', 'Panama', 'AM', 'USD', '$', 2, 'es-PA', 'es', 1, 0.95, 7, 'ITBMS', [['Novey', 1.0], ['Do it Center', 1.02], ['Cochez', 0.98]]],
  ['DO', 'República Dominicana', 'Dominican Republic', 'AM', 'DOP', 'RD$', 2, 'es-DO', 'es', 60, 0.9, 18, 'ITBIS', [['Ferretería Ochoa', 1.0], ['Americana', 1.03], ['Bellón', 0.98]]],
  ['JM', 'Jamaica', 'Jamaica', 'AM', 'JMD', 'J$', 2, 'en-JM', 'en', 157, 1.0, 15, 'GCT', GENERIC_EN, { generic: true }],
  ['TT', 'Trinidad y Tobago', 'Trinidad and Tobago', 'AM', 'TTD', 'TT$', 2, 'en-TT', 'en', 6.8, 1.0, 12.5, 'VAT', GENERIC_EN, { generic: true }],
  ['CO', 'Colombia', 'Colombia', 'AM', 'COP', '$', 0, 'es-CO', 'es', 4100, 0.8, 19, 'IVA', [['Homecenter', 1.0], ['Easy', 1.02], ['Corona', 0.97]]],
  ['VE', 'Venezuela', 'Venezuela', 'AM', 'VES', 'Bs.', 2, 'es-VE', 'es', 90, 0.8, 16, 'IVA', GENERIC_ES, { generic: true }],
  ['EC', 'Ecuador', 'Ecuador', 'AM', 'USD', '$', 2, 'es-EC', 'es', 1, 0.9, 15, 'IVA', [['Kywi', 1.0], ['Ferrisariato', 1.03], ['Disensa', 0.97]]],
  ['PE', 'Perú', 'Peru', 'AM', 'PEN', 'S/', 2, 'es-PE', 'es', 3.75, 0.85, 18, 'IGV', [['Sodimac', 1.0], ['Maestro', 0.96], ['Promart', 0.98]]],
  ['BO', 'Bolivia', 'Bolivia', 'AM', 'BOB', 'Bs.', 2, 'es-BO', 'es', 6.9, 0.8, 13, 'IVA', GENERIC_ES, { generic: true }],
  ['CL', 'Chile', 'Chile', 'AM', 'CLP', '$', 0, 'es-CL', 'es', 950, 0.95, 19, 'IVA', [['Sodimac', 1.0], ['Easy', 1.03], ['Construmart', 0.94]]],
  ['AR', 'Argentina', 'Argentina', 'AM', 'ARS', '$', 0, 'es-AR', 'es', 1250, 0.9, 21, 'IVA', [['Easy', 1.02], ['Sodimac', 1.0], ['Blaisten', 0.97]]],
  ['UY', 'Uruguay', 'Uruguay', 'AM', 'UYU', '$U', 2, 'es-UY', 'es', 40, 1.0, 22, 'IVA', GENERIC_ES, { generic: true }],
  ['PY', 'Paraguay', 'Paraguay', 'AM', 'PYG', '₲', 0, 'es-PY', 'es', 7800, 0.8, 10, 'IVA', GENERIC_ES, { generic: true }],
  ['BR', 'Brasil', 'Brazil', 'AM', 'BRL', 'R$', 2, 'pt-BR', 'en', 5.5, 0.85, 17, 'ICMS', [['Leroy Merlin', 1.0], ['Telhanorte', 1.04], ['C&C', 0.98]], { taxEditable: true }],

  // ---------------- Europe ----------------
  ['AT', 'Austria', 'Austria', 'EU', 'EUR', '€', 2, 'de-AT', 'en', 0.92, 1.15, 20, 'USt', [['Bauhaus', 0.99], ['Hornbach', 1.0], ['OBI', 1.02]]],
  ['BE', 'Bélgica', 'Belgium', 'EU', 'EUR', '€', 2, 'nl-BE', 'en', 0.92, 1.15, 21, 'TVA/BTW', [['Brico', 1.0], ['Gamma', 1.01], ['Hubo', 0.98]]],
  ['BG', 'Bulgaria', 'Bulgaria', 'EU', 'EUR', '€', 2, 'bg-BG', 'en', 0.92, 0.7, 20, 'DDS', [['Bauhaus', 1.0], ['Mr. Bricolage', 1.03], ['Praktis', 0.96]]],
  ['HR', 'Croacia', 'Croatia', 'EU', 'EUR', '€', 2, 'hr-HR', 'en', 0.92, 0.85, 25, 'PDV', [['Bauhaus', 1.0], ['Hornbach', 1.02], ['Merkur', 0.98]]],
  ['CZ', 'Chequia', 'Czechia', 'EU', 'CZK', 'Kč', 2, 'cs-CZ', 'en', 23, 0.85, 21, 'DPH', [['Hornbach', 1.0], ['OBI', 1.02], ['Bauhaus', 0.99]]],
  ['DK', 'Dinamarca', 'Denmark', 'EU', 'DKK', 'kr.', 2, 'da-DK', 'en', 6.9, 1.35, 25, 'Moms', [['Bauhaus', 1.0], ['Jem & Fix', 0.97], ['XL-BYG', 1.03]]],
  ['EE', 'Estonia', 'Estonia', 'EU', 'EUR', '€', 2, 'et-EE', 'en', 0.92, 0.95, 24, 'KM', [['Bauhaus', 1.0], ['K-Rauta', 1.02], ['Ehituse ABC', 0.97]]],
  ['FI', 'Finlandia', 'Finland', 'EU', 'EUR', '€', 2, 'fi-FI', 'en', 0.92, 1.25, 25.5, 'ALV', [['K-Rauta', 1.02], ['Bauhaus', 1.0], ['Stark', 0.98]]],
  ['FR', 'Francia', 'France', 'EU', 'EUR', '€', 2, 'fr-FR', 'en', 0.92, 1.15, 20, 'TVA', [['Leroy Merlin', 1.02], ['Castorama', 1.0], ['Brico Dépôt', 0.93], ['Bricomarché', 0.99]]],
  ['DE', 'Alemania', 'Germany', 'EU', 'EUR', '€', 2, 'de-DE', 'en', 0.92, 1.15, 19, 'MwSt', [['OBI', 1.02], ['Bauhaus', 0.99], ['Hornbach', 1.0], ['Hagebau', 1.03]]],
  ['GR', 'Grecia', 'Greece', 'EU', 'EUR', '€', 2, 'el-GR', 'en', 0.92, 0.95, 24, 'FPA', [['Leroy Merlin', 1.0], ['Bauhaus', 0.99]]],
  ['HU', 'Hungría', 'Hungary', 'EU', 'HUF', 'Ft', 0, 'hu-HU', 'en', 365, 0.8, 27, 'AFA', [['Bauhaus', 1.0], ['OBI', 1.02], ['Leroy Merlin', 0.99]]],
  ['IS', 'Islandia', 'Iceland', 'EU', 'ISK', 'kr', 0, 'is-IS', 'en', 138, 1.4, 24, 'VSK', [['Byko', 1.0], ['Húsasmiðjan', 1.02]]],
  ['IE', 'Irlanda', 'Ireland', 'EU', 'EUR', '€', 2, 'en-IE', 'en', 0.92, 1.2, 23, 'VAT', [["Woodie's", 1.0], ['Chadwicks', 0.98], ['Screwfix', 0.96]]],
  ['IT', 'Italia', 'Italy', 'EU', 'EUR', '€', 2, 'it-IT', 'en', 0.92, 1.05, 22, 'IVA', [['Leroy Merlin', 1.02], ['Brico io', 0.98], ['OBI', 1.0], ['Bricocenter', 0.99]]],
  ['LV', 'Letonia', 'Latvia', 'EU', 'EUR', '€', 2, 'lv-LV', 'en', 0.92, 0.95, 21, 'PVN', [['Depo', 0.97], ['K-Rauta', 1.02], ['Bauhaus', 1.0]]],
  ['LT', 'Lituania', 'Lithuania', 'EU', 'EUR', '€', 2, 'lt-LT', 'en', 0.92, 0.95, 21, 'PVM', [['Senukai', 1.0], ['Bauhaus', 1.01], ['Ermitažas', 0.98]]],
  ['LU', 'Luxemburgo', 'Luxembourg', 'EU', 'EUR', '€', 2, 'fr-LU', 'en', 0.92, 1.2, 17, 'TVA', [['Bauhaus', 1.0], ['Hornbach', 1.02], ['Hubo', 0.99]]],
  ['NL', 'Países Bajos', 'Netherlands', 'EU', 'EUR', '€', 2, 'nl-NL', 'en', 0.92, 1.15, 21, 'BTW', [['Gamma', 1.0], ['Karwei', 1.01], ['Praxis', 0.98], ['Hornbach', 1.02]]],
  ['NO', 'Noruega', 'Norway', 'EU', 'NOK', 'kr', 2, 'nb-NO', 'en', 10.7, 1.45, 25, 'Mva', [['Byggmax', 0.95], ['Obs Bygg', 1.0], ['Maxbo', 1.03], ['Montér', 1.02]]],
  ['PL', 'Polonia', 'Poland', 'EU', 'PLN', 'zł', 2, 'pl-PL', 'en', 4.0, 0.8, 23, 'VAT', [['Leroy Merlin', 1.0], ['Castorama', 1.02], ['OBI', 1.03], ['Bricomarché', 0.97]]],
  ['PT', 'Portugal', 'Portugal', 'EU', 'EUR', '€', 2, 'pt-PT', 'en', 0.92, 0.95, 23, 'IVA', [['Leroy Merlin', 1.0], ['Maxmat', 0.97], ['Bricomarché', 0.98], ['Aki', 1.02]]],
  ['RO', 'Rumanía', 'Romania', 'EU', 'RON', 'lei', 2, 'ro-RO', 'en', 4.6, 0.75, 21, 'TVA', [['Dedeman', 0.95], ['Leroy Merlin', 1.02], ['Hornbach', 1.03]]],
  ['SK', 'Eslovaquia', 'Slovakia', 'EU', 'EUR', '€', 2, 'sk-SK', 'en', 0.92, 0.9, 23, 'DPH', [['Bauhaus', 1.0], ['Hornbach', 1.02], ['OBI', 1.03]]],
  ['SI', 'Eslovenia', 'Slovenia', 'EU', 'EUR', '€', 2, 'sl-SI', 'en', 0.92, 0.95, 22, 'DDV', [['Merkur', 1.0], ['Bauhaus', 0.99], ['Hornbach', 1.02]]],
  ['ES', 'España', 'Spain', 'EU', 'EUR', '€', 2, 'es-ES', 'es', 0.92, 1.15, 21, 'IVA', [['Leroy Merlin', 1.02], ['Bricomart', 0.93], ['Bauhaus', 0.99], ['Brico Depôt', 0.95]]],
  ['SE', 'Suecia', 'Sweden', 'EU', 'SEK', 'kr', 2, 'sv-SE', 'en', 10.5, 1.3, 25, 'Moms', [['Bauhaus', 1.0], ['Byggmax', 0.95], ['Hornbach', 1.02], ['Jula', 0.98]]],
  ['CH', 'Suiza', 'Switzerland', 'EU', 'CHF', 'CHF', 2, 'de-CH', 'en', 0.88, 1.6, 8.1, 'MWST', [['Hornbach', 1.0], ['Bauhaus', 0.99], ['Jumbo', 0.97], ['Coop Bau+Hobby', 1.03]]],
  ['GB', 'Reino Unido', 'United Kingdom', 'EU', 'GBP', '£', 2, 'en-GB', 'en', 0.78, 1.15, 20, 'VAT', [['B&Q', 1.0], ['Screwfix', 0.97], ['Wickes', 1.02], ['Travis Perkins', 1.04]]],
  ['UA', 'Ucrania', 'Ukraine', 'EU', 'UAH', '₴', 2, 'uk-UA', 'en', 41, 0.6, 20, 'PDV', [['Epicentr K', 0.98], ['Nova Liniya', 1.02]]],
];

function build([code, es, en, continent, currency, symbol, digits, locale, lang, fx, priceFactor, taxPct, taxName, chains, extra = {}]) {
  return {
    code,
    name: { es, en },
    flag: flagEmoji(code),
    continent,
    currency,
    symbol,
    digits,
    locale,
    lang,
    fx,
    priceFactor,
    taxRate: taxPct / 100,
    taxName,
    taxEditable: Boolean(extra.taxEditable),
    generic: Boolean(extra.generic),
    chains: chains.map(([name, factor]) => ({ id: slug(name), name, factor })),
  };
}

export const REGIONS = Object.freeze(Object.fromEntries(RAW.map((r) => [r[0], Object.freeze(build(r))])));
export const REGION_CODES = Object.freeze(Object.keys(REGIONS));
export const LANGS = Object.freeze(['es', 'en']);
export const CONTINENTS = Object.freeze(['AM', 'EU']);

export function getRegion(code) {
  return REGIONS[code] || null;
}

export function regionName(region, lang) {
  return region.name[lang] || region.name.es;
}

/** Accent/case-insensitive text normaliser used by the country search. */
export const normalizeSearch = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/**
 * Filter regions by free text: country name (both languages), ISO code, currency code/symbol,
 * or reference chain name. Empty query returns everything. Result is ordered by name.
 */
export function searchRegions(query, lang = 'es') {
  const q = normalizeSearch(query);
  const all = Object.values(REGIONS);
  const hits = q
    ? all.filter((r) => {
        const hay = [r.name.es, r.name.en, r.code, r.currency, r.symbol, ...r.chains.map((c) => c.name)].map(normalizeSearch);
        return hay.some((h) => h.includes(q));
      })
    : all;
  return [...hits].sort((a, b) => regionName(a, lang).localeCompare(regionName(b, lang), lang));
}
