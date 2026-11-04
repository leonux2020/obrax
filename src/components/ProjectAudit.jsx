import { useMemo } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { useMarketClock } from '../lib/marketClock.js';
import { cashSummary, liquidity } from '../lib/ledger.js';
import { projectClient, projectTitle } from '../lib/projects.js';
import { projectTotals } from '../lib/projectTotals.js';
import { usePriceVersion } from '../lib/usePrices.js';
import { headerModel } from '../lib/workspaceModel.js';
import HeaderZone from './workspace/HeaderZone.jsx';
import ProfitabilityPanel from './workspace/ProfitabilityPanel.jsx';
import RenditionBar from './workspace/RenditionBar.jsx';

/**
 * AUDIT MODE of the project: what the user sees when the project was opened from CONTABILIDAD (`fromAccounting`), a pure financial ledger (health, not receipts).
 *
 *   - the financial cockpit on top (DA INCASSARE, preventivo, incassato + its thin progress line), read-only,
 *   - right under it the PROFITABILITY X-RAY (workspace/ProfitabilityPanel): operating margin, collection efficiency and the top 3 suppliers
 *     as a share of the spending. Passive reading: no receipts, no expense list, nothing to tap or scroll,
 *   - "Cerrar Rendición (Enviar a Drive)" at the bottom, the one audit action.
 *
 * Nothing operational is mounted: no grid (Personal, Parámetros, Anticipos, Diario, Gastos), no capture (cash entry, receipt scanner, camera,
 * logbook), no partidas, no dock. The tactical view (opened from Proyectos) is ProjectWorkspace.
 */
export default function ProjectAudit({ project, rendition = null }) {
  const { t, region } = useI18n();
  const { now } = useMarketClock();
  const priceVersion = usePriceVersion(); // live prices landing re-total the quote
  // the quote total comes from the same engine as the rest of the app (valid only when the project has a priceable quote)
  const total = useMemo(() => projectTotals([project], now).get(project.id) ?? 0, [project, now, priceVersion]);
  const cash = cashSummary(total, project.payments);
  const model = headerModel({ project, total, valid: total > 0, cash, liquid: liquidity(project.payments, project.expenses, project.advances), now: Date.now() });

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-3xl bg-black pb-44 text-neutral-200" data-testid="project-audit" data-mode="audit">
      <HeaderZone audit project={project} model={model} title={projectTitle(project) || t('proj.untitled')} client={projectClient(project)} region={region} offline={false} />
      <ProfitabilityPanel project={project} budget={total} />
      {rendition && <RenditionBar projectId={project.id} onClose={rendition.onClose} onRetryQueue={rendition.onRetry} onReconnect={rendition.onReconnect} needsReconnect={rendition.needsReconnect} queue={rendition.queue} />}
    </main>
  );
}
