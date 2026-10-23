import { useMemo, useState } from 'react';
import { useI18n, makeI18n } from '../lib/i18n.jsx';
import { useMarketClock } from '../lib/marketClock.js';
import { getRegion } from '../lib/regions.js';
import { buildRenditionFile, projectBalance } from '../lib/rendition.js';
import { projectClient, projectTitle } from '../lib/projects.js';
import { projectTotals } from '../lib/projectTotals.js';
import { shareOrDownload } from '../lib/shareFile.js';
import { Button, Logo } from './ui.jsx';

/**
 * "Contabilidad Global": every project with its cash balance (collected - expenses - advances). Tick several and
 * one tap shares a single consolidated Excel through the native share sheet (a download where it cannot).
 */
export default function GlobalAccounting({ projects }) {
  const { t, lang, locale } = useI18n();
  const { now } = useMarketClock();
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const totals = useMemo(() => projectTotals(projects, now), [projects, now]);
  const rows = useMemo(() => projects.map((p) => ({ project: p, balance: projectBalance(p, totals.get(p.id)), fmt: makeI18n(lang, p.draft.regionCode).money })), [projects, totals, lang]);
  const all = projects.length > 0 && selected.length === projects.length;
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const exportGlobal = async () => {
    const chosen = projects.filter((p) => selected.includes(p.id));
    if (!chosen.length || busy) return;
    setBusy(true);
    setNote('');
    try {
      const regions = new Set(chosen.map((p) => getRegion(p.draft.regionCode)?.currency));
      const first = getRegion(chosen[0].draft.regionCode);
      const file = buildRenditionFile(chosen, totals, { t, locale, currency: regions.size === 1 ? first.currency : '', digits: first.digits });
      const outcome = await shareOrDownload(file, { title: t('xl.shareTitleGlobal') });
      setNote(outcome === 'downloaded' ? 'downloaded' : '');
    } catch {
      setNote('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-3 pb-44 pt-3 sm:px-4" data-testid="accounting">
      <header className="mb-3 flex items-center gap-3">
        <Logo size={34} />
        <h1 className="min-w-0 flex-1 truncate text-2xl font-extrabold tracking-tight">{t('nav.accounting')}</h1>
        {projects.length > 0 && (
          <button
            type="button"
            onClick={() => setSelected(all ? [] : projects.map((p) => p.id))}
            data-testid="acc-all"
            className="min-h-[44px] rounded-lg border border-white/10 px-3 text-sm font-bold hover:border-brand"
          >
            {t(all ? 'acc.none' : 'acc.all')}
          </button>
        )}
      </header>

      {projects.length === 0 ? (
        <p className="mt-10 text-center text-neutral-400" data-testid="acc-empty">
          {t('acc.empty')}
        </p>
      ) : (
        <ul className="space-y-2" aria-label={t('nav.accounting')}>
          {rows.map(({ project: p, balance: b, fmt }) => {
            const on = selected.includes(p.id);
            return (
              <li key={p.id}>
                <label
                  data-testid={`acc-row-${p.id}`}
                  className={`flex min-h-[72px] cursor-pointer items-center gap-3 rounded-2xl border bg-black px-4 py-3 transition ${on ? 'border-brand' : 'border-white/10'}`}
                >
                  <input type="checkbox" className="h-6 w-6 shrink-0 accent-[#22c55e]" checked={on} onChange={() => toggle(p.id)} aria-label={projectTitle(p) || t('proj.untitled')} data-testid={`acc-check-${p.id}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{projectTitle(p) || t('proj.untitled')}</span>
                    <span className="block truncate text-xs text-neutral-400">{projectClient(p) || t('proj.noClient')}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block font-extrabold tabular-nums ${b.balance < 0 ? 'text-red-400' : 'text-brand'}`}>{fmt(b.balance)}</span>
                    <span className="block text-[11px] text-neutral-400">{t('xl.balance')}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {projects.length > 0 && (
        <div className="no-print fixed inset-x-0 z-30 px-3 [bottom:calc(5.25rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-3xl">
            {note === 'error' && (
              <p role="alert" className="mb-2 rounded-lg bg-black px-1 text-sm font-semibold text-red-400">
                {t('xl.error')}
              </p>
            )}
            {note === 'downloaded' && (
              <p role="status" data-testid="acc-note" className="mb-2 rounded-lg bg-black px-1 text-sm text-neutral-300">
                {t('share.downloaded')}
              </p>
            )}
            <Button className="w-full" disabled={selected.length === 0 || busy} onClick={exportGlobal} data-testid="acc-export">
              {busy ? t('pdf.generating') : t('acc.export', { n: selected.length })}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
