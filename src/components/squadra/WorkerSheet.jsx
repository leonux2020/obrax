import { useId, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { WORKER_SPECIALTIES, newEntryId } from '../../lib/ledger.js';
import { sanitizePhone, sanitizeTextInput } from '../../lib/sanitize.js';
import { REGIONS } from '../../lib/regions.js';
import { searchPlaces } from '../../lib/forwardGeocode.js';
import { SEARCH_DEBOUNCE_MS, useCitySearch } from '../../lib/useCitySearch.js';
import { toCoord } from '../../lib/geoDistance.js';
import { BLOOD_TYPES, MAX_SPECIALTIES, SEXES, normalizeWorker } from '../../lib/workers.js';
import BottomSheet from '../BottomSheet.jsx';
import { Button, DateInput, TextField } from '../ui.jsx';
import { EditToggle } from '../EditControls.jsx';
import WorkerCard, { IdentityName } from './WorkerCard.jsx';
import { StarPicker } from './Stars.jsx';
import WorkerLedger from './WorkerLedger.jsx';

const EMPTY = { name: '', apodo: '', specialties: [], rating: 0, phone: '', email: '', city: '', lat: null, lon: null, address: '', document: '', nationality: '', sex: '', birthDate: '', bloodType: '', limiting: '', allergies: '', emergencyName: '', emergencyPhone: '' };

/** The form state of a file: the empty form with every value the file really has (an old record's missing / null fields never overwrite a default). */
const formOf = (w) => {
  const f = { ...EMPTY };
  for (const [k, v] of Object.entries(w || {})) if (v !== undefined && v !== null) f[k] = v;
  if (!Array.isArray(f.specialties)) f.specialties = [];
  return f;
};

const Block = ({ id, title, children, className = '', headingClass = 'text-neutral-200' }) => (
  <section data-testid={`worker-block-${id}`} aria-labelledby={`worker-block-${id}-title`} className={`space-y-4 rounded-2xl border px-4 py-4 ${className || 'border-white/10'}`}>
    <h3 id={`worker-block-${id}-title`} className={`text-base font-medium ${headingClass}`}>
      {title}
    </h3>
    {children}
  </section>
);

/**
 * READ / EDIT state machine: an existing worker opens as a clean READ-ONLY card (WorkerCard: no inputs, no boxes, no lines) with a discreet pencil
 * in the header; the pencil reveals the form below. Cancelling goes back to the card with the data exactly as stored. A NEW worker opens straight in
 * edit mode (there is nothing to read yet).
 *
 * The worker's file, in three "zero stress" blocks: (a) professional data, (b) personal data, (c) SAFETY AND HEALTH (limiting conditions,
 * allergies, emergency contact), the one that matters most, framed in a soft orange panel. `worker` null = a new one.
 */
export default function WorkerSheet({ worker, projects = [], onSave, onDelete, onClose, search = null, searchDelay = SEARCH_DEBOUNCE_MS }) {
  const { t, lang } = useI18n();
  const [current, setCurrent] = useState(worker); // the file as stored: what the card shows and what a cancelled edit goes back to (it follows every save)
  const [form, setForm] = useState(() => formOf(worker));
  const [error, setError] = useState('');
  const [isEditing, setIsEditing] = useState(!worker); // existing -> read; new -> edit
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (key) => (value) => {
    setError('');
    setForm((f) => ({ ...f, [key]: value }));
  };
  const toggleSpecialty = (id) =>
    setForm((f) => ({ ...f, specialties: f.specialties.includes(id) ? f.specialties.filter((x) => x !== id) : [...f.specialties, id] }));
  const full = form.specialties.length >= MAX_SPECIALTIES;

  // CITY AUTOCOMPLETE: the same Nominatim search as the job's city field (debounced, silent offline; off in the test build unless one is injected).
  // Only what is TYPED is searched; picking a match writes the town AND saves its coordinates quietly (lat / lon), which is what the crew picker
  // measures the real distance to a job with. Typing the town by hand again drops the old point: it would describe another place.
  const finder = search ?? (import.meta.env.MODE === 'test' ? null : searchPlaces);
  const [typed, setTyped] = useState('');
  const [active, setActive] = useState(-1);
  const places = useCitySearch(typed, { search: finder, lang, delay: searchDelay });
  const listId = useId();
  const choose = (place) => {
    setError('');
    setForm((f) => ({ ...f, city: sanitizeTextInput(place.name, 60), lat: toCoord(place.lat), lon: toCoord(place.lng ?? place.lon) }));
    setTyped('');
    setActive(-1);
  };
  const onCityKey = (e) => {
    if (!places.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % places.length : (i <= 0 ? places.length : i) - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(places[active]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setTyped('');
    }
  };

  // cancel an edit of an existing file: everything typed is discarded and the card shows the stored data again
  const cancelEdit = () => {
    setForm(formOf(current));
    setError('');
    setTyped('');
    setActive(-1);
    setConfirmDelete(false);
    setIsEditing(false);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError(t('squadra.nameRequired'));
    const payload = { ...form, id: worker?.id || newEntryId() };
    const saved = onSave(payload);
    if (worker) {
      // an EXISTING file: the sheet stays open and goes back from edit to the refreshed read-only card (a NEW one is closed by the parent after saving)
      const next = saved && typeof saved === 'object' ? saved : normalizeWorker(payload) || payload;
      setCurrent(next);
      setForm(formOf(next));
      setError('');
      setTyped('');
      setActive(-1);
      setConfirmDelete(false);
      setIsEditing(false);
    }
    return undefined;
  };

  if (worker && !isEditing) {
    return (
      <BottomSheet
        fullscreen
        title={<IdentityName worker={current} />}
        onClose={onClose}
        autoFocus={false}
        headerAction={<EditToggle active={false} onToggle={() => setIsEditing(true)} label={t('squadra.edit')} doneLabel={t('squadra.edit')} testId="worker-edit" />}
      >
        <WorkerCard worker={current} projects={projects} />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet fullscreen title={worker ? current.name : t('squadra.new')} subtitle={t('squadra.fileSubtitle')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-5" data-testid="worker-form" noValidate>
        {/* ---- a) professional data --------------------------------------------------------------------------------------- */}
        <Block id="pro" title={t('squadra.pro')}>
          <TextField label={t('squadra.name')} value={form.name} onChange={set('name')} testId="worker-name" maxLength={80} sanitize={(v) => sanitizeTextInput(v, 80)} />
          <TextField label={t('squadra.apodo')} optional={t('common.optional')} value={form.apodo} onChange={set('apodo')} testId="worker-apodo" maxLength={40} sanitize={(v) => sanitizeTextInput(v, 40)} />
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
            <TextField label={t('squadra.email')} optional={t('common.optional')} value={form.email} onChange={set('email')} testId="worker-email" type="email" inputMode="email" maxLength={80} sanitize={(v) => sanitizeTextInput(v, 80)} />
          </div>
          {/* the Radar compares THIS field with the job's city: strongly recommended, never blocking */}
          <div data-testid="worker-city-box" data-located={Number.isFinite(toCoord(form.lat)) && Number.isFinite(toCoord(form.lon)) ? 'true' : 'false'}>
            <TextField
              label={t('squadra.city')}
              value={form.city}
              onChange={(v) => {
                setError('');
                setForm((f) => ({ ...f, city: v, lat: null, lon: null }));
                setTyped(v);
                setActive(-1);
              }}
              testId="worker-city"
              maxLength={60}
              sanitize={(v) => sanitizeTextInput(v, 60)}
              placeholder={t('squadra.city.ph')}
              inputProps={{
                role: 'combobox',
                'aria-autocomplete': 'list',
                'aria-expanded': places.length > 0,
                'aria-controls': listId,
                'aria-activedescendant': active >= 0 ? `${listId}-${active}` : undefined,
                onKeyDown: onCityKey,
              }}
            />
            {places.length > 0 && (
              <ul id={listId} role="listbox" aria-label={t('squadra.city')} data-testid="worker-city-results" className="mt-1.5 overflow-hidden rounded-xl bg-white/5 py-1">
                {places.map((pl, i) => (
                  <li key={pl.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      onClick={() => choose(pl)}
                      data-testid={`worker-city-option-${i}`}
                      className={`flex min-h-[44px] w-full items-center gap-3 px-4 text-left text-sm text-neutral-200 transition active:bg-white/10 ${i === active ? 'bg-white/10' : ''}`}
                    >
                      <span aria-hidden="true" className="w-6 shrink-0 text-base">
                        {REGIONS[pl.countryCode]?.flag || ''}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{pl.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!form.city.trim() && (
              <p data-testid="worker-city-hint" className="mt-1.5 text-xs text-orange-400">
                {t('squadra.city.hint')}
              </p>
            )}
          </div>
          <TextField label={t('squadra.address')} value={form.address} onChange={set('address')} testId="worker-address" maxLength={120} sanitize={(v) => sanitizeTextInput(v, 120)} placeholder={t('squadra.address.ph')} />
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

        {/* d) the global ledger of an existing person: what they were paid in every project (read only) */}
        {worker && <WorkerLedger workerId={worker.id} projects={projects} />}

        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={worker ? cancelEdit : onClose} data-testid="worker-cancel">
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
