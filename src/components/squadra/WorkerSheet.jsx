import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { WORKER_SPECIALTIES, newEntryId } from '../../lib/ledger.js';
import { sanitizePhone, sanitizeTextInput } from '../../lib/sanitize.js';
import { BLOOD_TYPES, MAX_SPECIALTIES, SEXES } from '../../lib/workers.js';
import BottomSheet from '../BottomSheet.jsx';
import { Button, DateInput, TextField } from '../ui.jsx';
import { StarPicker } from './Stars.jsx';

const EMPTY = { name: '', specialties: [], rating: 0, phone: '', address: '', document: '', nationality: '', sex: '', birthDate: '', bloodType: '', limiting: '', allergies: '', emergencyName: '', emergencyPhone: '' };

const Block = ({ id, title, children, className = '', headingClass = 'text-neutral-200' }) => (
  <section data-testid={`worker-block-${id}`} aria-labelledby={`worker-block-${id}-title`} className={`space-y-4 rounded-2xl border px-4 py-4 ${className || 'border-white/10'}`}>
    <h3 id={`worker-block-${id}-title`} className={`text-base font-medium ${headingClass}`}>
      {title}
    </h3>
    {children}
  </section>
);

/**
 * The worker's file, in three "zero stress" blocks: (a) professional data, (b) personal data, (c) SAFETY AND HEALTH (limiting conditions,
 * allergies, emergency contact), the one that matters most, framed in a soft orange panel. `worker` null = a new one.
 */
export default function WorkerSheet({ worker, onSave, onDelete, onClose }) {
  const { t } = useI18n();
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(worker || {}) }));
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (key) => (value) => {
    setError('');
    setForm((f) => ({ ...f, [key]: value }));
  };
  const toggleSpecialty = (id) =>
    setForm((f) => ({ ...f, specialties: f.specialties.includes(id) ? f.specialties.filter((x) => x !== id) : [...f.specialties, id] }));
  const full = form.specialties.length >= MAX_SPECIALTIES;

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError(t('squadra.nameRequired'));
    onSave({ ...form, id: worker?.id || newEntryId() });
    return undefined;
  };

  return (
    <BottomSheet fullscreen title={worker ? worker.name : t('squadra.new')} subtitle={t('squadra.fileSubtitle')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-5" data-testid="worker-form" noValidate>
        {/* ---- a) professional data --------------------------------------------------------------------------------------- */}
        <Block id="pro" title={t('squadra.pro')}>
          <TextField label={t('squadra.name')} value={form.name} onChange={set('name')} testId="worker-name" maxLength={80} sanitize={(v) => sanitizeTextInput(v, 80)} />
          {error && (
            <p role="alert" data-testid="worker-error" className="-mt-2 text-sm font-medium text-orange-400">
              {error}
            </p>
          )}

          <div>
            <span className="label">{t('squadra.specialties')}</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('squadra.specialties')} data-testid="worker-specialties">
              {WORKER_SPECIALTIES.map((id) => {
                const on = form.specialties.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    disabled={!on && full}
                    onClick={() => toggleSpecialty(id)}
                    data-testid={`worker-spec-${id}`}
                    className={`min-h-[44px] rounded-full border px-4 text-sm transition disabled:opacity-40 ${on ? 'border-brand text-brand' : 'border-white/10 text-neutral-300'}`}
                  >
                    {t(`ws.spec.${id}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="label">{t('squadra.rating')}</span>
            <StarPicker value={form.rating} onChange={set('rating')} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label={t('squadra.phone')} value={form.phone} onChange={set('phone')} testId="worker-phone" type="tel" inputMode="tel" maxLength={32} sanitize={sanitizePhone} placeholder="+56 9 1234 5678" />
            <TextField label={t('squadra.address')} value={form.address} onChange={set('address')} testId="worker-address" maxLength={120} sanitize={(v) => sanitizeTextInput(v, 120)} />
          </div>
        </Block>

        {/* ---- b) personal data ------------------------------------------------------------------------------------------- */}
        <Block id="personal" title={t('squadra.personal')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label={t('squadra.document')} value={form.document} onChange={set('document')} testId="worker-document" maxLength={40} sanitize={(v) => sanitizeTextInput(v, 40)} />
            <TextField label={t('squadra.nationality')} value={form.nationality} onChange={set('nationality')} testId="worker-nationality" maxLength={40} sanitize={(v) => sanitizeTextInput(v, 40)} />
          </div>
          <div>
            <span className="label">{t('squadra.sex')}</span>
            <div role="radiogroup" aria-label={t('squadra.sex')} className="grid grid-cols-3 gap-2" data-testid="worker-sex">
              {SEXES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={form.sex === s}
                  onClick={() => set('sex')(form.sex === s ? '' : s)} // tapping the chosen one again clears it
                  data-testid={`worker-sex-${s}`}
                  className={`min-h-[48px] rounded-xl border px-3 text-sm transition ${form.sex === s ? 'border-brand text-brand' : 'border-white/10 text-neutral-300'}`}
                >
                  {t(`squadra.sex.${s}`)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="worker-birth">
              {t('squadra.birth')}
            </label>
            <DateInput id="worker-birth" value={form.birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set('birthDate')(e.target.value)} data-testid="worker-birth" />
          </div>
        </Block>

        {/* ---- c) SAFETY AND HEALTH: the block that must not be missed ----------------------------------------------------- */}
        <Block id="safety" title={t('squadra.safety')} className="border-orange-500/30 bg-orange-500/5" headingClass="text-orange-300">
          <p className="-mt-2 text-xs text-neutral-400">{t('squadra.safetyNote')}</p>
          <div>
            <span className="label">{t('squadra.blood')}</span>
            <div role="radiogroup" aria-label={t('squadra.blood')} className="grid grid-cols-4 gap-2" data-testid="worker-blood">
              <button
                type="button"
                role="radio"
                aria-checked={form.bloodType === ''}
                onClick={() => set('bloodType')('')}
                data-testid="worker-blood-none"
                className={`col-span-4 min-h-[44px] rounded-xl border px-3 text-sm transition ${form.bloodType === '' ? 'border-orange-500/60 text-orange-300' : 'border-white/10 text-neutral-400'}`}
              >
                {t('squadra.blood.none')}
              </button>
              {BLOOD_TYPES.map((b) => (
                <button
                  key={b}
                  type="button"
                  role="radio"
                  aria-checked={form.bloodType === b}
                  onClick={() => set('bloodType')(b)}
                  data-testid={`worker-blood-${b}`}
                  className={`min-h-[48px] rounded-xl border px-2 text-base font-medium tabular-nums transition ${form.bloodType === b ? 'border-red-500/60 text-red-400' : 'border-white/10 text-neutral-300'}`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="worker-limiting">
              {t('squadra.limiting')}
            </label>
            <textarea id="worker-limiting" value={form.limiting} onChange={(e) => set('limiting')(sanitizeTextInput(e.target.value, 300))} maxLength={300} rows={3} placeholder={t('squadra.limiting.ph')} data-testid="worker-limiting" className="field-input min-h-[88px] py-3" />
          </div>
          <div>
            <label className="label" htmlFor="worker-allergies">
              {t('squadra.allergies')}
            </label>
            <textarea id="worker-allergies" value={form.allergies} onChange={(e) => set('allergies')(sanitizeTextInput(e.target.value, 300))} maxLength={300} rows={3} placeholder={t('squadra.allergies.ph')} data-testid="worker-allergies" className="field-input min-h-[88px] py-3" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label={t('squadra.emName')} value={form.emergencyName} onChange={set('emergencyName')} testId="worker-em-name" maxLength={80} sanitize={(v) => sanitizeTextInput(v, 80)} />
            <TextField label={t('squadra.emPhone')} value={form.emergencyPhone} onChange={set('emergencyPhone')} testId="worker-em-phone" type="tel" inputMode="tel" maxLength={32} sanitize={sanitizePhone} placeholder="+56 9 1234 5678" />
          </div>
        </Block>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={onClose} data-testid="worker-cancel">
            {t('common.cancel')}
          </Button>
          <Button type="submit" data-testid="worker-save">
            {t('squadra.save')}
          </Button>
        </div>

        {worker && (
          <div className="border-t border-white/10 pt-4">
            {confirmDelete ? (
              <div className="grid grid-cols-2 gap-3">
                <Button variant="ghost" onClick={() => setConfirmDelete(false)} data-testid="worker-delete-cancel">
                  {t('common.cancel')}
                </Button>
                <button type="button" onClick={() => onDelete(worker.id)} data-testid="worker-delete-confirm" className="min-h-[52px] rounded-xl border border-red-500/40 bg-transparent px-3 text-sm font-semibold text-red-300 transition hover:bg-red-500/10 active:scale-[0.98]">
                  {t('squadra.deleteConfirm')}
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} data-testid="worker-delete" className="min-h-[44px] w-full rounded-xl border border-white/10 bg-transparent text-sm font-medium text-neutral-400 transition hover:text-neutral-200 active:scale-[0.98]">
                {t('squadra.delete')}
              </button>
            )}
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
