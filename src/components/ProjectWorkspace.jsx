import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { useMarketClock } from '../lib/marketClock.js';
import { computeAll } from '../lib/engine.js';
import { freezeSignature, pricingTime, planningTimeline } from '../lib/signature.js';
import { LEDGER_LIMITS, cashSummary } from '../lib/ledger.js';
import { MAX_PARTIDAS, newPartida } from '../lib/draft.js';
import { TASKS, defaultDims } from '../lib/tasks.js';
import { projectClient, projectTitle } from '../lib/projects.js';
import { flushUserPrices } from '../lib/priceFeed.js';
import { savedMeta } from '../lib/priceBook.js';
import { lookupPrice } from '../lib/baseCatalog.js';
import { useAiAccess } from '../lib/usePro.js';
import { useOnline } from '../lib/useOnline.js';
import { useProjectBook, usePriceFeed } from '../lib/usePrices.js';
import { pushToast } from '../lib/notify.js';
import { runExport } from '../lib/exportActions.js';
import { warmPdfEngine } from '../lib/reportPdf.js';
import { headerModel, initialWorkspaceState, partidaGroups, quoteLock, unlockQuote, withMarket, withPriceOverride, workspaceReducer } from '../lib/workspaceModel.js';
import BottomSheet from './BottomSheet.jsx';
import Logbook from './Logbook.jsx';
import ReceiptSheet from './ReceiptSheet.jsx';
import SignatureSheet from './SignatureSheet.jsx';
import SnapGrid from './SnapGrid.jsx';
import { Button } from './ui.jsx';
import CashBlock from './workspace/CashBlock.jsx';
import CrewBlock from './workspace/CrewBlock.jsx';
import Dock from './workspace/Dock.jsx';
import ExpensesBlock from './workspace/ExpensesBlock.jsx';
import ExportSheet from './workspace/ExportSheet.jsx';
import FinanceBlock from './workspace/FinanceBlock.jsx';
import LogBlock from './workspace/LogBlock.jsx';
import HeaderZone from './workspace/HeaderZone.jsx';
import MachineryBlock from './workspace/MachineryBlock.jsx';
import SupplierPad from './workspace/SupplierPad.jsx';
import MarketSheet from './workspace/MarketSheet.jsx';
import PartidaList from './workspace/PartidaList.jsx';

/**
 * The project as ONE screen (SPA). It replaces the old project view AND the whole wizard (measures, prices, crew, machinery,
 * finance, report): nothing sends the user to another editor.
 *
 *   ZONE A  header that never scrolls away: name, client, place, traffic light + days, live total, bars.
 *   ZONE B  the living list, all accordions: partidas (measures + materials + prices), crew & schedule, machinery rentals,
 *           selectors (labour / transport / contingencies / profit / tax) and expenses. Every number is typed on the app's
 *           own numpad; the quote recalculates on the next render and the price goes to the user's book in IndexedDB.
 *   ZONE C  bottom dock: Bitácora, Cámara, Boleta IA, Exportar (each one a bottom sheet).
 *
 * Locked (PDF generated or client signature): Zone B is read-only and a tap answers "Precios bloqueados" until the user
 * unlocks it. Offline-first: nothing here needs the network (see the receipt queue, the base catalog and Blob photos).
 */
export default function ProjectWorkspace({ project, setProject, setDraft, photos, setPhotos, company, receipts, enqueueReceipt, onBack, onEdit, onPro }) {
  const i18n = useI18n();
  const { t, region } = i18n;
  const draft = project.draft;
  const regionCode = draft.regionCode;
  const aiAccess = useAiAccess();
  const online = useOnline();
  const { now } = useMarketClock();

  const location = project.location ? { lat: project.location.lat, lng: project.location.lng } : null;
  usePriceFeed(regionCode, { [regionCode]: [location] });
  const book = useProjectBook(regionCode, location); // the market's book where the supplier prices within 50 km of the job come first
  const priceTime = pricingTime(draft, now);
  const timeline = planningTimeline(draft, project);
  const result = useMemo(
    () => computeAll(draft, priceTime, { timeline, book, chains: false }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, priceTime, timeline.startDate, timeline.endDate, book]
  );
  const total = result.valid ? result.quote.total : 0;
  const cash = cashSummary(total, project.payments);
  const model = headerModel({ project, total, valid: result.valid, cash, now: Date.now() });
  const locked = quoteLock(draft);
  const groups = useMemo(() => partidaGroups(result, draft), [result, draft]);
  const queued = receipts?.rows.filter((r) => r.projectId === project.id) ?? [];

  // a new (still empty) project lands with its first unfinished partida open: the measures are right there
  const [ui, dispatch] = useReducer(workspaceReducer, undefined, () => {
    const first = groups.find((g) => g.incomplete);
    return { ...initialWorkspaceState(), open: first ? { [first.id]: true } : {} };
  });
  const toggle = (id, open) => dispatch({ type: 'toggle', id, open });
  const closeSheet = () => dispatch({ type: 'closeSheet' });

  useEffect(() => {
    warmPdfEngine(); // the PDF engine is loaded now, so exporting works without a network later
  }, []);

  // ---- the lock --------------------------------------------------------------------------------------------------------
  const blocked = useCallback(() => pushToast({ key: 'ws.locked', tone: 'warn' }), []);
  /** Every edit of the quote goes through here: a frozen / signed draft comes back untouched. */
  const edit = useCallback((fn) => setDraft((d) => (quoteLock(d) ? d : typeof fn === 'function' ? fn(d) : fn)), [setDraft]);
  const confirmUnlock = () => {
    setDraft(unlockQuote);
    closeSheet();
    pushToast({ key: 'ws.unlocked', tone: 'ok' });
  };

  // ---- Caja: the header total / bar take the user to the payments accordion (Zone B) instead of a separate sheet ----------------
  const openCash = () => {
    dispatch({ type: 'toggle', id: 'cash', open: true });
    setTimeout(() => document.querySelector('[data-testid="ws-cash"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 60);
  };

  // ---- Bitácora: a NEW note (dictated from the dock or typed) opens its accordion by itself, as the visual confirmation ----------------
  const newestNote = project.logbook[0]?.id ?? '';
  const noteCount = project.logbook.length;
  const seenNotes = useRef({ id: newestNote, count: noteCount });
  useEffect(() => {
    const seen = seenNotes.current;
    seenNotes.current = { id: newestNote, count: noteCount };
    if (newestNote && newestNote !== seen.id && noteCount > seen.count) {
      dispatch({ type: 'toggle', id: 'log', open: true });
      setTimeout(() => document.querySelector('[data-testid="ws-log"]')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 60);
    }
  }, [newestNote, noteCount]);

  // ---- market of THIS project (the app's language stays as it is) --------------------------------------------------------------
  const openMarket = () => (locked ? blocked() : dispatch({ type: 'sheet', name: 'market' }));
  const changeMarket = (code) => {
    setDraft((d) => withMarket(d, code));
    closeSheet();
    pushToast({ key: 'ws.market.done', tone: 'ok' });
  };

  // ---- partidas ---------------------------------------------------------------------------------------------------------
  const updatePartida = (id, fn) => edit((d) => ({ ...d, partidas: d.partidas.map((p) => (p.id === id ? fn(p) : p)) }));
  const changeTask = (id, task) => updatePartida(id, (p) => ({ ...p, task, dims: defaultDims(task, p.dims), waste: TASKS[task].defaultWaste }));
  const addPartida = () => {
    if (locked) return blocked();
    if (draft.partidas.length >= MAX_PARTIDAS) return undefined;
    const p = newPartida('slab');
    edit((d) => ({ ...d, partidas: [...d.partidas, p] }));
    dispatch({ type: 'toggle', id: p.id, open: true });
    return undefined;
  };
  const removePartida = (id) => {
    if (!window.confirm(t('part.confirmDelete'))) return;
    edit((d) => ({ ...d, partidas: d.partidas.filter((p) => p.id !== id) }));
  };

  // ---- material prices: numpad -> project -> computeAll -> IndexedDB (the user's standard price) ------------------------------
  const openPrice = (id) => (locked ? blocked() : dispatch({ type: 'openPad', kind: 'material', id }));
  // this project, at once: the quote recalculates on the next render (the pad saves the user's own price + supplier on the device)
  const applyPrice = (id) => (n) => edit((d) => withPriceOverride(d, id, n));
  const closePad = () => {
    dispatch({ type: 'closePad' });
    flushUserPrices(); // the last typed price is written now, not 400 ms later
  };
  const padId = ui.pad?.kind === 'material' ? ui.pad.id : null;
  const padLookup = padId ? lookupPrice(padId, regionCode, { book, override: draft.overrides[padId] }) : null;
  const padItem = padId ? result.quote?.items?.find((x) => x.id === padId) : null;

  // ---- export (always through lib/exportActions.js) + the client's signature -------------------------------------------------------
  const exportCtx = (p) => ({ project: p, result, total, priceTime, company, photos, i18n, setDraft });
  const deliverClientPdf = async (p) => {
    try {
      await runExport('client', exportCtx(p));
    } catch {
      pushToast({ key: 'ws.export.error', tone: 'warn' });
    }
  };
  /** "PDF Cliente" asks for the signature first; the other documents go straight out. */
  const exportDoc = (kind) => {
    if (kind === 'client' && !draft.signature) {
      dispatch({ type: 'sheet', name: 'sign' });
      return Promise.resolve('cancelled');
    }
    return runExport(kind, exportCtx(project));
  };
  /** Signed: the quote freezes (prices + dates), the whole screen turns read-only (🔒) and the signed PDF goes out. */
  const onSign = (signature) => {
    const signed = freezeSignature(draft, { ...draft, signature }, { startDate: project.startDate, endDate: project.endDate }, result.book);
    setDraft(() => signed);
    closeSheet();
    pushToast({ key: 'ws.sign.done', tone: 'ok' });
    return deliverClientPdf({ ...project, draft: signed });
  };
  const onSkipSign = () => {
    closeSheet();
    return deliverClientPdf(project); // unsigned: generating it still freezes the quote
  };

  // ---- dock + the rest ----------------------------------------------------------------------------------------------------------------
  const openDock = (name) => (name === 'scan' && !aiAccess ? onPro('ai') : dispatch({ type: 'sheet', name }));
  const setList = (key) => (list) => setProject((p) => ({ ...p, [key]: list }));
  const saveExpenses = (list) => {
    setProject((p) => ({ ...p, expenses: [...list, ...p.expenses].slice(0, LEDGER_LIMITS.expenses) }));
    closeSheet();
  };
  const park = (image) => enqueueReceipt({ projectId: project.id, image, regionCode, currency: region.currency, lang: i18n.lang });
  const title = projectTitle(project) || t('proj.untitled');

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-3xl bg-black pb-40 text-[#E0E0E0]" data-testid="project-workspace" data-locked={locked || undefined}>
      <HeaderZone project={project} model={model} title={title} client={projectClient(project)} region={region} offline={!online} onBack={onBack} onEdit={onEdit} onMarket={openMarket} onCash={openCash} onUnlock={() => dispatch({ type: 'sheet', name: 'unlock' })} />

      <div className="space-y-3 px-3 pt-3">
        <PartidaList draft={draft} groups={groups} open={ui.open} locked={Boolean(locked)} onBlocked={blocked} showErrors onToggle={toggle} onUpdate={updatePartida} onTask={changeTask} onAdd={addPartida} onRemove={removePartida} onPrice={openPrice} />
        <CrewBlock project={project} result={result} locked={Boolean(locked)} onBlocked={blocked} setDraft={setDraft} setProject={setProject} open={ui.open.crew} onToggle={toggle} />
        <MachineryBlock draft={draft} result={result} regionCode={regionCode} projectLocation={location} locked={Boolean(locked)} onBlocked={blocked} setDraft={setDraft} open={ui.open.machinery} onToggle={toggle} />
        <FinanceBlock draft={draft} locked={Boolean(locked)} onBlocked={blocked} setDraft={edit} open={ui.open.finance} onToggle={toggle} />
        <CashBlock total={total} payments={project.payments} onChange={setList('payments')} open={ui.open.cash} onToggle={toggle} />
        <LogBlock entries={project.logbook} onChange={setList('logbook')} open={ui.open.log} onToggle={toggle} />
        <ExpensesBlock expenses={project.expenses} queued={queued} receipts={receipts} onChange={setList('expenses')} open={ui.open.expenses} onToggle={toggle} />
      </div>

      <Dock onOpen={openDock} queued={queued.filter((r) => r.status === 'pending' || r.status === 'sending').length} />

      {padId && padLookup && (
        <SupplierPad
          key={padId}
          regionCode={regionCode}
          kind="materials"
          itemId={padId}
          projectLocation={location}
          initialSupplier={savedMeta(result.book, regionCode, 'materials', padId)?.supplierName ?? ''}
          title={t('ws.pad.title', { name: t(`mat.${padId}`) })}
          unit={padItem ? t('ws.pad.per', { unit: i18n.unit(padItem.saleUnit) }) : ''}
          value={padItem?.unitPrice ?? padLookup.price}
          decimals={region.digits}
          foot={padLookup.source === 'user' ? t('ws.pad.saved') : `${t(`ws.origin.${padLookup.source}`)} · ${i18n.money(padItem?.unitPrice ?? padLookup.price ?? 0)}`}
          onApply={applyPrice(padId)}
          onClose={closePad}
        />
      )}

      {ui.sheet === 'unlock' && (
        <BottomSheet title={t('ws.unlock.title')} onClose={closeSheet}>
          <p className="mt-2 text-sm text-neutral-300" data-testid="unlock-warning">
            {t('ws.unlock.warn')}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={closeSheet}>
              {t('common.cancel')}
            </Button>
            <Button onClick={confirmUnlock} data-testid="unlock-confirm">
              {t('ws.unlock.confirm')}
            </Button>
          </div>
        </BottomSheet>
      )}
      {ui.sheet === 'market' && <MarketSheet current={regionCode} onChange={changeMarket} onClose={closeSheet} />}
      {ui.sheet === 'export' && <ExportSheet canPdf={result.valid} onExport={exportDoc} onClose={closeSheet} />}
      {ui.sheet === 'sign' && <SignatureSheet total={total} pricedAt={priceTime} onSave={onSign} onSkip={onSkipSign} skipLabel={t('ws.sign.skip')} onClose={closeSheet} />}
      {ui.sheet === 'log' && (
        <BottomSheet title={t('log.title')} onClose={closeSheet}>
          <div className="mt-3">
            <Logbook entries={project.logbook} onChange={setList('logbook')} showList={false} onSaved={closeSheet} />
          </div>
        </BottomSheet>
      )}
      {ui.sheet === 'camera' && (
        <BottomSheet title={t('snap.title')} onClose={closeSheet}>
          <div className="mt-3">
            <SnapGrid photos={photos} setPhotos={setPhotos} projectId={project.id} />
          </div>
        </BottomSheet>
      )}
      {ui.sheet === 'scan' && <ReceiptSheet onSave={saveExpenses} onQueue={park} onClose={closeSheet} />}
    </main>
  );
}
