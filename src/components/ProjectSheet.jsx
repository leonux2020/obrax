import { useId, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { parseDay, toDayString } from '../lib/projects.js';
import { sanitizeText } from '../lib/sanitize.js';
import { Button, TextField } from './ui.jsx';
import BottomSheet from './BottomSheet.jsx';

function DateField({ label, value, onChange, invalid }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} className="field-input [color-scheme:dark]" />
    </div>
  );
}

/** Create / edit a project: name, client, start date and estimated end date (+ delete when editing). */
export default function ProjectSheet({ project, onSave, onDelete, onClose }) {
  const { t } = useI18n();
  const editing = Boolean(project);
  const [form, setForm] = useState(() => ({
    name: project?.draft.project.name ?? '',
    client: project?.draft.project.client ?? '',
    startDate: project ? project.startDate : toDayString(new Date()),
    endDate: project?.endDate ?? '',
  }));
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const start = parseDay(form.startDate);
  const end = parseDay(form.endDate);
  const badRange = Boolean(start && end && end < start);

  const submit = (e) => {
    e.preventDefault();
    if (badRange) return;
    onSave({
      name: form.name,
      client: form.client,
      startDate: start ? form.startDate : '',
      endDate: end ? form.endDate : '',
    });
  };

  return (
    <BottomSheet title={t(editing ? 'proj.edit.title' : 'proj.new.title')} onClose={onClose}>
      <form onSubmit={submit} className="mt-3 space-y-4">
        <TextField
          label={t('project.name')}
          placeholder={t('project.namePh')}
          value={form.name}
          sanitize={(v) => sanitizeText(v, 60)}
          onChange={set('name')}
        />
        <TextField
          label={t('project.client')}
          placeholder={t('project.clientPh')}
          value={form.client}
          sanitize={(v) => sanitizeText(v, 60)}
          onChange={set('client')}
        />
        <div className="grid grid-cols-2 gap-3">
          <DateField label={t('proj.start')} value={form.startDate} onChange={set('startDate')} />
          <DateField label={t('proj.end')} value={form.endDate} onChange={set('endDate')} invalid={badRange} />
        </div>
        {badRange && (
          <p role="alert" className="text-sm font-semibold text-red-400">
            {t('proj.endBeforeStart')}
          </p>
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
