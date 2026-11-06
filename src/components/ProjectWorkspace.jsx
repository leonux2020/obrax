import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { useMarketClock } from '../lib/marketClock.js';
import { computeAll } from '../lib/engine.js';
import { freezeSignature, pricingTime, planningTimeline } from '../lib/signature.js';
import { LEDGER_LIMITS, cashSummary, liquidity, newEntryId, projectMarket, withProjectContext } from '../lib/ledger.js';
import { MAX_PARTIDAS, newPartida } from '../lib/draft.js';
import { TASKS, defaultDims } from '../lib/tasks.js';
import { projectClient, projectTitle } from '../lib/projects.js';
import { sanitizeText } from '../lib/sanitize.js';
import { flushUserPrices } from '../lib/priceFeed.js';
import { savedMeta } from '../lib/priceBook.js';
import { lookupPrice } from '../lib/baseCatalog.js';
import { useAiAccess } from '../lib/usePro.js';
import { useOnline } from '../lib/useOnline.js';
import { useProjectBook, usePriceFeed } from '../lib/usePrices.js';
import { pushToast } from '../lib/notify.js';
import { buildDossierDocuments, runExport } from '../lib/exportActions.js';
import { warmPdfEngine } from '../lib/reportPdf.js';
import { headerModel, initialWorkspaceState, partidaGroups, quoteLock, unlockQuote, withPriceOverride, workspaceReducer } from '../lib/workspaceModel.js';
import BottomSheet from './BottomSheet.jsx';
import { countPhotos } from '../lib/photos.js';
import Logbook from './Logbook.jsx';
import { notePhotosFor } from '../lib/notePhotos.js';
import { receiptPhotosFor } from '../lib/receiptPhotos.js';
import { useAccordionBack } from '../lib/useAccordionBack.js';
import ReceiptSheet from './ReceiptSheet.jsx';
import SignatureSheet from './SignatureSheet.jsx';
import SnapGrid, { PhotoEditToggle } from './SnapGrid.jsx';
import { Button } from './ui.jsx';
import CashBlock from './workspace/CashBlock.jsx';
import CrewBlock from './workspace/CrewBlock.jsx';
import TimelineBlock from './workspace/TimelineBlock.jsx';
import Dock from './workspace/Dock.jsx';
import DraftBar, { DraftLeaveSheet, DraftNameSheet } from './workspace/DraftBar.jsx';
import ExpensesBlock from './workspace/ExpensesBlock.jsx';
import ExportSheet from './workspace/ExportSheet.jsx';
import FinanceBlock from './workspace/FinanceBlock.jsx';
import LogBlock from './workspace/LogBlock.jsx';
import HeaderZone from './workspace/HeaderZone.jsx';
import ProjectAudit from './ProjectAudit.jsx';
import AlertTray from './workspace/AlertTray.jsx';
import { projectAlerts } from '../lib/alerts.js';
import SupplierPad from './workspace/SupplierPad.jsx';
import PartidaList from './workspace/PartidaList.jsx';
import { useConfirm } from './ConfirmSheet.jsx';

/**
 * The project as ONE screen (SPA). It replaces the old project view AND the whole wizard (measures, prices, crew, machinery,
 * finance, report): nothing sends the user to another editor.
 *
 *   ZONE A  header that never scrolls away: name, client, place, traffic light + days, live total, bars.
 *   ZONE B  the living list, all accordions: partidas (measures + materials + prices), crew, machinery rentals,
 *           selectors (labour / transport / contingencies / profit / tax) and expenses. Every number is typed on the app's
 *           own numpad; the quote recalculates on the next render and the price goes to the user's book in IndexedDB.
 *   ZONE C  bottom dock: Bitácora, Cámara, Boleta IA, Exportar (each one a bottom sheet).
 *
 * Locked (PDF generated or client signature): Zone B is read-only and a tap answers "Precios bloqueados" until the user
 * unlocks it. Offline-first: nothing here needs the network (see the receipt queue, the base catalog and Blob photos).
 */
const MENU_BLOCKS = ['crew', 'finance', 'cash', 'log', 'expenses', 'timeline']; // the grid tiles that open a bottom sheet

/**
 * Navigation context of the detail view. The project opens in one of two modes:
 *   TACTICAL  (default, from "Proyectos")           the operational workspace below;
 *   AUDIT     (`fromAccounting`, from "Contabilidad") a pure financial ledger: cockpit + receipt stack, nothing operational (ProjectAudit).
 * `rendition` ({ onClose, onRetry, onReconnect, needsReconnect, queue }) feeds the audit mode's "Cerrar Rendición" bar.
 *
 * DRAFT / SIMULATION (`sandbox` = { onSave(name), onDiscard(), onKeep(), leaveAsk }): the same screen for a job that is NOT in the database yet ("Nuevo proyecto"
 * lands here). The name is typed in the header, the big figures start at 0 and say "(Simulación)", the six tiles work on a virtual project, and the dock
 * (Bitácora, Cámara...) is replaced by SIMULAR / CALCULAR (refresh the figures, save nothing) and GUARDAR PROYECTO (ask for a name if there is none, then
 * hand the project to the app, which stores it and shows this very screen in its normal state).
 */
export default function ProjectWorkspace({ fromAccounting = false, rendition = null, ...props }) {
  if (fromAccounting) return <ProjectAudit project={props.project} rendition={rendition} />;
  return <TacticalWorkspace {...props} />;
}

function TacticalWorkspace({ project, setProject, setDraft, photos, setPhotos, company, receipts, enqueueReceipt, onEdit, onPro, onSyncDossier = null, dossierBusy = false, geocode, sandbox = null }) {
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
  // DRAFT: the big figures are a SNAPSHOT taken by "Simular / Calcular" (0 until then); they never follow the typing by themselves
  const [sim, setSim] = useState(null);
  const simulate = () => setSim({ total, valid: result.valid, cash });
  const stale = Boolean(sandbox && sim && (sim.total !== total || sim.cash.paid !== cash.paid));
  const model = sandbox
    ? headerModel({ project, total: sim ? sim.total : 0, valid: sim ? sim.valid : true, cash: sim ? sim.cash : cashSummary(0, []), liquid: 0, now: Date.now() })
    : headerModel({ project, total, valid: result.valid, cash, liquid: liquidity(project.payments, project.expenses, project.advances), now: Date.now() });
  const locked = quoteLock(draft);
  const groups = useMemo(() => partidaGroups(result, draft), [result, draft]);
  const queued = receipts?.rows.filter((r) => r.projectId === project.id) ?? [];

  // a new (still empty) project lands with its first unfinished partida open: the measures are right there
  const [ui, dispatch] = useReducer(workspaceReducer, undefined, () => {
    const first = groups.find((g) => g.incomplete);
    return { ...initialWorkspaceState(), open: first ? { [first.id]: true } : {} };
  });
  const toggle = (id, open) => dispatch({ type: 'toggle', id, open });
  // DRAFT: the details sheet can turn the job into a single global line (turnkey) AFTER this screen mounted: that first line opens too
  const hadPartidas = useRef(groups.length > 0);
  useEffect(() => {
    const first = groups.find((g) => g.incomplete);
    if (sandbox && !hadPartidas.current && groups.length > 0 && first) dispatch({ type: 'toggle', id: first.id, open: true });
    hadPartidas.current = groups.length > 0;
  }, [groups, sandbox]);
  // the device's Back closes the last opened partida accordion instead of leaving the project (the grid menus are bottom sheets: they are
  // back-stack layers by themselves, see Block.jsx)
  const partidaOpen = useMemo(() => Object.fromEntries(Object.entries(ui.open).filter(([id]) => !MENU_BLOCKS.includes(id))), [ui.open]);
  useAccordionBack(partidaOpen, (id) => dispatch({ type: 'toggle', id, open: false }));
  const closeSheet = () => dispatch({ type: 'closeSheet' });
  const [ask, confirmNode] = useConfirm();

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
  const removePartida = (id) =>
    ask({ message: t('part.confirmDelete'), confirmLabel: t('common.delete') }, () => edit((d) => ({ ...d, partidas: d.partidas.filter((p) => p.id !== id) })));

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
  // "Sincronizar Expediente a Drive": hands the App the way to build the documents; everything else runs in the background
  const syncDossier = () => onSyncDossier(project.id, () => buildDossierDocuments({ project, result, total, company, photos, i18n }));
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
  const saveExpenses = async (list, extra = {}) => {
    let lines = list;
    if (extra.image) {
      // the receipt photo stays on the device (Blob) and its lines point at it: the expediente puts it in "Comprobantes"
      const receiptId = newEntryId();
      try {
        await receiptPhotosFor(project.id).put(receiptId, { ...extra.image, at: Date.now() });
        lines = list.map((e) => ({ ...e, receiptId }));
      } catch {
        /* a photo that cannot be kept never blocks the expenses */
      }
    }
    setProject((p) => ({ ...p, expenses: [...withProjectContext(p, lines), ...p.expenses].slice(0, LEDGER_LIMITS.expenses) })); // each line inherits this project's id / currency / place
    closeSheet();
  };
  const park = (image) => enqueueReceipt({ projectId: project.id, image, regionCode, currency: region.currency, lang: i18n.lang });
  const title = projectTitle(project) || t('proj.untitled');
  // DRAFT: the name lives in the header; GUARDAR without one asks for it in a soft sheet
  const [namingFor, setNamingFor] = useState(null); // null | 'save'
  const setName = (value) => setDraft((d) => ({ ...d, project: { ...d.project, name: sanitizeText(value, 60) } }));
  const requestSave = () => {
    const name = sanitizeText(projectTitle(project), 60).trim();
    if (name) sandbox.onSave(name);
    else setNamingFor('save');
  };

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-3xl bg-black pb-40 text-neutral-200" data-testid="project-workspace" data-locked={locked || undefined}>
      <HeaderZone
        project={project}
        model={model}
        title={title}
        client={projectClient(project)}
        region={region}
        offline={!online}
        onEdit={onEdit}
        onCash={openCash}
        onUnlock={() => dispatch({ type: 'sheet', name: 'unlock' })}
        sandbox={sandbox ? { name: projectTitle(project), onName: setName, stale } : null}
      />

      <div className="space-y-3 px-3 pt-3">
        <PartidaList draft={draft} groups={groups} open={ui.open} locked={Boolean(locked)} onBlocked={blocked} showErrors onToggle={toggle} onUpdate={updatePartida} onTask={changeTask} onAdd={addPartida} onRemove={removePartida} onPrice={openPrice} result={result} setDraft={setDraft} projectLocation={location} />
        {/* the quick-control grid (Android settings style): each circle opens its content in a bottom sheet */}
        <div className="grid grid-cols-3 gap-4 p-4" data-testid="ws-menu">
        <CrewBlock project={project} result={result} setProject={setProject} open={ui.open.crew} onToggle={toggle} geocode={geocode} />
        <FinanceBlock draft={draft} locked={Boolean(locked)} onBlocked={blocked} setDraft={edit} open={ui.open.finance} onToggle={toggle} />
        <CashBlock projectId={project.id} total={total} payments={project.payments} onChange={setList('payments')} open={ui.open.cash} onToggle={toggle} />
        <LogBlock entries={project.logbook} onChange={setList('logbook')} open={ui.open.log} onToggle={toggle} projectId={project.id} />
        <ExpensesBlock expenses={project.expenses} queued={queued} receipts={receipts} onChange={setList('expenses')} open={ui.open.expenses} onToggle={toggle} />
        <TimelineBlock project={project} setProject={setProject} onBlocked={blocked} open={ui.open.timeline} onToggle={toggle} />
        </div>
        {/* machinery has no module of its own: each task lists the machines it uses; exceptions surface in the tray */}
        <AlertTray alerts={projectAlerts(project, t, { now: Date.now(), budget: result.valid ? total : null, queue: queued, money: (n) => i18n.moneyIn(n, projectMarket(project).currency) }).filter((a) => a.kind !== 'deadline')} />
      </div>

      {sandbox ? <DraftBar onSimulate={simulate} onSave={requestSave} /> : <Dock onOpen={openDock} queued={queued.filter((r) => r.status === 'pending' || r.status === 'sending').length} />}

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
      {ui.sheet === 'export' && <ExportSheet canPdf={result.valid} onExport={exportDoc} onSync={onSyncDossier ? syncDossier : null} syncing={dossierBusy} onClose={closeSheet} />}
      {ui.sheet === 'sign' && <SignatureSheet total={total} pricedAt={priceTime} onSave={onSign} onSkip={onSkipSign} skipLabel={t('ws.sign.skip')} onClose={closeSheet} />}
      {ui.sheet === 'log' && (
        <BottomSheet title={t('log.title')} onClose={closeSheet}>
          <div className="mt-3">
            <Logbook entries={project.logbook} onChange={setList('logbook')} showList={false} onSaved={closeSheet} photoStore={notePhotosFor(project.id)} />
          </div>
        </BottomSheet>
      )}
      {ui.sheet === 'camera' && <PhotoSheet photos={photos} setPhotos={setPhotos} projectId={project.id} onClose={closeSheet} />}
      {ui.sheet === 'scan' && <ReceiptSheet onSave={saveExpenses} existing={project.expenses} onQueue={park} onClose={closeSheet} />}
      {sandbox && namingFor && (
        <DraftNameSheet
          initial=""
          onClose={() => setNamingFor(null)}
          onConfirm={(name) => {
            setNamingFor(null);
            setName(name);
            sandbox.onSave(name);
          }}
        />
      )}
      {sandbox?.leaveAsk && <DraftLeaveSheet onKeep={sandbox.onKeep} onSave={() => { sandbox.onKeep(); requestSave(); }} onDiscard={sandbox.onDiscard} />}
      {confirmNode}
    </main>
  );
}

/**
 * The photo panel: a tall sheet whose header action is the EDIT toggle (a pencil) instead of the classic x. It closes the native way
 * (device Back, swipe down, tap on the backdrop, Escape). The edit mode lives here and only reveals the delete badges of the grid.
 */
export function PhotoSheet({ photos, setPhotos, projectId, onClose }) {
  const { t } = useI18n();
  const [edit, setEdit] = useState(false);
  const count = countPhotos(photos);
  const editing = edit && count > 0; // nothing left to delete: the mode switches itself off
  return (
    <BottomSheet
      title={t('snap.title')}
      onClose={onClose}
      tall
      autoFocus={false}
      headerAction={<PhotoEditToggle active={editing} disabled={count === 0} onToggle={() => setEdit((v) => !v)} />}
    >
      <div className="mt-3" data-testid="photo-sheet">
        <SnapGrid photos={photos} setPhotos={setPhotos} projectId={projectId} editMode={editing} />
      </div>
    </BottomSheet>
  );
}
