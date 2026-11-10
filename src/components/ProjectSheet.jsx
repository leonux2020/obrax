import { useId, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { currentPosition, detectCurrentRegion } from '../lib/geo.js';
import { reverseCity } from '../lib/reverseGeocode.js';
import { searchPlaces } from '../lib/forwardGeocode.js';
import { SEARCH_DEBOUNCE_MS, useCitySearch } from '../lib/useCitySearch.js';
import { REGIONS } from '../lib/regions.js';
import { marketChangeImpact, quoteLock } from '../lib/workspaceModel.js';
import { hasPhaseDates } from '../lib/phases.js';
import { normalizeLocation } from '../lib/ledger.js';
import { BUDGET_MODELS, WORK_TYPES, cleanCityOrRegion, cleanWorkType, isClosed, modeForBudget, parseDay, toDayString } from '../lib/projects.js';
import { sanitizeText } from '../lib/sanitize.js';
import { Button, DateInput, Switch, TextField } from './ui.jsx';
import BottomSheet from './BottomSheet.jsx';
import { useConfirm } from './ConfirmSheet.jsx';
import RegionCombobox from './RegionCombobox.jsx';
import { Outline } from './workspace/icons.jsx';

function DateField({ label, value, onChange, invalid }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label tabular-nums">
        {label}
      </label>
      <DateInput underline id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} />
    </div>
  );
}

const SectionTitle = ({ children }) => <h3 className="pt-4 text-xs font-light uppercase text-neutral-400">{children}</h3>;

/** Target / GPS crosshair of the city field: it pulses while the place is being looked up. */
const TargetIcon = ({ busy }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-outline-icon="true" data-icon="target" className={busy ? 'animate-pulse' : undefined}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);

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
 * New job: the agile form (name, client, Partida Única / Proyecto Completo, dates, city with its GPS target), no money.
 * Edit job (the pencil inside the project): the same fields + finished / frozen switches + delete.
 * `draftMode`: the pencil of a DRAFT (a job not stored yet): the edit layout, but the budget model is still choosable and there is nothing to close or delete.
 */
export default function ProjectSheet({ project, draftMode = false, onSave, onDelete, onClose, locate = currentPosition, detectRegion = detectCurrentRegion, defaultRegion = null, reverse = reverseCity, search = null, searchDelay = SEARCH_DEBOUNCE_MS }) {
  const { t, lang } = useI18n();
  const [ask, confirmNode] = useConfirm();
  const editing = Boolean(project);
  const [form, setForm] = useState(() => ({
    name: project?.draft.project.name ?? '',
    client: project?.draft.project.client ?? '',
    mode: project?.draft.mode ?? 'quick',
    budgetModel: project?.budgetModel ?? '', // chosen first; a new job may also be created without choosing (it then behaves as it always did)
    workType: cleanWorkType(project?.workType),
    startDate: project ? project.startDate : toDayString(new Date()),
    endDate: project?.endDate ?? '',
    location: project?.location ?? null,
    cityOrRegion: project?.cityOrRegion ?? '',
    // market of a NEW job: where the device is right now (time zone / language), only then the stored default
    regionCode: project ? project.draft.regionCode : [detectRegion(), defaultRegion].find((c) => REGIONS[c]) ?? null,
    closed: project ? isClosed(project) : false,
    unfreeze: false,
  }));
  const [cityGeo, setCityGeo] = useState('idle'); // idle | asking | unsupported | denied | unavailable | timeout | offline | notfound | failed
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  // CITY AUTOCOMPLETE (Nominatim forward geocoding, debounced). Only what the user TYPES is searched (`typed`): choosing a match clears it, so the list closes
  // and the chosen name is never searched again. Off in the test build unless a `search` is injected (no real network from the suite).
  const finder = search ?? (import.meta.env.MODE === 'test' ? null : searchPlaces);
  const [typed, setTyped] = useState('');
  const [active, setActive] = useState(-1);
  const places = useCitySearch(typed, { search: finder, lang, delay: searchDelay });
  const listId = useId();

  const marketLocked = editing && Boolean(quoteLock(project.draft)); // a signed / frozen quote keeps its market
  const marketChanged = editing && Boolean(form.regionCode) && form.regionCode !== project.draft.regionCode;
  // the note about the currency exists ONLY when the change really touches something: a new job or an empty project has nothing to lose
  const marketNote = marketChanged && marketChangeImpact(project).affected;
  const start = parseDay(form.startDate);
  const end = parseDay(form.endDate);
  const badRange = Boolean(start && end && end < start);
  const phased = editing && hasPhaseDates(project.phases);

  // The target button of the city field (the ONLY GPS control of the form): GPS fix -> Nominatim -> city name + saved coordinates. Silent: the icon pulses, no modal.
  const findCity = async () => {
    if (cityGeo === 'asking') return;
    setCityGeo('asking');
    try {
      const pos = await locate();
      const point = normalizeLocation(pos);
      if (!point) throw Object.assign(new Error('geo'), { code: 'unavailable' });
      const city = cleanCityOrRegion(await reverse({ lat: point.lat, lng: point.lng }, { lang }));
      // ONE tap, both jobs: the name of the place goes into the field AND the point is saved in the project (the weather, the supplier
      // radius and the "how to get there" link read it). The label of the point is the city, so the card can show it too.
      setForm((f) => ({ ...f, cityOrRegion: city, location: { ...point, label: city } }));
      setTyped('');
      setCityGeo('idle');
    } catch (err) {
      setCityGeo(['unsupported', 'denied', 'unavailable', 'timeout', 'offline', 'notfound', 'failed'].includes(err?.code) ? err.code : 'failed');
    }
  };

  // Picking a match does three things at once: the city name goes into the field, the country / market follows the ISO code of the answer (whatever
  // the language of the interface; a market with a signed quote stays, and a country the app has no market for is left alone) and the point is
  // saved quietly in the project (the weather, the supplier radius and the "how to get there" link read it).
  const choose = (place) => {
    const point = normalizeLocation({ lat: place.lat, lng: place.lng, label: place.name });
    const city = cleanCityOrRegion(place.name);
    setForm((f) => ({
      ...f,
      cityOrRegion: city,
      location: point,
      ...(!marketLocked && REGIONS[place.countryCode] ? { regionCode: place.countryCode } : {}),
    }));
    setTyped('');
    setActive(-1);
    setCityGeo('idle');
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
      e.preventDefault();
      e.stopPropagation(); // closes the list, not the sheet
      setTyped('');
      setActive(-1);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (badRange) return;
    onSave({
      name: form.name,
      client: form.client,
      mode: form.mode,
      budgetModel: form.budgetModel,
      workType: form.workType,
      startDate: start ? form.startDate : '',
      endDate: end ? form.endDate : '',
      location: form.location,
      cityOrRegion: cleanCityOrRegion(form.cityOrRegion),
      ...(form.regionCode ? { regionCode: form.regionCode } : {}),
      closed: form.closed,
      unfreeze: form.unfreeze,
    });
  };

  return (
    <BottomSheet fullscreen={editing} title={t(editing ? 'proj.edit.title' : 'proj.new.title')} onClose={onClose}>
      <form onSubmit={submit} className={`mt-4 space-y-8 ${editing ? 'mx-auto max-w-lg pb-8' : ''}`} data-testid={editing ? 'edit-form' : 'new-form'}>
        {editing && <SectionTitle>{t('edit.sectionBasics')}</SectionTitle>}
        <TextField underline label={t('project.name')} placeholder={t('project.namePh')} value={form.name} sanitize={(v) => sanitizeText(v, 60)} onChange={set('name')} />
        <TextField underline label={t('project.client')} placeholder={t('project.clientPh')} value={form.client} sanitize={(v) => sanitizeText(v, 60)} onChange={set('client')} />

        {/* 1. the budget model comes FIRST: how the job is sold decides everything below (turnkey = one global value, detailed = partida by partida) */}
        {(!editing || draftMode) && (
          <div data-testid="budget-model-block">
            <p className="label">{t('newp.budget')}</p>
            <div role="radiogroup" aria-label={t('newp.budget')} className="grid grid-cols-2 gap-4" data-testid="budget-model">
              {BUDGET_MODELS.map((m) => {
                const on = form.budgetModel === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-testid={`budget-${m}`}
                    onClick={() => setForm((f) => ({ ...f, budgetModel: m, mode: modeForBudget(m, f.mode) }))}
                    className={`flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-2xl px-3 py-3 text-center transition active:scale-95 active:opacity-70 ${on ? 'bg-brand/15 text-brand' : 'bg-white/5 text-neutral-300'}`}
                  >
                    <ModeIcon mode={m === 'turnkey' ? 'quick' : 'project'} />
                    <span className="text-sm font-medium leading-tight">{t(`newp.budget.${m}`)}</span>
                    <span className={`text-xs font-light leading-snug ${on ? 'text-brand/80' : 'text-neutral-400'}`}>{t(`newp.budget.${m}.sub`)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {editing && !draftMode && project.budgetModel && (
          <p className="text-sm font-light text-neutral-400" data-testid="budget-model-readonly">
            {t('newp.budget')}: {t(`newp.budget.${project.budgetModel}`)}
          </p>
        )}

        {/* 2. progressive disclosure: the type of work only appears once the model is chosen (a job being edited always shows it) */}
        {(editing || form.budgetModel) && (
          <div data-testid="work-type-block">
            {editing ? <SectionTitle>{t('newp.worktype')}</SectionTitle> : <p className="label">{t('newp.worktype')}</p>}
            <div role="radiogroup" aria-label={t('newp.worktype')} className="mt-2 grid grid-cols-2 gap-3" data-testid="work-type">
              {WORK_TYPES.map((w, i) => {
                const on = form.workType === w;
                return (
                  <button
                    key={w}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-testid={`worktype-${w}`}
                    onClick={() => setForm((f) => ({ ...f, workType: f.workType === w ? '' : w }))}
                    className={`flex min-h-[56px] items-center justify-center rounded-2xl px-3 py-2 text-center text-sm leading-tight transition active:scale-95 active:opacity-70 ${i === WORK_TYPES.length - 1 ? 'col-span-2' : ''} ${on ? 'bg-brand/15 font-medium text-brand' : 'bg-white/5 font-light text-neutral-300'}`}
                  >
                    {t(`worktype.${w}`)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {editing && <SectionTitle>{t('edit.sectionDates')}</SectionTitle>}
        {phased ? (
          // the Cronograma has dates: they ARE the project's dates (earliest start, latest end), so there is nothing to type here
          <p className="text-xs text-neutral-400" data-testid="project-dates-derived">
            {[project.startDate, project.endDate].filter(Boolean).join(' → ')} · {t('proj.datesDerived')}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <DateField label={t('proj.start')} value={form.startDate} onChange={set('startDate')} />
            <DateField label={t('proj.end')} value={form.endDate} onChange={set('endDate')} invalid={badRange} />
          </div>
        )}
        {badRange && !phased && (
          <p role="alert" className="text-sm font-medium text-red-400">
            {t('proj.endBeforeStart')}
          </p>
        )}

        {/* the market (flag + currency + tax) of the job: picked for a new one, changeable later unless the quote is signed / frozen */}
        <div data-testid="project-market">
          {marketLocked ? (
            <p className="text-sm text-neutral-300" data-testid="project-market-locked">
              {t('newp.market')}: {REGIONS[form.regionCode]?.flag} {REGIONS[form.regionCode]?.currency} · {t('ws.locked')}
            </p>
          ) : (
            <RegionCombobox underline label={t('newp.market')} value={form.regionCode} onChange={set('regionCode')} />
          )}
          {!marketLocked && REGIONS[form.regionCode] && (
            <p className="mt-1.5 text-sm text-neutral-300" data-testid="project-market-hint">
              {REGIONS[form.regionCode].flag} {REGIONS[form.regionCode].currency}
            </p>
          )}
          {marketNote && (
            <p role="status" className="mt-1.5 flex items-start gap-1.5 text-xs text-neutral-400" data-testid="project-market-warn">
              <Outline size={14} icon="info" className="mt-0.5 text-neutral-500">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v5" />
                <path d="M12 8h.01" />
              </Outline>
              <span>{t('ws.market.warn')}</span>
            </p>
          )}
        </div>

        <div>
          {editing && <SectionTitle>{t('loc.title')}</SectionTitle>}
          <TextField
            underline
            label={t('project.city')}
            placeholder={t('project.city.ph')}
            value={form.cityOrRegion}
            maxLength={80}
            testId="project-city"
            sanitize={(v) => sanitizeText(v, 80)}
            onChange={(v) => {
              // typing a different place by hand: the saved point no longer describes it (it would feed the weather and the nearby prices), so it goes
              setForm((f) => ({ ...f, cityOrRegion: v, location: null }));
              setTyped(v);
              setActive(-1);
              if (cityGeo !== 'idle' && cityGeo !== 'asking') setCityGeo('idle');
            }}
            inputProps={{
              role: 'combobox',
              'aria-autocomplete': 'list',
              'aria-expanded': places.length > 0,
              'aria-controls': listId,
              'aria-activedescendant': active >= 0 ? `${listId}-${active}` : undefined,
              onKeyDown: onCityKey,
            }}
            end={
              <button
                type="button"
                onClick={findCity}
                aria-busy={cityGeo === 'asking'}
                aria-label={t('project.city.locate')}
                title={t('project.city.locate')}
                data-testid="project-city-locate"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-neutral-400 transition hover:text-white"
              >
                <TargetIcon busy={cityGeo === 'asking'} />
              </button>
            }
          />
          {places.length > 0 && (
            <ul id={listId} role="listbox" aria-label={t('project.city')} data-testid="project-city-results" className="mt-1.5 overflow-hidden rounded-xl bg-white/5 py-1">
              {places.map((pl, i) => (
                <li key={pl.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onClick={() => choose(pl)}
                    data-testid={`project-city-option-${i}`}
                    data-country={pl.countryCode || undefined}
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
          {!['idle', 'asking'].includes(cityGeo) && (
            <p role="status" data-testid="project-city-error" className="mt-1.5 text-sm font-medium text-red-400">
              {t(['unsupported', 'denied', 'unavailable', 'timeout'].includes(cityGeo) ? `newp.geo.${cityGeo}` : `project.city.err.${cityGeo}`)}
            </p>
          )}
        </div>

        {editing && !draftMode && (
          <>
            <SectionTitle>{t('edit.sectionState')}</SectionTitle>
            <Switch checked={form.closed} onChange={set('closed')} label={t('proj.closeSwitch')} description={t('proj.closeSwitch.desc')} data-testid="project-closed" />
            {project.draft.frozen && (
              <Switch checked={form.unfreeze} onChange={set('unfreeze')} label={t('proj.unfreeze')} description={t('proj.unfreeze.desc')} data-testid="project-unfreeze" />
            )}
          </>
        )}

        {editing ? (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={badRange} data-testid="project-save">
              {t('proj.save')}
            </Button>
          </div>
        ) : (
          // the clear end of the form: one big OLED button (green border + lettering, black inside) that says "done, start"
          <div className="space-y-2 pt-2">
            <button
              type="submit"
              disabled={badRange}
              data-testid="project-save"
              className="flex min-h-[64px] w-full select-none items-center justify-center gap-2 rounded-2xl px-5 text-lg transition active:scale-[0.98] disabled:opacity-40 bg-brand text-black font-semibold hover:bg-brand-light"
            >
              {t('proj.create')}
              <span aria-hidden="true">→</span>
            </button>
            <Button variant="ghost" className="w-full !min-h-[44px] text-sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
          </div>
        )}
        {editing && !draftMode && (
          <Button
            variant="danger"
            className="w-full !min-h-[44px] text-sm"
            onClick={() => ask({ message: t('proj.delete.confirm'), confirmLabel: t('proj.delete') }, onDelete)}
          >
            {t('proj.delete')}
          </Button>
        )}
      </form>
      {confirmNode}
    </BottomSheet>
  );
}
