import { useI18n } from '../../lib/i18n.jsx';
import { TASKS, defaultDims } from '../../lib/tasks.js';
import { sanitizeText } from '../../lib/sanitize.js';
import { newPartida } from '../../lib/draft.js';
import { Segmented, TextField } from '../ui.jsx';
import TaskPicker from '../TaskPicker.jsx';
import PhotoGallery from '../PhotoGallery.jsx';

/** Step 0: choose the working mode, then the task (quick) or the project identity (accumulated). */
export default function StepStart({ draft, setDraft, photos, setPhotos, projectId }) {
  const { t } = useI18n();

  const setMode = (mode) =>
    setDraft((d) => {
      if (d.mode === mode) return d;
      const partidas = mode === 'quick' ? (d.partidas.length ? d.partidas.slice(0, 1) : [newPartida('slab')]) : d.partidas;
      return { ...d, mode, partidas, overrides: {} };
    });

  const pickTask = (task) =>
    setDraft((d) => {
      const cur = d.partidas[0] ?? newPartida(task);
      const next = { ...cur, task, dims: defaultDims(task, cur.dims), waste: TASKS[task].defaultWaste };
      return { ...d, partidas: [next], overrides: {} };
    });

  const setProject = (key) => (v) => setDraft((d) => ({ ...d, project: { ...d.project, [key]: v } }));

  return (
    <section aria-labelledby="start-title" className="space-y-5">
      <h2 id="start-title" className="text-2xl font-bold">
        {t('mode.title')}
      </h2>

      <div role="radiogroup" aria-labelledby="start-title" className="grid gap-3 sm:grid-cols-2">
        {['quick', 'project'].map((m) => {
          const active = draft.mode === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setMode(m)}
              className={`rounded-2xl border-2 p-4 text-left transition ${
                active ? 'border-brand bg-brand/10' : 'border-white/10 bg-black hover:border-white/30'
              }`}
            >
              <span className="block text-lg font-bold">{t(`mode.${m}`)}</span>
              <span className="block text-sm text-neutral-300">{t(`mode.${m}.desc`)}</span>
            </button>
          );
        })}
      </div>

      {draft.mode === 'quick' ? (
        <>
          <h3 id="task-title" className="text-xl font-bold">
            {t('task.title')}
          </h3>
          <TaskPicker value={draft.partidas[0]?.task} onChange={pickTask} labelledBy="task-title" />
        </>
      ) : (
        <p className="text-neutral-300">{t('mode.projectHint')}</p>
      )}

      <div className="card space-y-4">
        <h3 className="text-lg font-bold">{t('project.title')}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('project.name')}
            optional={draft.mode === 'quick' ? t('common.optional') : undefined}
            placeholder={draft.mode === 'project' ? t('project.namePhProject') : t('project.namePh')}
            value={draft.project.name}
            sanitize={(v) => sanitizeText(v, 80)}
            onChange={setProject('name')}
          />
          <TextField
            label={t('project.client')}
            optional={t('common.optional')}
            placeholder={t('project.clientPh')}
            value={draft.project.client}
            sanitize={(v) => sanitizeText(v, 80)}
            onChange={setProject('client')}
          />
        </div>
      </div>

      <PhotoGallery photos={photos} setPhotos={setPhotos} projectId={projectId} />
    </section>
  );
}
