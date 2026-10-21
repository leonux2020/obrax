import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { REGIONS, CONTINENTS, regionName, searchRegions } from '../lib/regions.js';

const pct = (rate) => `${Math.round(rate * 1000) / 10}%`;

/**
 * Compact, searchable country combobox (WAI-ARIA 1.2 pattern). One line when closed; the list opens
 * as an overlay, so it takes no vertical space. Filters by country (es/en), ISO code, currency or chain.
 */
export default function RegionCombobox({ value, onChange }) {
  const { t, lang } = useI18n();
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const selected = value ? REGIONS[value] : null;
  const results = useMemo(() => searchRegions(query, lang), [query, lang]);

  // Flat, ordered list: continent groups first, so keyboard navigation follows what is on screen.
  const groups = useMemo(
    () =>
      CONTINENTS.map((c) => ({ id: c, items: results.filter((r) => r.continent === c) })).filter((g) => g.items.length),
    [results]
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (region) => {
    onChange(region.code);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      if (open && flat[active]) {
        e.preventDefault();
        choose(flat[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setQuery('');
      }
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      setActive(Math.max(0, flat.length - 1));
    }
  };

  const display = open ? query : selected ? `${selected.flag} ${regionName(selected, lang)}` : '';
  let index = -1;

  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className="label">
        {t('region.title')}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && flat[active] ? `${id}-opt-${flat[active].code}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          value={display}
          placeholder={t('region.search')}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setQuery('');
          }}
          onChange={(e) => {
            setOpen(true);
            setQuery(e.target.value.slice(0, 40));
          }}
          onKeyDown={onKeyDown}
          className="field-input pr-12"
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-neutral-400">
          ▾
        </span>
      </div>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={t('region.listLabel')}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border-2 border-neutral-700 bg-black shadow-2xl"
          // keep the input focused while interacting with the list
          onMouseDown={(e) => e.preventDefault()}
        >
          {flat.length === 0 && <p className="px-4 py-3 text-neutral-400">{t('region.noResults')}</p>}
          {groups.map((g) => (
            <div key={g.id} role="group" aria-label={t(g.id === 'AM' ? 'region.america' : 'region.europe')}>
              <p className="sticky top-0 bg-neutral-950 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-brand">
                {t(g.id === 'AM' ? 'region.america' : 'region.europe')}
              </p>
              {g.items.map((r) => {
                index += 1;
                const i = index;
                const isActive = i === active;
                return (
                  <div
                    key={r.code}
                    id={`${id}-opt-${r.code}`}
                    role="option"
                    aria-selected={r.code === value}
                    data-idx={i}
                    onClick={() => choose(r)}
                    onMouseMove={() => setActive(i)}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 ${
                      isActive ? 'bg-brand/20' : ''
                    } ${r.code === value ? 'font-bold' : ''}`}
                  >
                    <span className="w-7 shrink-0 text-center text-2xl leading-none" aria-hidden="true">
                      {r.flag}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{regionName(r, lang)}</span>
                    <span className="shrink-0 text-xs text-neutral-300">
                      {r.currency} {r.symbol} · {r.taxName} {pct(r.taxRate)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
