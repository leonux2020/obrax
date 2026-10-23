import { useEffect, useMemo, useRef, useState } from 'react';
import { useMarketClock } from '../lib/marketClock.js';
import { useI18n } from '../lib/i18n.jsx';
import { computeAll } from '../lib/engine.js';
import { pricingTime, planningTimeline, freezeQuote } from '../lib/signature.js';
import { FINANCE_LIMITS } from '../lib/draft.js';
import { LEDGER_LIMITS, cashSummary, dayOf, laborPool, locationLabel, newEntryId, rentalsDue, RENTAL_CATEGORIES } from '../lib/ledger.js';
import { isClosed, parseDay, projectClient, projectLevel, projectTitle, toDayString } from '../lib/projects.js';
import { buildRenditionFile } from '../lib/rendition.js';
import { photosForReport } from '../lib/photos.js';
import { createReportPdf, pdfToFile, warmPdfEngine } from '../lib/reportPdf.js';
import { shareOrDownload } from '../lib/shareFile.js';
import { sanitizeText } from '../lib/sanitize.js';
import { usePro } from '../lib/usePro.js';
import { Button, NumberField, TextField } from './ui.jsx';
import { LEVEL_COLOR, levelDetail } from './levelStyle.js';
import PercentSlider from './PercentSlider.jsx';
import CashSheet from './CashSheet.jsx';
import ReceiptSheet from './ReceiptSheet.jsx';
import SnapGrid from './SnapGrid.jsx';
import Hourglass from './Hourglass.jsx';

const Icon = ({ children, size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="mt-6">
      <h2 id={id} className="mb-2 text-xs font-bold uppercase tracking-wider text-neutral-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Hidden accordion: cash advanced to workers, discounted from the labour pool that stays visible above it. */
function Advances({ advances, onChange, pool }) {
  const { t, money, region, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [worker, setWorker] = useState('');
  const [amount, setAmount] = useState(null);
  const [date, setDate] = useState(() => toDayString(new Date())); // today, editable
  const stamp = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(ms)) : '');
  const add = (e) => {
    e.preventDefault();
    if (!worker.trim() || !(amount > 0) || advances.length >= LEDGER_LIMITS.advances) return;
    const day = parseDay(date);
    // the chosen day at local noon (so it never slips to another day with the time zone); today keeps the real time
    const at = day ? (date === toDayString(new Date()) ? Date.now() : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).getTime()) : Date.now();
    onChange([{ id: newEntryId(), worker: worker.trim(), amount, at }, ...advances]);
    setWorker('');
    setAmount(null);
    setDate(toDayString(new Date()));
  };
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="adv-panel"
        onClick={() => setOpen((v) => !v)}
        data-testid="advances-toggle"
        className="flex min-h-[48px] w-full items-center gap-2 rounded-xl border border-white/10 px-4 text-left text-sm font-bold text-neutral-200 transition hover:border-white/30"
      >
        <span className="flex-1">{t('adv.title')}</span>
        {pool.advanced > 0 && <span className="tabular-nums text-[#e8c35f]">−{money(pool.advanced)}</span>}
        <span aria-hidden="true" className={`text-lg text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}>
          ›
        </span>
      </button>
      {open && (
        <div id="adv-panel" className="mt-2 space-y-3 rounded-xl border border-white/10 p-4" data-testid="advances-panel">
          <form onSubmit={add} className="space-y-3">
            <TextField label={t('adv.worker')} value={worker} onChange={setWorker} sanitize={(v) => sanitizeText(v, 60)} placeholder={t('adv.workerPh')} />
            <NumberField label={t('adv.amount')} value={amount} onChange={setAmount} decimals={region.digits} placeholder="0" />
            <div>
              <label htmlFor="adv-date" className="label">
                {t('adv.date')}
              </label>
              <input id="adv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field-input [color-scheme:dark]" data-testid="advance-date" />
            </div>
            <Button type="submit" className="w-full" disabled={!worker.trim() || !(amount > 0)} data-testid="advance-add">
              {t('adv.add')}
            </Button>
          </form>
          {advances.length > 0 && (
            <ul className="divide-y divide-white/10" data-testid="advance-list">
              {advances.map((a) => (
                <li key={a.id} className="flex min-h-[52px] items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{a.worker}</span>
                    <span className="block text-xs text-neutral-400">{stamp(a.at)}</span>
                  </span>
                  <span className="font-bold tabular-nums">{money(a.amount)}</span>
                  <button
                    type="button"
                    onClick={() => onChange(advances.filter((x) => x.id !== a.id))}
                    aria-label={`${t('common.delete')}: ${a.worker}`}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-lg text-red-400 hover:border-red-500"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Bitácora: the keyboard's own dictation (mic key) fills this field; nothing else is needed. */
function Logbook({ entries, onChange }) {
  const { t, lang, locale } = useI18n();
  const [text, setText] = useState('');
  const [hint, setHint] = useState(false);
  const field = useRef(null);
  const save = () => {
    const clean = sanitizeText(text, LEDGER_LIMITS.logChars).trim();
    if (!clean) return;
    onChange([{ id: newEntryId(), at: Date.now(), text: clean }, ...entries].slice(0, LEDGER_LIMITS.logbook));
    setText('');
  };
  const stamp = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) : '');
  return (
    <div className="space-y-3">
      {entries.length > 0 && (
        <ul className="space-y-2" data-testid="log-list">
          {entries.map((e) => (
            <li key={e.id} className="rounded-xl border border-white/10 px-4 py-3">
              <p className="text-xs font-semibold text-neutral-400">{stamp(e.at)}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{e.text}</p>
              <button
                type="button"
                onClick={() => onChange(entries.filter((x) => x.id !== e.id))}
                aria-label={`${t('common.delete')}: ${stamp(e.at)}`}
                className="mt-1 min-h-[36px] text-xs font-bold text-neutral-500 hover:text-red-400"
              >
                {t('common.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <textarea
          ref={field}
          value={text}
          onChange={(e) => setText(sanitizeText(e.target.value, LEDGER_LIMITS.logChars))}
          rows={3}
          lang={lang}
          inputMode="text"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          enterKeyHint="done"
          placeholder={t('log.placeholder')}
          aria-label={t('log.title')}
          data-testid="log-input"
          className="field-input min-h-[96px] resize-y pr-14"
        />
        {/* visual invitation to dictate: the keyboard's own microphone does the listening (no audio is handled here) */}
        <button
          type="button"
          onClick={() => {
            field.current?.focus();
            setHint(true);
          }}
          aria-label={t('log.dictate')}
          data-testid="log-mic"
          className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 text-brand transition hover:border-brand active:scale-95"
        >
          <Icon size={22}>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
          </Icon>
        </button>
      </div>
      {hint && (
        <p role="status" data-testid="log-mic-hint" className="text-xs text-neutral-300">
          {t('log.dictateHint')}
        </p>
      )}
      {text.trim() && (
        <Button className="w-full" onClick={save} data-testid="log-save">
          {t('log.save')}
        </Button>
      )}
    </div>
  );
}

/**
 * The inside of a project, top to bottom: identity + state + pencil, the money (budget + cash bar), the three
 * horizontal selectors (+ advances), the AI receipt scan, the supplies, Tap-to-Snap, the bitácora, the rendición and,
 * fixed at the base, "Generar PDF".
 */
export default function ProjectView({ project, setProject, setDraft, photos, setPhotos, company, onBack, onEdit, onEditor, onPro, prepareReceipt, fetchImpl }) {
  const i18n = useI18n();
  const { t, money, num, unit, region, locale } = i18n;
  const pro = usePro();
  const { now } = useMarketClock();
  const draft = project.draft;
  const [cashOpen, setCashOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(null); // 'pdf' | 'xlsx'
  const [note, setNote] = useState(''); // 'pdfError' | 'downloaded' | ''

  useEffect(() => {
    warmPdfEngine();
  }, []);

  const priceTime = pricingTime(draft, now);
  const timeline = planningTimeline(draft, project);
  const result = useMemo(
    () => computeAll(draft, priceTime, { timeline }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, priceTime, timeline.startDate, timeline.endDate]
  );
  const total = result.valid ? result.quote.total : 0;
  const cash = cashSummary(total, project.payments);
  const pool = laborPool(result.valid ? result.quote.labor : 0, project.advances);
  const closed = isClosed(project);
  const info = projectLevel(project, Date.now());
  const level = closed ? 'closed' : info.level;
  const detail = closed ? t('proj.closed') : levelDetail(t, info);
  const due = rentalsDue(project.expenses, Date.now());
  const title = projectTitle(project) || t('proj.untitled');
  const client = projectClient(project);

  const setFinance = (key) => (value) => setDraft((d) => ({ ...d, finance: { ...d.finance, [key]: value } }));
  const setList = (key) => (list) => setProject((p) => ({ ...p, [key]: list }));
  const items = result.valid ? result.quote.items : [];
  const visibleItems = showAll ? items : items.slice(0, 5);

  const generatePdf = async () => {
    if (!result.valid || busy) return;
    setBusy('pdf');
    setNote('');
    try {
      // "Generar PDF" FREEZES the quote: from now on the document and the project keep these prices and dates
      // (a client signature already does the same, so it is left alone). The contractor's signature from the
      // company profile is printed by the report itself.
      const frozen = draft.frozen || draft.signature ? draft : freezeQuote(draft, { pricedAt: priceTime, total, live: project });
      if (frozen !== draft) setDraft(() => frozen);
      const { doc, fileName, title: shareTitle } = await createReportPdf('client', { draft: frozen, result, company, i18n, photos: photosForReport(photos, t) });
      const outcome = await shareOrDownload(pdfToFile(doc, fileName), { title: shareTitle });
      if (outcome === 'downloaded') setNote('downloaded');
    } catch {
      setNote('pdfError');
    } finally {
      setBusy(null);
    }
  };

  const exportRendition = async () => {
    if (busy) return;
    setBusy('xlsx');
    setNote('');
    try {
      const file = buildRenditionFile([project], new Map([[project.id, result.valid ? total : null]]), { t, locale, currency: region.currency, digits: region.digits });
      const outcome = await shareOrDownload(file, { title: t('xl.shareTitle', { name: title }) });
      if (outcome === 'downloaded') setNote('downloaded');
    } catch {
      setNote('xlsxError');
    } finally {
      setBusy(null);
    }
  };

  const saveExpenses = (list) => {
    setProject((p) => ({ ...p, expenses: [...list, ...p.expenses].slice(0, LEDGER_LIMITS.expenses) }));
    setScanOpen(false);
  };
  const toggleReturned = (id) => setList('expenses')(project.expenses.map((e) => (e.id === id ? { ...e, returned: !e.returned } : e)));

  return (
    <main className="mx-auto w-full max-w-3xl px-3 pb-44 pt-3 sm:px-4" data-testid="project-view">
      {/* 1. identity, state and the pencil (edit only) */}
      <header className="flex items-start gap-2">
        <button type="button" onClick={onBack} aria-label={t('common.back')} data-testid="pv-back" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 hover:border-brand">
          <Icon>
            <path d="M15 18l-6-6 6-6" />
          </Icon>
        </button>
        <div className="min-w-0 flex-1 pt-0.5">
          <h1 className="truncate text-2xl font-extrabold leading-tight">{title}</h1>
          <p className="truncate text-sm text-neutral-300">
            <span aria-hidden="true">{region.flag}</span> {client || t('proj.noClient')}
          </p>
          {project.location && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${project.location.lat},${project.location.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="pv-location"
              aria-label={`${t('pv.map')}: ${locationLabel(project.location)}`}
              className="mt-0.5 flex min-h-[28px] max-w-full items-center gap-1 text-sm text-neutral-300 underline decoration-white/30 underline-offset-2 hover:text-white"
            >
              <Icon size={14}>
                <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
                <circle cx="12" cy="10" r="2.5" />
              </Icon>
              <span className="truncate">{locationLabel(project.location)}</span>
            </a>
          )}
        </div>
        <button type="button" onClick={onEdit} aria-label={t('proj.edit')} data-testid="pv-edit" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 hover:border-brand">
          <Icon>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
          </Icon>
        </button>
      </header>
      <div className="mt-2 flex items-center gap-2">
        <span
          data-testid="pv-status"
          data-level={level}
          className="inline-flex max-w-full items-center gap-2 rounded-full border-2 px-3 py-1.5 text-sm font-extrabold"
          style={{ color: LEVEL_COLOR[level], borderColor: LEVEL_COLOR[level] }}
        >
          <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: LEVEL_COLOR[level] }} />
          <span className="truncate">{detail || t(`light.${info.level}`)}</span>
        </span>
        {due.length > 0 && <Hourglass label={t('rental.dueToday')} />}
      </div>

      {/* 2. money: the budget and the cash control bar */}
      <section aria-labelledby="pv-budget" className="card mt-4">
        <h2 id="pv-budget" className="text-xs font-bold uppercase tracking-wider text-neutral-400">
          {t('pv.budget')}
        </h2>
        <p data-testid="budget-total" className="mt-1 text-4xl font-black tabular-nums text-brand">
          {result.valid ? money(total) : '—'}
        </p>
        {draft.frozen && (
          <p data-testid="frozen-chip" className="mt-1 text-xs font-bold text-[#e8c35f]">
            {t('pv.frozen')}
          </p>
        )}
        <button
          type="button"
          onClick={() => setCashOpen(true)}
          data-testid="cash-bar"
          aria-label={`${t('cash.title')}: ${money(cash.paid)} / ${money(cash.total)}`}
          className="mt-4 block w-full text-left"
        >
          <span className="block h-5 overflow-hidden rounded-full border border-white/15">
            <span data-testid="cash-fill" data-pct={Math.round(cash.pct)} style={{ width: `${cash.pct}%` }} className={`block h-full rounded-full transition-all ${cash.overpaid ? 'bg-[#e8c35f]' : 'bg-brand'}`} />
          </span>
          <span className="mt-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span>
              {t('cash.paid')} <b className="tabular-nums">{money(cash.paid)}</b> <span className="text-neutral-400">· {Math.round(cash.pct)} %</span>
            </span>
            <span className="text-neutral-300">
              {t('cash.pending')} <b className="tabular-nums">{money(cash.pending)}</b>
            </span>
          </span>
        </button>

        {/* the calculation (measures, partidas, prices, schedule) lives in the editor: a quiet row inside the budget card */}
        <button
          type="button"
          onClick={onEditor}
          data-testid="editor-open"
          data-pending={result.valid ? undefined : 'true'}
          className={`mt-4 flex min-h-[44px] w-full items-center gap-2 border-t border-white/10 pt-3 text-left text-sm font-semibold transition hover:text-white ${result.valid ? 'text-neutral-300' : 'text-brand'}`}
        >
          <Icon size={18}>
            <path d="M3 17L17 3l4 4L7 21H3z" />
            <path d="M13 7l4 4M9 11l2 2M6 14l2 2" />
          </Icon>
          <span className="flex-1">{result.valid ? t('pv.calc', { n: draft.partidas.length }) : t('pv.calc.define')}</span>
          <span aria-hidden="true" className="text-lg text-neutral-500">
            ›
          </span>
        </button>
      </section>

      {/* 3. selectors: one slider each (Mano de Obra, Imprevistos, Utilidad) */}
      <section aria-label={t('pv.selectors')} className="card mt-4 space-y-4" data-testid="selectors">
        <PercentSlider label={t('fin.labor')} testId="slider-labor" value={draft.finance.labor} min={FINANCE_LIMITS.labor.min} max={FINANCE_LIMITS.labor.max} onChange={setFinance('labor')} />
        {result.valid && (
          <p data-testid="labor-pool" data-available={pool.available} className="text-sm text-neutral-300">
            {t('adv.pool')}: <b className="tabular-nums text-white">{money(pool.available)}</b>
            {pool.advanced > 0 && <span className="text-[#e8c35f]"> (−{money(pool.advanced)})</span>}
          </p>
        )}
        <Advances advances={project.advances} onChange={setList('advances')} pool={pool} />
        <PercentSlider label={t('fin.contingency')} testId="slider-contingency" value={draft.finance.contingency} min={FINANCE_LIMITS.contingency.min} max={FINANCE_LIMITS.contingency.max} onChange={setFinance('contingency')} />
        <PercentSlider label={t('fin.profit')} testId="slider-profit" value={draft.finance.profit} min={FINANCE_LIMITS.profit.min} max={FINANCE_LIMITS.profit.max} onChange={setFinance('profit')} />
      </section>

      {/* 4. AI receipt scan */}
      <button
        type="button"
        onClick={() => (pro ? setScanOpen(true) : onPro('ai'))}
        data-testid="scan-receipt"
        className="mt-5 flex min-h-[64px] w-full items-center justify-center gap-3 rounded-2xl border-2 border-[#d4af37] px-4 text-lg font-extrabold text-[#e8c35f] transition active:scale-[0.99]"
      >
        <Icon size={28}>
          <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
          <circle cx="12" cy="13.5" r="3.5" />
        </Icon>
        <span>{t('scan.cta')}</span>
        {!pro && <span className="rounded border border-[#d4af37]/60 px-1.5 text-[10px] tracking-widest">PRO</span>}
      </button>

      {/* 5. supplies: what the quote needs + what the receipts say was bought / rented */}
      <Section id="pv-supplies" title={t('sup.title')}>
        {items.length > 0 && (
          <>
            <ul className="divide-y divide-white/10 rounded-2xl border border-white/10" data-testid="supply-list">
              {visibleItems.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{t(`mat.${i.id}`)}</span>
                    <span className="block text-xs text-neutral-400">
                      {num(i.packs)} {unit(i.saleUnit)}
                    </span>
                  </span>
                  <span className="text-sm font-bold tabular-nums">{money(i.total)}</span>
                </li>
              ))}
            </ul>
            {items.length > 5 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} data-testid="supply-more" className="mt-1 min-h-[44px] w-full text-sm font-bold text-neutral-300 hover:text-white">
                {showAll ? t('sup.less') : t('sup.more', { n: items.length - 5 })}
              </button>
            )}
          </>
        )}
        {items.length === 0 && project.expenses.length === 0 && <p className="rounded-2xl border border-white/10 px-4 py-4 text-sm text-neutral-400">{t('sup.empty')}</p>}

        {project.expenses.length > 0 && (
          <ul className="mt-3 space-y-2" data-testid="expense-list">
            {project.expenses.map((e) => {
              const rental = RENTAL_CATEGORIES.includes(e.category);
              const isDue = due.some((d) => d.id === e.id);
              return (
                <li
                  key={e.id}
                  data-testid={`expense-${e.id}`}
                  data-due={isDue ? 'true' : undefined}
                  className={`rounded-2xl border bg-black px-4 py-3 ${isDue ? 'border-[#d4af37]' : 'border-white/10'}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{e.description || t(`exp.cat.${e.category}`)}</span>
                      <span className="block truncate text-xs text-neutral-400">{[t(`exp.cat.${e.category}`), e.supplier].filter(Boolean).join(' · ')}</span>
                    </span>
                    {isDue && <Hourglass label={t('rental.dueToday')} />}
                    <span className="font-bold tabular-nums">{money(e.amount)}</span>
                    <button
                      type="button"
                      onClick={() => setList('expenses')(project.expenses.filter((x) => x.id !== e.id))}
                      aria-label={`${t('common.delete')}: ${e.description || t(`exp.cat.${e.category}`)}`}
                      className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg text-neutral-500 hover:text-red-400"
                    >
                      ×
                    </button>
                  </div>
                  {rental && (
                    <button
                      type="button"
                      onClick={() => toggleReturned(e.id)}
                      aria-pressed={e.returned}
                      data-testid={`expense-return-${e.id}`}
                      className={`mt-2 min-h-[44px] w-full rounded-xl border px-3 text-sm font-bold ${e.returned ? 'border-brand/40 text-brand' : isDue ? 'border-[#d4af37] text-[#e8c35f]' : 'border-white/10 text-neutral-200'}`}
                    >
                      {e.returned ? `✓ ${t('rental.returned')}` : e.returnDate ? t('rental.returnBy', { date: e.returnDate === dayOf(Date.now()) ? t('light.todayShort') : e.returnDate }) : t('rental.markReturned')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* 6. Tap-to-Snap */}
      <Section id="pv-snap" title={t('snap.title')}>
        <SnapGrid photos={photos} setPhotos={setPhotos} projectId={project.id} />
      </Section>

      {/* 7. bitácora (last field of the view) */}
      <Section id="pv-log" title={t('log.title')}>
        <Logbook entries={project.logbook} onChange={setList('logbook')} />
      </Section>

      <Button variant="ghost" className="mt-6 w-full" onClick={exportRendition} disabled={busy === 'xlsx'} data-testid="export-rendition">
        {busy === 'xlsx' ? t('pdf.generating') : t('xl.export')}
      </Button>
      {note === 'xlsxError' && (
        <p role="alert" className="mt-2 text-sm font-semibold text-red-400">
          {t('xl.error')}
        </p>
      )}
      {note === 'downloaded' && (
        <p role="status" data-testid="share-note" className="mt-2 text-sm text-neutral-300">
          {t('share.downloaded')}
        </p>
      )}

      {/* base: Generar PDF */}
      <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-black px-3 py-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-3xl">
          {note === 'pdfError' && (
            <p role="alert" className="mb-2 text-sm font-semibold text-red-400">
              {t('pdf.error')}
            </p>
          )}
          <Button className="w-full" onClick={generatePdf} disabled={!result.valid || busy === 'pdf'} data-testid="pdf-generate">
            {busy === 'pdf' ? t('pdf.generating') : t('pv.pdf')}
          </Button>
        </div>
      </div>

      {cashOpen && <CashSheet total={total} payments={project.payments} onChange={setList('payments')} onClose={() => setCashOpen(false)} />}
      {scanOpen && <ReceiptSheet onSave={saveExpenses} onClose={() => setScanOpen(false)} {...(prepareReceipt ? { prepareImage: prepareReceipt } : {})} {...(fetchImpl ? { fetchImpl } : {})} />}
    </main>
  );
}
