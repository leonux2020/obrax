import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { CONTINENTS, LANGS, LANG_NAMES, REGIONS, regionName, searchRegions } from '../lib/regions.js';
import { detectCurrentRegion } from '../lib/geo.js';
import { MapPinIcon, Outline } from './workspace/icons.jsx';
import BottomSheet from './BottomSheet.jsx';

/**
 * One flat row of a native phone menu: a quiet icon on the left, the title (light type) with an optional dim subtitle, and on the right the
 * current value in the accent colour. No box, no border, no card: only spacing. With `onClick` the whole row is the touch target.
 */
export function SettingsRow({ icon, title, subtitle, value, onClick, testId, valueTestId }) {
  const body = (
    <>
      <span className="shrink-0 text-neutral-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-light tracking-[0.02em] text-neutral-300">{title}</span>
        {subtitle && <span className="block truncate text-sm text-neutral-500">{subtitle}</span>}
      </span>
      {value && (
        <span data-testid={valueTestId} className="max-w-[55%] shrink-0 truncate text-base text-brand/90">
          {value}
        </span>
      )}
    </>
  );
  const cls = 'flex min-h-[64px] w-full items-center gap-3 bg-transparent py-3 text-left';
  return onClick ? (
    <button type="button" onClick={onClick} data-testid={testId} className={`${cls} transition active:opacity-60`}>
      {body}
    </button>
  ) : (
    <div data-testid={testId} className={cls}>
      {body}
    </div>
  );
}

const LanguagesIcon = (props) => (
  <Outline icon="languages" {...props}>
    <path d="m5 8 6 6" />
    <path d="m4 14 6-6 2-3" />
    <path d="M2 5h12" />
    <path d="M7 2h1" />
    <path d="m22 22-5-10-5 10" />
    <path d="M14 18h6" />
  </Outline>
);

const Check = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-brand">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/** A picker row of a sheet: plain text on black, the current choice in the accent colour with a check. */
const optionClass = (on) => `flex min-h-[56px] w-full items-center gap-3 bg-transparent px-1 text-left text-lg font-light tracking-[0.02em] transition active:opacity-60 ${on ? 'text-brand/90' : 'text-neutral-300'}`;

function LangSheet({ lang, onPick, onClose }) {
  const { t } = useI18n();
  return (
    <BottomSheet title={t('lang.label')} onClose={onClose} autoFocus={false}>
      <div data-testid="settings-lang-sheet" role="listbox" aria-label={t('lang.switch')}>
        {LANGS.map((code) => (
          <button key={code} type="button" role="option" aria-selected={code === lang} lang={code} onClick={() => onPick(code)} data-testid={`lang-option-${code}`} className={optionClass(code === lang)}>
            <span className="min-w-0 flex-1 truncate">{LANG_NAMES[code]}</span>
            {code === lang && <Check />}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

function RegionSheet({ value, onPick, onClose }) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const results = searchRegions(query, lang);
  const groups = CONTINENTS.map((c) => ({ id: c, items: results.filter((r) => r.continent === c) })).filter((g) => g.items.length);
  return (
    <BottomSheet title={t('settings.country')} onClose={onClose} tall fill autoFocus={false}>
      <div data-testid="settings-region-sheet" className="flex min-h-0 flex-1 flex-col">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value.slice(0, 40))}
          placeholder={t('region.search')}
          aria-label={t('region.search')}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-testid="region-search"
          className="field-input mb-2 shrink-0"
        />
        <div role="listbox" aria-label={t('region.listLabel')} className="min-h-0 flex-1 overflow-y-auto">
          {results.length === 0 && <p className="px-1 py-3 text-neutral-400">{t('region.noResults')}</p>}
          {groups.map((g) => (
            <div key={g.id} role="group" aria-label={t(g.id === 'AM' ? 'region.america' : 'region.europe')}>
              <p className="px-1 pb-1 pt-3 text-sm font-medium text-neutral-500">{t(g.id === 'AM' ? 'region.america' : 'region.europe')}</p>
              {g.items.map((r) => (
                <button key={r.code} type="button" role="option" aria-selected={r.code === value} onClick={() => onPick(r.code)} data-testid={`region-option-${r.code}`} className={optionClass(r.code === value)}>
                  <span aria-hidden="true" className="w-8 shrink-0 text-center text-2xl leading-none">
                    {r.flag}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{regionName(r, lang)}</span>
                  <span className="shrink-0 text-sm text-neutral-500">{r.currency}</span>
                  {r.code === value && <Check />}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}

/**
 * "Lingua e Paese" as two clean rows (icon, title, current value in the accent colour). A tap opens the picker in a bottom sheet (black, no
 * boxes): picking applies the change in place and closes the sheet. `onConfirmRegion` changes the country without leaving Ajustes; the legacy
 * `onChangeRegion` just opens the old full-screen picker.
 */
export function LocaleRows({ regionCode, onChangeLang, onConfirmRegion, onChangeRegion }) {
  const { t, lang } = useI18n();
  const [sheet, setSheet] = useState(null); // null | 'lang' | 'region'
  const code = regionCode || detectCurrentRegion();
  const region = REGIONS[code];
  const close = () => setSheet(null);
  return (
    <>
      <SettingsRow
        icon={<LanguagesIcon size={22} />}
        title={t('lang.label')}
        value={LANG_NAMES[lang]}
        valueTestId="settings-lang-value"
        testId="settings-lang"
        onClick={() => setSheet('lang')}
      />
      <SettingsRow
        icon={<MapPinIcon size={22} />}
        title={t('settings.country')}
        value={region ? `${region.flag} ${regionName(region, lang)}` : ''}
        valueTestId="settings-region-value"
        testId="settings-region"
        onClick={onConfirmRegion ? () => setSheet('region') : onChangeRegion}
      />
      {sheet === 'lang' && (
        <LangSheet
          lang={lang}
          onClose={close}
          onPick={(l) => {
            onChangeLang(l);
            close();
          }}
        />
      )}
      {sheet === 'region' && (
        <RegionSheet
          value={code}
          onClose={close}
          onPick={(c) => {
            onConfirmRegion(c);
            close();
          }}
        />
      )}
    </>
  );
}
