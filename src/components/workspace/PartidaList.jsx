import { useI18n } from '../../lib/i18n.jsx';
import { MAX_PARTIDAS } from '../../lib/draft.js';
import { partidaTitle } from '../../lib/reports.js';
import { LEVEL_COLOR } from '../levelStyle.js';
import { priceCaption } from '../../lib/workspaceModel.js';
import PartidaMachinery from './PartidaMachinery.jsx';
import { TaskIcon } from '../TaskPicker.jsx';
import ProjectForm from '../ProjectForm.jsx';
import HseButton from '../HseSheet.jsx';
import Collapsible from './Collapsible.jsx';

/**
 * ZONE B, the living list: one native <details>/<summary> per partida. Open it and the measures, the materials and
 * their prices are right there: tapping a price opens the on-screen numpad (the parent decides what that means, or
 * answers "Precios bloqueados" while the quote is frozen). Below the materials, "Maquinaria en uso" lists the machines of that task.
 * The open partida IS the unified ProjectForm (same screen to create and to edit: `mode`); the materials, safety guide and machinery go in its "Ajustes avanzados".
 * Nothing here owns data: it reads `groups` / `result` and calls back.
 */
export default function PartidaList({ draft, groups, open, locked, onBlocked, onToggle, onUpdate, onTask, onAdd, onRemove, onPrice, showErrors, result = null, setDraft = null, projectLocation = null, mode = 'edit' }) {
  const { t, money, num, unit } = useI18n();
  const project = draft.mode === 'project';
  return (
    <section aria-label={t('ws.list')} data-testid="ws-zone-b" className="space-y-2">
      {groups.map((g, i) => {
        const p = draft.partidas[i];
        if (!p) return null;
        const isOpen = Boolean(open[p.id]);
        return (
          <details
            key={p.id}
            open={isOpen}
            onToggle={(e) => e.currentTarget.open !== isOpen && onToggle(p.id, e.currentTarget.open)}
            data-testid={`partida-${i}`}
            className="group rounded-xl border border-l-2 border-white/10"
            style={{ borderLeftColor: g.incomplete ? LEVEL_COLOR.orange : '#525252' }}
          >
            <summary className="flex min-h-[60px] cursor-pointer list-none items-center gap-3 px-3 [&::-webkit-details-marker]:hidden" data-testid={`partida-summary-${i}`}>
              <span className="text-neutral-400" aria-hidden="true">
                <TaskIcon id={p.task} size={24} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold">{partidaTitle(p, t)}</span>
                <span className="block truncate text-xs text-neutral-400">
                  {t(`task.${p.task}`)}
                  {g.incomplete && (
                    <span style={{ color: LEVEL_COLOR.orange }} className="font-medium">
                      {' · '}
                      {t('ws.incomplete')}
                    </span>
                  )}
                </span>
              </span>
              <span className="text-base font-medium tabular-nums">{g.incomplete ? '—' : money(g.amount)}</span>
              <span aria-hidden="true" className="text-lg text-neutral-500 transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>

            <div className="px-3 py-5">
              <ProjectForm
                mode={mode}
                index={i}
                initialValues={{ id: p.id, name: p.name, task: p.task, dims: p.dims, waste: p.waste }}
                validation={g.validation}
                showErrors={showErrors}
                locked={locked}
                onBlocked={onBlocked}
                onRemove={project ? () => onRemove(p.id) : null}
                onChange={(next) => (next.task !== p.task ? onTask(p.id, next.task) : onUpdate(p.id, (x) => ({ ...x, name: next.name, dims: next.dims, waste: next.waste })))}
                advanced={
                  /* the logistics (materials, safety guide, machinery) is its own block inside "Ajustes avanzados" */
                  <div className="space-y-4" data-testid={`logistics-${i}`}>
                    {g.rows.length > 0 && (
                      <>
                        <p className="text-xs font-light text-neutral-400">{t('ws.logistics')}</p>
                        {/* the materials fold into one quiet row with chips of what is inside; the detail (quantities, prices) opens only when it is needed */}
                        <Collapsible title={t('ws.materials')} chips={g.rows.map((r) => t(`mat.${r.id}`))} testId={`materials-acc-${i}`}>
                          <ul className="space-y-2" data-testid={`materials-${i}`}>
                            {g.rows.map((r) => (
                              <li key={r.id} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold">{t(`mat.${r.id}`)}</span>
                                  <span className="block text-xs font-light text-neutral-400 tabular-nums">
                                    {num(r.packs)} {unit(r.saleUnit)} · {money(r.total)}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => onPrice(r.id)}
                                  data-testid={`price-${r.id}`}
                                  data-origin={r.origin}
                                  data-locked={locked ? 'true' : undefined}
                                  aria-label={`${t(`mat.${r.id}`)}: ${money(r.unitPrice)}${locked ? ` (${t('ws.locked')})` : ''}`}
                                  title={r.shared ? t('ws.shared') : undefined}
                                  className="min-h-[48px] min-w-[104px] rounded-lg bg-black/60 px-3 text-right transition active:scale-95 active:opacity-70"
                                >
                                  <span className="block text-sm font-medium tabular-nums">
                                    {locked && <span aria-hidden="true">🔒 </span>}
                                    {money(r.unitPrice)}
                                  </span>
                                  <span className="block text-xs font-semibold" style={{ color: r.origin === 'user' ? '#e8c35f' : '#a3a3a3' }}>
                                    {r.shared && <span aria-hidden="true">↔ </span>}
                                    {t(`ws.origin.${r.origin}`)}
                                  </span>
                                  <span data-testid={`supplier-${r.id}`} className="block max-w-[11rem] truncate text-xs text-neutral-500">
                                    {priceCaption(t, { origin: r.origin, meta: r.supplier, regionCode: draft.regionCode })}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </Collapsible>
                      </>
                    )}
                    {/* the HSE guide (PPE, ergonomics, waste) of this task: read-only, so it stays available while the quote is frozen */}
                    <div className="flex items-center gap-3" data-testid={`hse-row-${i}`}>
                      <HseButton task={p.task} />
                      <span className="text-xs text-neutral-400">{t('hse.open')}</span>
                    </div>
                    {/* the machinery this task uses (it used to be a module of its own) */}
                    {result && setDraft && <PartidaMachinery draft={draft} result={result} index={i} regionCode={draft.regionCode} projectLocation={projectLocation} locked={locked} onBlocked={onBlocked} setDraft={setDraft} />}
                  </div>
                }
              />
            </div>
          </details>
        );
      })}

      {project && (
        <button
          type="button"
          disabled={draft.partidas.length >= MAX_PARTIDAS}
          onClick={onAdd}
          data-testid="partida-add"
          className="min-h-[52px] w-full rounded-xl border border-dashed border-white/25 text-sm font-semibold text-neutral-300 disabled:opacity-40"
        >
          + {t('ws.addPartida')}
        </button>
      )}
    </section>
  );
}
