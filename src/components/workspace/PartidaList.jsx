import { useI18n } from '../../lib/i18n.jsx';
import { MAX_PARTIDAS } from '../../lib/draft.js';
import { partidaTitle } from '../../lib/reports.js';
import { sanitizeText } from '../../lib/sanitize.js';
import { LEVEL_COLOR } from '../levelStyle.js';
import { WASTE_LIMITS } from '../../lib/tasks.js';
import { priceCaption } from '../../lib/workspaceModel.js';
import { TextField } from '../ui.jsx';
import PercentSlider from '../PercentSlider.jsx';
import LockedZone from './LockedZone.jsx';
import TaskPicker, { TaskIcon } from '../TaskPicker.jsx';
import DimsForm from '../DimsForm.jsx';

/**
 * ZONE B, the living list: one native <details>/<summary> per partida. Open it and the measures, the materials and
 * their prices are right there: tapping a price opens the on-screen numpad (the parent decides what that means, or
 * answers "Precios bloqueados" while the quote is frozen). Nothing here owns data: it reads `groups` and calls back.
 */
export default function PartidaList({ draft, groups, open, locked, onBlocked, onToggle, onUpdate, onTask, onAdd, onRemove, onPrice, showErrors }) {
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
            style={{ borderLeftColor: g.incomplete ? LEVEL_COLOR.orange : 'rgba(224,224,224,0.35)' }}
          >
            <summary className="flex min-h-[60px] cursor-pointer list-none items-center gap-3 px-3 [&::-webkit-details-marker]:hidden" data-testid={`partida-summary-${i}`}>
              <span className="text-[#E0E0E0]/70" aria-hidden="true">
                <TaskIcon id={p.task} size={28} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-bold">{partidaTitle(p, t)}</span>
                <span className="block truncate text-xs text-[#E0E0E0]/70">
                  {t(`task.${p.task}`)}
                  {g.incomplete && (
                    <span style={{ color: LEVEL_COLOR.orange }} className="font-bold">
                      {' · '}
                      {t('ws.incomplete')}
                    </span>
                  )}
                </span>
              </span>
              <span className="text-base font-extrabold tabular-nums">{g.incomplete ? '—' : money(g.amount)}</span>
              <span aria-hidden="true" className="text-lg text-[#E0E0E0]/50 transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>

            <div className="space-y-4 border-t border-white/10 px-3 py-4">
              <LockedZone locked={locked} onBlocked={onBlocked} className="space-y-4">
                <TextField label={t('part.name')} optional={t('common.optional')} placeholder={t('part.namePh')} maxLength={60} value={p.name} sanitize={(v) => sanitizeText(v, 60)} onChange={(name) => onUpdate(p.id, (x) => ({ ...x, name }))} />
                <div>
                  <p id={`ws-type-${p.id}`} className="label">
                    {t('part.type')}
                  </p>
                  <TaskPicker compact value={p.task} onChange={(task) => onTask(p.id, task)} labelledBy={`ws-type-${p.id}`} />
                </div>
                <div>
                  <p className="label">{t('ws.measures')}</p>
                  <DimsForm partida={p} validation={g.validation} showErrors={showErrors} onChange={(patch) => onUpdate(p.id, (x) => ({ ...x, dims: { ...x.dims, ...patch } }))} />
                </div>
                <PercentSlider label={t('fin.waste')} testId={`waste-${i}`} value={p.waste} min={WASTE_LIMITS.min} max={WASTE_LIMITS.max} step={WASTE_LIMITS.step} onChange={(waste) => onUpdate(p.id, (x) => ({ ...x, waste }))} />
                {project && (
                  <button type="button" onClick={() => onRemove(p.id)} data-testid={`partida-remove-${i}`} className="min-h-[44px] text-xs font-bold text-red-400">
                    ✕ {t('part.delete')}
                  </button>
                )}
              </LockedZone>

              {g.rows.length > 0 && (
                <div>
                  <p className="label">{t('ws.materials')}</p>
                  <ul className="divide-y divide-white/10 rounded-xl border border-white/10" data-testid={`materials-${i}`}>
                    {g.rows.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{t(`mat.${r.id}`)}</span>
                          <span className="block text-xs text-[#E0E0E0]/60">
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
                          className="min-h-[48px] min-w-[104px] rounded-lg border border-white/15 px-3 text-right active:border-white/50"
                        >
                          <span className="block text-sm font-extrabold tabular-nums">
                            {locked && <span aria-hidden="true">🔒 </span>}
                            {money(r.unitPrice)}
                          </span>
                          <span className="block text-[10px] font-semibold" style={{ color: r.origin === 'user' ? '#e8c35f' : 'rgba(224,224,224,0.6)' }}>
                            {r.shared && <span aria-hidden="true">↔ </span>}
                            {t(`ws.origin.${r.origin}`)}
                          </span>
                          <span data-testid={`supplier-${r.id}`} className="block max-w-[11rem] truncate text-xs text-gray-500">
                            {priceCaption(t, { origin: r.origin, meta: r.supplier, regionCode: draft.regionCode })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
          className="min-h-[52px] w-full rounded-xl border border-dashed border-white/25 text-sm font-bold text-[#E0E0E0]/80 disabled:opacity-40"
        >
          + {t('ws.addPartida')}
        </button>
      )}
    </section>
  );
}
