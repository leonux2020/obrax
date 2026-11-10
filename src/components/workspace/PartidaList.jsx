import { useI18n } from '../../lib/i18n.jsx';
import { MAX_PARTIDAS } from '../../lib/draft.js';
import { partidaTitle } from '../../lib/reports.js';
import { sanitizeText } from '../../lib/sanitize.js';
import { LEVEL_COLOR } from '../levelStyle.js';
import { WASTE_PRESETS as PRESET_VALUES, effectiveWaste } from '../../lib/tasks.js';
import { priceCaption } from '../../lib/workspaceModel.js';
import { TextField } from '../ui.jsx';
import LockedZone from './LockedZone.jsx';
import PartidaMachinery from './PartidaMachinery.jsx';
import TaskPicker, { TaskIcon } from '../TaskPicker.jsx';
import DimsForm from '../DimsForm.jsx';
import HseButton from '../HseSheet.jsx';
import Collapsible from './Collapsible.jsx';
import { TrashIcon } from '../EditControls.jsx';

/** The three waste presets (values live in tasks.js: Minimum is a real 5 %, never the 0 % floor of the model). */
const WASTE_PRESETS = [
  { id: 'min', value: PRESET_VALUES.min },
  { id: 'normal', value: PRESET_VALUES.normal },
  { id: 'critical', value: PRESET_VALUES.critical },
];

/** Pill of the waste group: a quiet translucent fill; the active one turns brand-tinted (the colour is the only signal, no box shadow). */
const wastePill = (active) => `relative flex min-h-[40px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm transition active:scale-95 active:opacity-70 before:absolute before:-inset-y-0.5 before:inset-x-0 before:content-[""] ${active ? 'bg-brand/20 font-normal text-brand' : 'bg-white/5 font-light text-neutral-400'}`;

/** The preset a stored waste belongs to: the exact one, or the nearest for legacy / per-task defaults (read only: nothing is rewritten until the user taps). */
const activePreset = (waste) => {
  if (!Number.isFinite(waste)) return null;
  return WASTE_PRESETS.reduce((best, x) => (Math.abs(x.value - waste) < Math.abs(best.value - waste) ? x : best)).id;
};

/**
 * ZONE B, the living list: one native <details>/<summary> per partida. Open it and the measures, the materials and
 * their prices are right there: tapping a price opens the on-screen numpad (the parent decides what that means, or
 * answers "Precios bloqueados" while the quote is frozen). Below the materials, "Maquinaria en uso" lists the machines of that task.
 * Nothing here owns data: it reads `groups` / `result` and calls back.
 */
export default function PartidaList({ draft, groups, open, locked, onBlocked, onToggle, onUpdate, onTask, onAdd, onRemove, onPrice, showErrors, result = null, setDraft = null, projectLocation = null }) {
  const { t, money, num, unit } = useI18n();
  const project = draft.mode === 'project';
  return (
    <section aria-label={t('ws.list')} data-testid="ws-zone-b" className="space-y-2">
      {groups.map((g, i) => {
        const p = draft.partidas[i];
        if (!p) return null;
        const isOpen = Boolean(open[p.id]);
        const waste = effectiveWaste(p.waste, p.task); // the figure the quote really uses: a missing / NaN waste is the task's default, never a silent 0
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

            <div className="space-y-4 border-t border-white/10 px-3 py-4">
              <LockedZone locked={locked} onBlocked={onBlocked} className="relative space-y-4">
                {project && (
                  <button
                    type="button"
                    onClick={() => onRemove(p.id)}
                    data-testid={`partida-remove-${i}`}
                    aria-label={t('part.delete')}
                    title={t('part.delete')}
                    className="absolute right-0 top-0 z-[1] flex h-11 w-11 items-center justify-center rounded-full text-neutral-500 transition active:scale-95 active:text-red-400/90"
                  >
                    <TrashIcon size={20} />
                  </button>
                )}
                <div className={project ? 'pr-12' : ''}>
                  <TextField label={t('part.name')} optional={t('common.optional')} placeholder={t('part.namePh')} maxLength={60} value={p.name} sanitize={(v) => sanitizeText(v, 60)} onChange={(name) => onUpdate(p.id, (x) => ({ ...x, name }))} />
                </div>
                <div>
                  <p id={`ws-type-${p.id}`} className="label">
                    {t('part.type')}
                  </p>
                  <TaskPicker value={p.task} onChange={(task) => onTask(p.id, task)} labelledBy={`ws-type-${p.id}`} />
                </div>
                <div>
                  <p className="label">{t('ws.measures')}</p>
                  <DimsForm partida={p} validation={g.validation} showErrors={showErrors} onChange={(patch) => onUpdate(p.id, (x) => ({ ...x, dims: { ...x.dims, ...patch } }))} />
                </div>
                <div data-testid={`waste-${i}`}>
                  <p className="label">
                    {t('fin.waste')}
                    <span data-testid={`waste-${i}-value`} className="ml-2 font-light tabular-nums text-neutral-400">
                      {waste}%
                    </span>
                  </p>
                  <div role="radiogroup" aria-label={t('fin.waste')} className="flex flex-row gap-2">
                    {WASTE_PRESETS.map(({ id, value }) => {
                      const active = activePreset(waste) === id;
                      return (
                        <button key={id} type="button" role="radio" aria-checked={active} onClick={() => onUpdate(p.id, (x) => ({ ...x, waste: value }))} data-testid={`waste-${i}-${id}`} data-value={value} className={wastePill(active)}>
                          {t(`fin.waste_${id}`)}
                          <span className="text-xs font-light tabular-nums opacity-70">{value}%</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </LockedZone>

              {/* progressive disclosure: the definition above (measures + waste) is one block; the logistics (materials, safety guide, machinery) is another, in its own container */}
              <div className="space-y-4 pt-2" data-testid={`logistics-${i}`}>
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
