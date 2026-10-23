import { useId, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { currentPosition } from '../lib/geo.js';
import { locationLabel, normalizeLocation } from '../lib/ledger.js';
import { isClosed, parseDay, toDayString } from '../lib/projects.js';
import { sanitizeText } from '../lib/sanitize.js';
import { Button, DateInput, Switch, TextField } from './ui.jsx';
import BottomSheet from './BottomSheet.jsx';

function DateField({ label, value, onChange, invalid }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <DateInput id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} />
    </div>
  );
}

const SectionTitle = ({ children }) => <h3 className="pt-2 text-xs font-bold uppercase tracking-wider text-neutral-400">{children}</h3>;

const ModeIcon = ({ mode }) => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {mode === 'quick' ? (
      <rect x="6" y="6" width="12" height="12" rx="2" />
    ) : (
      <>
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" />
      </>
    )}
  </svg>
);

/**
 * New job: the agile form (name, client, Partida Única / Proyecto Completo, dates, "ubicación actual"), no money.
 * Edit job (the pencil inside the project): the same fields + finished / frozen switches + delete.
 */
export default function ProjectSheet({ project, onSave, onDelete, onClose, locate = currentPosition }) {
  const { t } = useI18n();
  const editing = Boolean(project);
  const [form, setForm] = useState(() => ({
    name: project?.draft.project.name ?? '',
    client: project?.draft.project.client ?? '',
    mode: project?.draft.mode ?? 'quick',
    startDate: project ? project.startDate : toDayString(new Date()),
    endDate: project?.endDate ?? '',
    location: project?.location ?? null,
    closed: project ? isClosed(project) : false,
    unfreeze: false,
  }));
  const [geo, setGeo] = useState('idle'); // idle | asking | unsupported | denied | unavailable | timeout
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const start = parseDay(form.startDate);
  const end = parseDay(form.endDate);
  const badRange = Boolean(start && end && end < start);

  const useHere = async () => {
    if (geo === 'asking') return;
    setGeo('asking');
    try {
      const pos = await locate();
      const location = normalizeLocation(pos);
      if (!location) throw Object.assign(new Error('geo'), { code: 'unavailable' });
      setForm((f) => ({ ...f, location }));
      setGeo('idle');
    } catch (err) {
      setGeo(['unsupported', 'denied', 'unavailable', 'timeout'].includes(err?.code) ? err.code : 'unavailable');
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (badRange) return;
    onSave({
      name: form.name,
      client: form.client,
      mode: form.mode,
      startDate: start ? form.startDate : '',
      endDate: end ? form.endDate : '',
      location: form.location,
      closed: form.closed,
      unfreeze: form.unfreeze,
    });
  };

  return (
    <BottomSheet fullscreen={editing} title={t(editing ? 'proj.edit.title' : 'proj.new.title')} onClose={onClose}>
      <form onSubmit={submit} className={`mt-3 space-y-4 ${editing ? 'mx-auto max-w-lg pb-6' : ''}`} data-testid={editing ? 'edit-form' : 'new-form'}>
        {editing && <SectionTitle>{t('edit.sectionBasics')}</SectionTitle>}
        <TextField label={t('project.name')} placeholder={t('project.namePh')} value={form.name} sanitize={(v) => sanitizeText(v, 60)} onChange={set('name')} />
        <TextField label={t('project.client')} placeholder={t('project.clientPh')} value={form.client} sanitize={(v) => sanitizeText(v, 60)} onChange={set('client')} />

        {!editing && (
          <div role="radiogroup" aria-label={t('newp.type')} className="grid grid-cols-2 gap-3" data-testid="mode-selector">
            {[
              ['quick', 'newp.single'],
              ['project', 'newp.full'],
            ].map(([m, key]) => {
              const on = form.mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-testid={`mode-${m}`}
                  onClick={() => set('mode')(m)}
                  className={`flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl border-2 px-2 text-center transition ${
                    on ? 'border-brand bg-brand/10 text-brand' : 'border-white/10 text-neutral-300 hover:border-white/30'
                  }`}
                >
                  <ModeIcon mode={m} />
                  <span className="text-sm font-bold leading-tight">{t(key)}</span>
                </button>
              );
            })}
          </div>
        )}

        {editing && <SectionTitle>{t('edit.sectionDates')}</SectionTitle>}
        <div className="grid grid-cols-2 gap-3">
          <DateField label={t('proj.start')} value={form.startDate} onChange={set('startDate')} />
          <DateField label={t('proj.end')} value={form.endDate} onChange={set('endDate')} invalid={badRange} />
        </div>
        {badRange && (
          <p role="alert" className="text-sm font-semibold text-red-400">
            {t('proj.endBeforeStart')}
          </p>
        )}

        <div>
          {editing && <SectionTitle>{t('loc.title')}</SectionTitle>}
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="flex-1 !min-h-[52px]" onClick={useHere} disabled={geo === 'asking'} data-testid="project-locate">
              <span aria-hidden="true">📍</span> {geo === 'asking' ? t('newp.locating') : form.location ? t('newp.located') : t('newp.locate')}
            </Button>
            {form.location && (
              <button
                type="button"
                onClick={() => set('location')(null)}
                aria-label={t('newp.locate.clear')}
                data-testid="project-locate-clear"
                className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border border-white/10 text-xl hover:border-red-500"
              >
                ×
              </button>
            )}
          </div>
          {form.location && (
            <p className="mt-1.5 break-words text-sm text-neutral-300" data-testid="project-location">
              {locationLabel(form.location)}
            </p>
          )}
          {['unsupported', 'denied', 'unavailable', 'timeout'].includes(geo) && (
            <p role="alert" data-testid="project-locate-error" className="mt-1.5 text-sm font-semibold text-red-400">
              {t(`newp.geo.${geo}`)}
            </p>
          )}
        </div>

        {editing && (
          <>
            <SectionTitle>{t('edit.sectionState')}</SectionTitle>
            <Switch checked={form.closed} onChange={set('closed')} label={t('proj.closeSwitch')} description={t('proj.closeSwitch.desc')} data-testid="project-closed" />
            {project.draft.frozen && (
              <Switch checked={form.unfreeze} onChange={set('unfreeze')} label={t('proj.unfreeze')} description={t('proj.unfreeze.desc')} data-testid="project-unfreeze" />
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-3 pt-1">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={badRange} data-testid="project-save">
            {t(editing ? 'proj.save' : 'proj.create')}
          </Button>
        </div>
        {editing && (
          <Button
            variant="danger"
            className="w-full !min-h-[44px] text-sm"
            onClick={() => {
              if (window.confirm(t('proj.delete.confirm'))) onDelete();
            }}
          >
            {t('proj.delete')}
          </Button>
        )}
      </form>
    </BottomSheet>
  );
}
