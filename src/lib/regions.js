// Regions: currency, language, tax and reference hardware chains.
// fx = local currency units per 1 USD (reference), priceFactor = local construction-materials price index.
// `factor` per chain = positioning vs the regional average. All values are SIMULATION reference data.

export const REGIONS = Object.freeze({
  CL: {
    code: 'CL',
    name: { es: 'Chile', en: 'Chile' },
    currency: 'CLP',
    digits: 0,
    locale: 'es-CL',
    lang: 'es',
    fx: 950,
    priceFactor: 0.95,
    taxRate: 0.19,
    taxName: 'IVA',
    chains: [
      { id: 'sodimac', name: 'Sodimac', factor: 1.0 },
      { id: 'easy', name: 'Easy', factor: 1.03 },
      { id: 'construmart', name: 'Construmart', factor: 0.94 },
    ],
  },
  ES: {
    code: 'ES',
    name: { es: 'España', en: 'Spain' },
    currency: 'EUR',
    digits: 2,
    locale: 'es-ES',
    lang: 'es',
    fx: 0.92,
    priceFactor: 1.15,
    taxRate: 0.21,
    taxName: 'IVA',
    chains: [
      { id: 'leroy', name: 'Leroy Merlin', factor: 1.02 },
      { id: 'bricomart', name: 'Bricomart', factor: 0.93 },
      { id: 'bauhaus', name: 'Bauhaus', factor: 0.99 },
      { id: 'bricodepot', name: 'Brico Depôt', factor: 0.95 },
    ],
  },
  MX: {
    code: 'MX',
    name: { es: 'México', en: 'Mexico' },
    currency: 'MXN',
    digits: 2,
    locale: 'es-MX',
    lang: 'es',
    fx: 18,
    priceFactor: 0.85,
    taxRate: 0.16,
    taxName: 'IVA',
    chains: [
      { id: 'homedepot', name: 'The Home Depot', factor: 1.05 },
      { id: 'construrama', name: 'Construrama', factor: 0.95 },
      { id: 'sodimac', name: 'Sodimac', factor: 1.0 },
    ],
  },
  CO: {
    code: 'CO',
    name: { es: 'Colombia', en: 'Colombia' },
    currency: 'COP',
    digits: 0,
    locale: 'es-CO',
    lang: 'es',
    fx: 4100,
    priceFactor: 0.8,
    taxRate: 0.19,
    taxName: 'IVA',
    chains: [
      { id: 'homecenter', name: 'Homecenter', factor: 1.0 },
      { id: 'easy', name: 'Easy', factor: 1.02 },
      { id: 'corona', name: 'Corona', factor: 0.97 },
    ],
  },
  PE: {
    code: 'PE',
    name: { es: 'Perú', en: 'Peru' },
    currency: 'PEN',
    digits: 2,
    locale: 'es-PE',
    lang: 'es',
    fx: 3.75,
    priceFactor: 0.85,
    taxRate: 0.18,
    taxName: 'IGV',
    chains: [
      { id: 'sodimac', name: 'Sodimac', factor: 1.0 },
      { id: 'maestro', name: 'Maestro', factor: 0.96 },
      { id: 'promart', name: 'Promart', factor: 0.98 },
    ],
  },
  US: {
    code: 'US',
    name: { es: 'Estados Unidos', en: 'United States' },
    currency: 'USD',
    digits: 2,
    locale: 'en-US',
    lang: 'en',
    fx: 1,
    priceFactor: 1.1,
    taxRate: 0.07,
    taxName: 'Sales tax',
    chains: [
      { id: 'homedepot', name: 'Home Depot', factor: 1.0 },
      { id: 'lowes', name: "Lowe's", factor: 1.02 },
      { id: 'menards', name: 'Menards', factor: 0.94 },
    ],
  },
});

export const REGION_CODES = Object.freeze(Object.keys(REGIONS));
export const LANGS = Object.freeze(['es', 'en']);

export function getRegion(code) {
  return REGIONS[code] || null;
}

export function regionName(region, lang) {
  return region.name[lang] || region.name.es;
}
