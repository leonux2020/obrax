import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { TASKS, defaultDims } from '../../lib/tasks.js';
import { MAX_PARTIDAS, newPartida } from '../../lib/draft.js';
import { partidaTitle } from '../../lib/reports.js';
import { sanitizeText } from '../../lib/sanitize.js';
import { Badge, Button, TextField } from '../ui.jsx';
import TaskPicker, { TaskIcon } from '../TaskPicker.jsx';
import DimsForm from '../DimsForm.jsx';
import HseButton from '../HseSheet.jsx';

/** Project mode: list, add, edit and delete partidas. Shared materials are consolidated downstream. */
export default function StepPartidas({ draft, setDraft, result, showErrors }) {
  const { t, num, unit } = useI18n();
  const [editing, setEditing] = useState(() => draft.partidas.find((_, i) => !result.partidas[i]?.validation.valid)?.id ?? null);

  const update = (id, fn) =>
    // Fixed prices (typed by hand or read from an invoice) are NOT cleared by editing a partida: they belong to the
    // material, not to the dimensions, and the engine ignores the ones the quote does not use.
    setDraft((d) => ({ ...d, partidas: d.partidas.map((p) => (p.id === id ? fn(p) : p)) }));

  const add = () => {
    if (draft.partidas.length >= MAX_PARTIDAS) return;
    const p = newPartida('slab');
    setDraft((d) => ({ ...d, partidas: [...d.partidas, p] }));
    setEditing(p.id);
  };

  const remove = (id) => {
    if (!window.confirm(t('part.confirmDelete'))) return;
    setDraft((d) => ({ ...d, partidas: d.partidas.filter((p) => p.id !== id) }));
    if (editing === id) setEditing(null);
  };

  const changeTask = (id, task) =>
    update(id, (p) => ({ ...p, task, dims: defaultDims(task, p.dims), waste: TASKS[task].defaultWaste }));

  return (
    <section aria-labelledby="part-title" className="space-y-4">
      <div>
        <h2 id="part-title" className="text-2xl font-bold">
          {t('part.title')}
          {draft.project.name && <span className="text-brand"> · {draft.project.name}</span>}
        </h2>
        <p className="text-neutral-300">{t('part.hint')}</p>
      </div>

      {draft.partidas.length === 0 && (
        <p className="card text-center text-neutral-300">{t('part.empty')}</p>
      )}

      <ul className="space-y-3">
        {draft.partidas.map((p, i) => {
          const c = result.partidas[i];
          const open = editing === p.id;
          const incomplete = !c.validation.valid;
          const main = c.calc?.metrics?.[0];
          return (
            <li key={p.id} className={`card ${open ? 'border-brand' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black text-brand">
                  <TaskIcon id={p.task} size={30} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-bold">
                    {i + 1}. {partidaTitle(p, t)}
                  </p>
                  <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-300">
                    {t(`task.${p.task}`)}
                    {incomplete ? (
                      <Badge tone="white">{t('part.incomplete')}</Badge>
                    ) : (
                      main && (
                        <span>
                          · {num(main.value, 2)} {unit(main.unit)}
                        </span>
                      )
                    )}
                  </p>
                </div>
                <HseButton task={p.task} />
                <Button
                  variant={open ? 'primary' : 'secondary'}
                  className="!min-h-[44px] !px-3 text-sm"
                  aria-expanded={open}
                  onClick={() => setEditing(open ? null : p.id)}
                >
                  {open ? t('part.done') : t('part.edit')}
                </Button>
                <Button
                  variant="danger"
                  className="!min-h-[44px] !px-3 text-sm"
                  aria-label={`${t('part.delete')} ${partidaTitle(p, t)}`}
                  onClick={() => remove(p.id)}
                >
                  ✕
                </Button>
              </div>

              {open && (
                <div className="mt-4 space-y-4 border-t border-neutral-800 pt-4">
                  <TextField
                    label={t('part.name')}
                    optional={t('common.optional')}
                    placeholder={t('part.namePh')}
                    maxLength={60}
                    value={p.name}
                    sanitize={(v) => sanitizeText(v, 60)}
                    onChange={(name) => update(p.id, (x) => ({ ...x, name }))}
                  />
                  <div>
                    <p id={`type-${p.id}`} className="label">
                      {t('part.type')}
                    </p>
                    <TaskPicker compact value={p.task} onChange={(task) => changeTask(p.id, task)} labelledBy={`type-${p.id}`} />
                  </div>
                  <DimsForm
                    partida={p}
                    validation={c.validation}
                    showErrors={showErrors}
                    onChange={(patch) => update(p.id, (x) => ({ ...x, dims: { ...x.dims, ...patch } }))}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Button variant="secondary" className="w-full" disabled={draft.partidas.length >= MAX_PARTIDAS} onClick={add}>
        + {t('part.add')}
      </Button>
      {draft.partidas.length >= MAX_PARTIDAS && <p className="text-sm text-neutral-400">{t('part.max', { n: MAX_PARTIDAS })}</p>}
      {draft.partidas.length > 1 && <p className="text-sm text-brand">{t('part.consolidated')}</p>}
    </section>
  );
}
