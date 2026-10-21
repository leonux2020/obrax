import { useI18n } from '../../lib/i18n.jsx';
import { TASKS, TASK_IDS, defaultDims } from '../../lib/tasks.js';
import { sanitizeText } from '../../lib/sanitize.js';
import { TextField } from '../ui.jsx';

const ICONS = {
  slab: (
    <path d="M4 30 L24 20 L44 30 L24 40 Z M4 30 V35 L24 45 L44 35 V30 M24 40 V45" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
  ),
  masonry: (
    <path d="M5 10H43V38H5Z M5 19.3H43 M5 28.6H43 M18 10V19.3 M31 19.3V28.6 M18 28.6V38 M31 10V19.3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
  ),
  drywall: (
    <path d="M8 6H40V42H8Z M16 6V42 M24 6V42 M32 6V42" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
  ),
};

export default function StepTask({ draft, setDraft }) {
  const { t } = useI18n();

  const pick = (id) =>
    setDraft((d) => ({
      ...d,
      task: id,
      dims: defaultDims(id, d.dims),
      finance: { ...d.finance, waste: TASKS[id].defaultWaste },
      overrides: {},
    }));

  return (
    <section aria-labelledby="task-title" className="space-y-5">
      <h2 id="task-title" className="text-2xl font-bold">
        {t('task.title')}
      </h2>
      <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-labelledby="task-title">
        {TASK_IDS.map((id) => {
          const active = draft.task === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(id)}
              className={`flex items-center gap-4 rounded-2xl border-2 p-4 text-left transition md:flex-col md:items-start ${
                active ? 'border-brand bg-brand/10' : 'border-neutral-800 bg-neutral-950 hover:border-neutral-600'
              }`}
            >
              <span
                className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-xl ${
                  active ? 'bg-brand text-black' : 'bg-neutral-800 text-brand'
                }`}
              >
                <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
                  {ICONS[id]}
                </svg>
              </span>
              <span>
                <span className="block text-lg font-bold">{t(`task.${id}`)}</span>
                <span className="block text-sm text-neutral-300">{t(`task.${id}.desc`)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="card space-y-4">
        <h3 className="text-lg font-bold">{t('project.title')}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('project.name')}
            optional={t('common.optional')}
            placeholder={t('project.namePh')}
            value={draft.project.name}
            sanitize={(v) => sanitizeText(v, 80)}
            onChange={(name) => setDraft((d) => ({ ...d, project: { ...d.project, name } }))}
          />
          <TextField
            label={t('project.client')}
            optional={t('common.optional')}
            placeholder={t('project.clientPh')}
            value={draft.project.client}
            sanitize={(v) => sanitizeText(v, 80)}
            onChange={(client) => setDraft((d) => ({ ...d, project: { ...d.project, client } }))}
          />
        </div>
      </div>
    </section>
  );
}
