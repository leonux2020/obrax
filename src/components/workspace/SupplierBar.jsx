import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { sanitizeText } from '../../lib/sanitize.js';
import { cleanSupplierName } from '../../lib/suppliers.js';

/**
 * The thin strip above a price numpad: "Etiquetas de Proveedor". One tap says where the price comes from (suppliers used
 * before here, then the market's retailers); "+" adds the user's own ("Ferretería Don Pepe"). Tapping the chosen one again
 * clears it. Quiet on purpose: one scrolling line, no extra step, the numpad stays where it was.
 */
export default function SupplierBar({ suggestions, value, onSelect, onAdd }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const name = cleanSupplierName(draft);
    if (name) onAdd(name);
    setDraft('');
    setAdding(false);
  };
  const chips = value && !suggestions.includes(value) ? [value, ...suggestions] : suggestions;

  return (
    <div className="mb-3 -mx-1" data-testid="supplier-bar" role="group" aria-label={t('ws.supplier.label')}>
      <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wide text-[#E0E0E0]/50">{t('ws.supplier.label')}</p>
      {adding ? (
        <form
          className="flex items-center gap-2 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <input
            autoFocus
            type="text"
            value={draft}
            maxLength={60}
            onChange={(e) => setDraft(sanitizeText(e.target.value, 60))}
            placeholder={t('ws.supplier.ph')}
            aria-label={t('ws.supplier.add')}
            data-testid="supplier-input"
            className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-white/20 bg-black px-3 text-sm text-[#E0E0E0] placeholder:text-[#E0E0E0]/40 focus:border-brand focus:outline-none"
          />
          <button type="submit" data-testid="supplier-save" disabled={!cleanSupplierName(draft)} className="min-h-[40px] rounded-lg border border-brand px-3 text-sm font-bold text-brand disabled:opacity-40">
            {t('ws.supplier.use')}
          </button>
          <button type="button" onClick={() => setAdding(false)} aria-label={t('common.cancel')} className="min-h-[40px] px-2 text-sm text-[#E0E0E0]/60">
            ✕
          </button>
        </form>
      ) : (
        <ul className="flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {chips.map((name) => {
            const on = name === value;
            return (
              <li key={name} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onSelect(on ? '' : name)}
                  aria-pressed={on}
                  data-testid="supplier-chip"
                  data-selected={on || undefined}
                  className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold ${on ? 'border-brand text-brand' : 'border-white/15 text-[#E0E0E0]/75 active:border-white/50'}`}
                >
                  {name}
                </button>
              </li>
            );
          })}
          <li className="shrink-0">
            <button type="button" onClick={() => setAdding(true)} data-testid="supplier-add" className="min-h-[36px] rounded-full border border-dashed border-white/25 px-3 text-xs font-bold text-[#E0E0E0]/75 active:border-white/50">
              + {t('ws.supplier.add')}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
