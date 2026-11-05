import { useMemo } from 'react';
import { makeI18n, useI18n } from '../../lib/i18n.jsx';
import { workerLedger } from '../../lib/ledger.js';

/**
 * "Historial financiero" (Riepilogo Pagamenti), READ ONLY, in the file of a person of the global directory: it walks EVERY stored project,
 * finds where this person worked (the crew member picked from this file) and lists `project -> total paid`, then the historical grand total.
 * Money of different currencies is never added: one block per currency, each with its own total. Discounts (retentions: no cash moved)
 * are not payments, so they are not in the total; they show apart, quietly, when there are any.
 */
export default function WorkerLedger({ workerId, projects = [], flat = false }) {
  const { t, lang } = useI18n();
  const groups = useMemo(() => workerLedger(projects, workerId), [projects, workerId]);
  const many = groups.length > 1;
  return (
    <section data-testid="worker-ledger" aria-labelledby="worker-ledger-title" className={flat ? 'space-y-3' : 'space-y-3 rounded-2xl border border-white/10 px-4 py-4'}>
      <h3 id="worker-ledger-title" className="text-base font-medium text-neutral-200">
        {t('squadra.ledger.title')}
      </h3>
      {groups.length === 0 && (
        <p className="text-sm text-neutral-400" data-testid="worker-ledger-empty">
          {t('squadra.ledger.empty')}
        </p>
      )}
      {groups.map((g) => {
        const money = makeI18n(lang, g.regionCode).money;
        return (
          <div key={g.currency || g.regionCode} data-testid={`worker-ledger-${g.currency}`}>
            {many && <p className="mb-0.5 text-xs font-medium tabular-nums text-neutral-400">{g.currency}</p>}
            <ul className={flat ? 'space-y-1' : 'divide-y divide-white/5'}>
              {g.projects.map(({ project, paid, discounted }) => (
                <li key={project.id} className="py-2" data-testid={`worker-ledger-project-${project.id}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-neutral-300">{project.draft?.project?.name || '—'}</span>
                    <span className="shrink-0 text-sm font-medium tabular-nums text-neutral-200" data-testid={`worker-ledger-paid-${project.id}`} data-amount={paid}>
                      {money(paid)}
                    </span>
                  </div>
                  {discounted > 0 && (
                    <p className="mt-0.5 text-right text-xs tabular-nums text-red-400/90" data-testid={`worker-ledger-discounted-${project.id}`}>
                      {t('ws.crew.discounted')}: − {money(discounted)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <div className={`mt-1 flex items-baseline justify-between gap-3 ${flat ? 'pt-3' : 'border-t border-white/10 pt-2.5'}`}>
              <span className="text-sm font-semibold text-neutral-200">{t('squadra.ledger.total')}</span>
              <span className="text-lg font-medium tabular-nums text-neutral-200" data-testid={`worker-ledger-total-${g.currency}`} data-amount={g.paid}>
                {money(g.paid)}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
