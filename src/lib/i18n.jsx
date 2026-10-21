import { createContext, useContext, useMemo } from 'react';
import { DICT } from './dict.js';
import { getRegion, LANG_LOCALES } from './regions.js';

/** Number/date locale for the active language: the region's own locale when it speaks that language. */
export function effectiveLocale(lang, region) {
  if (region && region.locale.split('-')[0] === lang) return region.locale;
  return LANG_LOCALES[lang] || LANG_LOCALES.es;
}

const I18nContext = createContext(null);

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

  const moneyFmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: region ? region.currency : 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
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
    money: (n) => moneyFmt.format(n),
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
