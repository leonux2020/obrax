import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { WORKER_LIMIT, hasHealthNotes, isBirthdayToday, loadWorkers, onWorkersChanged, removeWorker, upsertWorker } from '../../lib/workers.js';
import BottomSheet from '../BottomSheet.jsx';
import { EditToggle, RowDelete } from '../EditControls.jsx';
import { Button } from '../ui.jsx';
import BirthdayMark from './BirthdayMark.jsx';
import Nick from './Nick.jsx';
import { Stars } from './Stars.jsx';
import WorkerSheet from './WorkerSheet.jsx';

const MAX_CHIPS = 3;

/** One row of the directory: full name, rating (stars), specialty chips and a quiet orange mark when the file carries health notes. */
function Row({ worker, onOpen, editing, onDelete }) {
  const { t } = useI18n();
  const shown = worker.specialties.slice(0, MAX_CHIPS);
  const rest = worker.specialties.length - shown.length;
  return (
    <li className="flex items-center gap-1">
      {editing && <RowDelete name={worker.name} testId={`worker-del-${worker.id}`} onConfirm={() => onDelete(worker.id)} />}
      <button type="button" onClick={() => onOpen(worker)} data-testid={`worker-${worker.id}`} className="block min-h-[64px] min-w-0 flex-1 rounded-xl border border-white/10 px-4 py-3 text-left transition active:border-white/40">
        <span className="flex items-center gap-2">
          <span data-testid="worker-row-name" className="min-w-0 flex-1 truncate text-base font-medium text-neutral-200">
            {worker.name}
            <Nick apodo={worker.apodo} testId="worker-row-apodo" />
          </span>
          {isBirthdayToday(worker.birthDate) && <BirthdayMark />}
          {hasHealthNotes(worker) && (
            <span role="img" aria-label={t('squadra.healthFlag')} data-testid="worker-health-flag" className="shrink-0 text-sm text-orange-400">
              ⚠
            </span>
          )}
        </span>
        <span className="mt-1.5 flex items-center gap-2">
          <Stars value={worker.rating} />
        </span>
        {worker.specialties.length > 0 && (
          <span className="mt-2 flex flex-wrap gap-1.5" data-testid="worker-chips">
            {shown.map((s) => (
              <span key={s} data-testid="worker-chip" className="rounded-full px-2 py-0.5 text-xs bg-neutral-800 text-neutral-300">
                {t(`ws.spec.${s}`)}
              </span>
            ))}
            {rest > 0 && (
              <span data-testid="worker-chip-more" className="rounded-full px-2 py-0.5 text-xs bg-neutral-800 text-neutral-300">
                +{rest}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * "Squadra / Maestranze": the global directory of workers (opened from Ajustes, full screen above everything). A list of rows
 * (name, stars, specialty chips); tapping a row, or "Nuevo trabajador", opens the worker's file (WorkerSheet).
 */
export default function SquadraSheet({ projects = [], onClose, search = null, searchDelay }) {
  const { t } = useI18n();
  const [workers, setWorkers] = useState(() => loadWorkers());
  useEffect(() => onWorkersChanged(() => setWorkers(loadWorkers())), []); // a pull from Drive (another device) refreshes the open list
  const [editing, setEditing] = useState(null); // null | { worker: object | null }
  const [editMode, setEditMode] = useState(false); // the pencil of the header: only then do the delete icons exist
  const full = workers.length >= WORKER_LIMIT;
  useEffect(() => {
    if (editMode && workers.length === 0) setEditMode(false);
  }, [editMode, workers.length]);

  const save = (data) => {
    const r = upsertWorker(data);
    if (r.worker) setWorkers(r.list);
    setEditing(null);
  };
  const remove = (id) => {
    setWorkers(removeWorker(id));
    setEditing(null);
  };

  return (
    <>
      <BottomSheet
        fullscreen
        autoFocus={false}
        title={t('squadra.title')}
        subtitle={t('squadra.subtitle')}
        onClose={onClose}
        headerAction={<EditToggle active={editMode} onToggle={() => setEditMode((v) => !v)} disabled={workers.length === 0} label={t('crew.edit.on')} doneLabel={t('crew.edit.done')} testId="squadra-edit-toggle" />}
      >
        <div className="space-y-4" data-testid="squadra">
          {workers.length === 0 ? (
            <p className="rounded-xl border border-white/10 px-4 py-6 text-center text-sm text-neutral-400" data-testid="squadra-empty">
              {t('squadra.empty')}
            </p>
          ) : (
            <ul className="space-y-2" data-testid="squadra-list">
              {workers.map((w) => (
                <Row key={w.id} worker={w} editing={editMode} onDelete={(id) => setWorkers(removeWorker(id))} onOpen={(worker) => setEditing({ worker })} />
              ))}
            </ul>
          )}
          {!full && (
            <Button className="w-full" onClick={() => setEditing({ worker: null })} data-testid="squadra-new">
              {t('squadra.new')}
            </Button>
          )}
        </div>
      </BottomSheet>
      {editing && <WorkerSheet worker={editing.worker} projects={projects} onSave={save} onDelete={remove} onClose={() => setEditing(null)} search={search} {...(searchDelay !== undefined ? { searchDelay } : {})} />}
    </>
  );
}
