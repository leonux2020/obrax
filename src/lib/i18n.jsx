import { createContext, useContext, useMemo } from 'react';
import { DICT } from './dict.js';
import { getRegion, LANG_LOCALES } from './regions.js';

/** Number/date locale for the active language: the region's own locale when it speaks that language. */
export function effectiveLocale(lang, region) {
  if (region && region.locale.split('-')[0] === lang) return region.locale;
  return LANG_LOCALES[lang] || LANG_LOCALES.es;
}

const I18nContext = createContext(null);

/**
 * Money is a property of the MARKET (the project's regionCode), never of the interface language: an Italian job (IT) is always
 * "1.234,50 €" and a Chilean one (CL) "$1.234", whatever language the UI speaks. Text, dates and plain numbers follow the language.
 */
export const moneyLocale = (region, locale) => region?.locale || locale;

export function makeI18n(lang, regionCode) {
  const region = getRegion(regionCode);
  const dict = DICT[lang] || DICT.es;
  const locale = effectiveLocale(DICT[lang] ? lang : 'es', region);
  const digits = region ? region.digits : 2;

  const t = (key, params) => {
    let s = dict[key] ?? DICT.es[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };

  const mLocale = moneyLocale(region, locale);
  const moneyFmt = new Intl.NumberFormat(mLocale, {
    style: 'currency',
    currency: region ? region.currency : 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  // an amount in ANOTHER currency (a receipt printed in EUR inside a CLP job): its own code / symbol and decimals, never the project's
  const foreign = {};
  const moneyIn = (n, currency) => {
    const code = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : '';
    if (!code || code === (region ? region.currency : 'USD')) return moneyFmt.format(n);
    try {
      if (!foreign[code]) {
        // its own symbol ("€"), unless that symbol is the project's too ("$" of a USD receipt in a CLP job): then the ISO code tells them apart
        const symbolOf = (f) => f.formatToParts(0).find((x) => x.type === 'currency')?.value;
        const narrow = new Intl.NumberFormat(mLocale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' });
        foreign[code] = symbolOf(narrow) === symbolOf(moneyFmt) ? new Intl.NumberFormat(mLocale, { style: 'currency', currency: code, currencyDisplay: 'code' }) : narrow;
      }
      return foreign[code].format(n);
    } catch {
      return `${num(n)} ${code}`;
    }
  };
  const numFmts = {};
  const num = (n, maxDigits = 2) => {
    numFmts[maxDigits] ??= new Intl.NumberFormat(locale, { maximumFractionDigits: maxDigits });
    return numFmts[maxDigits].format(n);
  };

  return {
    t,
    lang,
    region,
    locale,
    moneyLocale: mLocale,
    money: (n) => moneyFmt.format(n),
    moneyIn,
    num,
    date: (d = new Date()) => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(d),
    time: (d = new Date()) => new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(d),
    unit: (u) => t(`unit.${u}`),
  };
}

export function I18nProvider({ lang, regionCode, children }) {
  const value = useMemo(() => makeI18n(lang, regionCode), [lang, regionCode]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside provider');
  return ctx;
}
