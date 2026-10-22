import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { buildClientModel, buildTechModel, clientSummaryText } from '../../lib/reports.js';
import { savePdf } from '../../lib/pdf.js';
import { createReportPdf, kindForView, pdfToFile, sharePdfFile, warmPdfEngine } from '../../lib/reportPdf.js';
import { photosForReport, countPhotos } from '../../lib/photos.js';
import { Button, Logo, Switch } from '../ui.jsx';
import SignatureField from '../SignatureField.jsx';

/** On-screen 2x2 photo grid (also what gets printed). */
function PhotoGrid({ title, photos }) {
  if (!photos.length) return null;
  return (
    <section className="mt-6 break-inside-avoid">
      <h3 className="mb-2 text-lg font-bold text-brand">{title}</h3>
      <ul className="grid grid-cols-2 gap-3">
        {photos.map((p) => (
          <li key={p.slot}>
            <img src={p.dataUrl} alt={p.label} className="aspect-[4/3] w-full rounded-lg border border-neutral-800 object-cover" />
            <p className="mt-1 text-sm text-neutral-300">{p.label}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Contractor data (logo, company name, tax ID, contact). STRICTLY READ-ONLY: it is injected from the
 * company profile snapshot of the project (set in Onboarding / Company) and has no buttons or handlers here.
 */
function CompanyBlock({ company }) {
  const { t } = useI18n();
  if (company.empty) {
    return (
      <p className="no-print mb-4 rounded-xl border border-white/10 px-4 py-3 text-sm text-white/40" data-testid="company-block-empty">
        {t('company.empty')}
      </p>
    );
  }
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-white/10 px-4 py-3" data-testid="company-block">
      {company.logo && (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white p-1">
          <img src={company.logo} alt="" className="max-h-full max-w-full object-contain" decoding="async" data-testid="company-logo" />
        </span>
      )}
      <div className="min-w-0">
        {company.name && <p className="break-words text-lg font-extrabold">{company.name}</p>}
        {company.details.length > 0 && (
          <p className="break-words text-sm text-neutral-300">
            {company.details.map((d, i) => (
              <span key={d}>
                {i > 0 && <span aria-hidden="true"> · </span>}
                {d}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

function Heading({ model }) {
  return (
    <>
      <CompanyBlock company={model.company} />
      <header className="mb-5 flex items-start gap-4 border-b border-neutral-700 pb-4">
        {!model.company.logo && <Logo size={56} className="shrink-0" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-extrabold leading-tight sm:text-2xl">{model.heading}</h2>
          <p className="break-words text-lg font-semibold text-brand">{model.project}</p>
          <p className="text-sm text-neutral-300">{model.date}</p>
        </div>
      </header>
    </>
  );
}

function Row({ label, value, strong, muted }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b border-neutral-800 py-2.5 ${strong ? 'text-lg font-bold' : ''}`}>
      <span className={muted ? 'text-neutral-300' : ''}>{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}

/** What the CLIENT receives: chapters, net subtotal, official tax, total. No stores, unit prices or leftovers. */
function ClientView({ model, photos, signatureProps }) {
  const { t, money } = useI18n();
  return (
    <article className="report-sheet card" aria-label={model.heading}>
      <Heading model={model} />
      {model.client && (
        <p className="mb-4">
          <span className="text-neutral-300">{model.clientLabel}: </span>
          <b>{model.client}</b>
        </p>
      )}
      <h3 className="mb-1 text-lg font-bold text-brand">{model.chaptersLabel}</h3>
      <ul>
        {model.chapters.map((c) => (
          <li key={c.n} className="border-b border-neutral-800 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-bold">{c.title}</p>
              <p className="shrink-0 text-lg font-bold tabular-nums">{money(c.amount)}</p>
            </div>
            <p className="text-sm text-neutral-300">{c.description}</p>
          </li>
        ))}
      </ul>
      {model.breakdown && (
        <section className="mt-4" aria-label={model.breakdown.title} data-testid="client-breakdown">
          <h3 className="mb-1 text-lg font-bold text-brand">{model.breakdown.title}</h3>
          {model.breakdown.rows.map((r) => (
            <Row key={r.label} label={r.label} value={money(r.amount)} muted />
          ))}
        </section>
      )}
      <div className="mt-2">
        <Row label={model.subtotalLabel} value={money(model.subtotal)} muted />
        <Row label={model.taxLabel} value={money(model.tax)} muted />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-brand px-4 py-4 text-black">
        <span className="text-lg font-bold">{model.totalLabel}</span>
        <span className="text-3xl font-black tabular-nums">{money(model.total)}</span>
      </div>
      <p className="mt-4 text-sm text-neutral-300">{model.validity}</p>
      <PhotoGrid title={t('photo.pdfClientTitle')} photos={photos} />
      <div className="mt-10 grid gap-8 sm:grid-cols-2">
        {/* contractor: static, read-only data from the company profile */}
        <div data-testid="contractor-sign">
          {model.contractorSignature ? (
            // black ink on transparent: inverted on screen (the sig-img class) so it reads on the black background
            <div className="flex h-20 items-end px-2 pb-1" data-testid="contractor-signature">
              <img
                src={model.contractorSignature.dataUrl}
                alt=""
                width={model.contractorSignature.w}
                height={model.contractorSignature.h}
                draggable={false}
                className="sig-img max-h-full w-auto max-w-full object-contain"
                data-testid="contractor-signature-img"
              />
            </div>
          ) : (
            <div className="hidden h-20 sm:block" />
          )}
          <div className="border-t border-neutral-500 pt-1 text-sm text-neutral-300">
            {model.signCompany}
            {model.signCompanyData.length > 0 && (
              <span className="mt-1 block text-xs">
                {model.signCompanyData.map((line, i) => (
                  <span key={line} className={`block ${i === 0 ? 'font-bold text-white' : ''}`}>
                    {line}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
        {/* client: the box above the line is the (double tap) trigger of the signing canvas */}
        <SignatureField model={model} {...signatureProps} />
      </div>
    </article>
  );
}

/** Contractor / foreman dossier. Internal: contains stores, unit prices, leftovers and cost structure. */
function TechView({ model, photos }) {
  const { t, money, num } = useI18n();
  return (
    <article className="report-sheet card" aria-label={model.heading}>
      <Heading model={model} />
      <p className="mb-4 text-sm text-neutral-300">
        {model.modeLabel} · {t('tech.chain')}: <b className="text-white">{model.chainLabel}</b>
        {model.client && (
          <>
            {' '}
            · {model.clientLabel}: <b className="text-white">{model.client}</b>
          </>
        )}
      </p>

      {model.partidas.map((p) => (
        <section key={p.n} className="mb-5">
          <h3 className="mb-2 text-lg font-bold text-brand">{p.title}</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            {[...p.measures, ...p.metrics].map(([k, v]) => (
              <div key={k}>
                <dt className="text-neutral-400">{k}</dt>
                <dd className="font-bold tabular-nums">{v}</dd>
              </div>
            ))}
            <div>
              <dt className="text-neutral-400">{t('fin.waste')}</dt>
              <dd className="font-bold">{p.waste}</dd>
            </div>
          </dl>
        </section>
      ))}

      <h3 className="mb-1 text-lg font-bold text-brand">{t('pdf.purchasePlan')}</h3>
      <p className="mb-2 text-sm text-neutral-300">{t('tech.materials.hint')}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-600 text-neutral-300">
              <th className="py-2 pr-2">{t('tech.col.material')}</th>
              <th className="py-2 pr-2">{t('pdf.store')}</th>
              <th className="py-2 pr-2">{t('tech.col.need')}</th>
              <th className="py-2 pr-2">{t('tech.col.qty')}</th>
              <th className="py-2 pr-2">{t('tech.col.buy')}</th>
              <th className="py-2 pr-2">{t('tech.col.leftover')}</th>
              <th className="py-2 pr-2">{t('tech.col.price')}</th>
              <th className="py-2 text-right">{t('tech.col.total')}</th>
            </tr>
          </thead>
          <tbody>
            {model.materials.map((m) => (
              <tr key={m.name} className="border-b border-neutral-800 align-top">
                <td className="py-2 pr-2 font-semibold">{m.name}</td>
                <td className="py-2 pr-2">{m.store}</td>
                <td className="py-2 pr-2 tabular-nums">{m.need}</td>
                <td className="py-2 pr-2 tabular-nums">{m.needWaste}</td>
                <td className="py-2 pr-2 font-bold tabular-nums text-brand">
                  {m.buy}
                  {m.buyDetail && <span className="block text-xs font-normal text-neutral-400">({m.buyDetail})</span>}
                </td>
                <td className="py-2 pr-2 tabular-nums">{m.leftover}</td>
                <td className="py-2 pr-2 tabular-nums">
                  {m.unitPrice}
                  {m.manual && <span className="block text-xs text-neutral-400">{t('tech.manualPrice')}</span>}
                </td>
                <td className="py-2 text-right font-bold tabular-nums">{money(m.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mb-1 mt-6 text-lg font-bold text-brand">{t('pdf.stores')}</h3>
      <ul>
        {model.stores.map((s) => (
          <li key={s.store} className="flex justify-between gap-3 border-b border-neutral-800 py-2">
            <span>
              {s.store} <span className="text-sm text-neutral-400">· {s.items} {t('pdf.items').toLowerCase()}</span>
            </span>
            <b className="tabular-nums">{money(s.total)}</b>
          </li>
        ))}
      </ul>

      <h3 className="mb-1 mt-6 text-lg font-bold text-brand">{t('tech.leftover.title')}</h3>
      {model.leftovers.rows.length === 0 ? (
        <p className="text-sm text-neutral-300">{t('tech.leftover.none')}</p>
      ) : (
        <>
          <ul>
            {model.leftovers.rows.map((r) => (
              <li key={r.name} className="flex justify-between gap-3 border-b border-neutral-800 py-2">
                <span>
                  {r.name} <span className="text-sm text-neutral-400">· {r.qty}</span>
                </span>
                <b className="tabular-nums">{money(r.value)}</b>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-neutral-300">
            {t('tech.leftover.value')}: <b className="text-white">{money(model.leftovers.total)}</b> · {t('tech.leftover.tip')}
          </p>
        </>
      )}

      {model.planning && model.planning.totals.hh > 0 && (
        <section data-testid="tech-planning">
          <h3 className="mb-1 mt-6 text-lg font-bold text-brand">{t('sched.title')}</h3>
          <p className="mb-1 text-sm text-neutral-300">
            {t('sched.summary', { days: num(model.planning.totals.totalDays, 1), hh: num(model.planning.totals.hh, 1), n: model.planning.crew })}
          </p>
          <ul>
            {model.planning.rows.filter((r) => r.hh > 0).map((r) => (
              <li key={r.n} className="border-b border-neutral-800 py-2">
                <span className="flex justify-between gap-3">
                  <span>{r.title}</span>
                  <b className="tabular-nums">{num(r.activeDays + r.deadDays, 1)} {t('sched.d')}</b>
                </span>
                <span className="block text-sm text-neutral-400">
                  {num(r.hh, 1)} HH · {t('sched.col.active')}: {num(r.activeDays, 1)}
                  {r.deadDays > 0 && ` · ${t('sched.col.dead')}: ${num(r.deadDays, 1)} (${r.deadNote})`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {model.machinery.some((m) => m.included) && (
        <section data-testid="tech-machinery">
          <h3 className="mb-1 mt-6 text-lg font-bold text-brand">{t('mach.title')}</h3>
          <ul>
            {model.machinery.filter((m) => m.included).map((m) => (
              <li key={`${m.name}-${m.partida}`} className="flex justify-between gap-3 border-b border-neutral-800 py-2">
                <span>
                  {m.name} <span className="text-sm text-neutral-400">· {m.partida} · {t('mach.line', { qty: num(m.qty, 0), days: num(m.days, 0), rate: money(m.rate) })}</span>
                </span>
                <b className="tabular-nums">{money(m.total)}</b>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-neutral-400">{t('mach.nohand')}</p>
        </section>
      )}

      <h3 className="mb-1 mt-6 text-lg font-bold text-brand">{t('pdf.costs')}</h3>
      <Row label={t('fin.materials')} value={money(model.costs.materials)} muted />
      <Row label={`${t('fin.laborLine')} (${model.costs.laborPct}%)`} value={money(model.costs.labor)} muted />
      <Row label={`${t('fin.transportLine')} (${model.costs.transportPct}%)`} value={money(model.costs.transport)} muted />
      {model.costs.machinery > 0 && <Row label={t('mach.total')} value={money(model.costs.machinery)} muted />}
      <Row label={t('com.subtotalNet')} value={money(model.costs.subtotal)} muted />
      <Row
        label={t('fin.taxLine', { name: model.costs.taxName, rate: num(model.costs.taxRate * 100) })}
        value={money(model.costs.tax)}
        muted
      />
      <Row label={t('fin.totalWithTax')} value={money(model.costs.total)} strong />

      <PhotoGrid title={t('photo.pdfTitle')} photos={photos} />

      {model.notes.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-1 text-lg font-bold text-brand">{t('tech.assumptions')}</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-300">
            {model.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="mt-4 text-sm text-neutral-400">{model.disclaimer}</p>
    </article>
  );
}

export default function StepReport({ draft, setDraft, result, pricedAt, photos, company, onNewProject }) {
  const i18n = useI18n();
  const { t, region } = i18n;
  const [view, setView] = useState('client');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(null); // 'download' | 'share' | null: one PDF job at a time
  const job = useRef(false); // synchronous lock (state alone is stale between two quick taps)
  const [pdfError, setPdfError] = useState(false);
  const [shareNote, setShareNote] = useState(false); // the native sheet opened without the file attached

  const ctx = { draft, result, company, region, t: i18n.t, num: i18n.num, unit: i18n.unit, date: i18n.date };
  const clientModel = useMemo(
    () => buildClientModel(ctx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, result, company, i18n]
  );
  const techModel = useMemo(
    () => buildTechModel({ ...ctx, money: i18n.money }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, result, company, i18n]
  );

  const reportPhotos = useMemo(() => photosForReport(photos, i18n.t), [photos, i18n.t]);
  const photoCount = countPhotos(photos);
  useEffect(() => {
    warmPdfEngine();
  }, []);

  if (!result.valid) return null;

  const text = () => clientSummaryText(clientModel, i18n.money, t('app.name'));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };
  // ONE contextual action: the document is the tab that is open at the moment of the tap. The kind and
  // every input are frozen before the first await, so changing tab while generating cannot mix reports.
  const runPdf = async (action) => {
    if (job.current) return;
    job.current = true;
    const kind = kindForView(view);
    const inputs = { draft, result, company, i18n, photos: reportPhotos };
    setBusy(action);
    setPdfError(false);
    setShareNote(false);
    try {
      const { doc, fileName, title } = await createReportPdf(kind, inputs);
      if (action === 'share') {
        // Client budget: its summary text may travel with the share; the internal dossier shares only its title.
        const shareText = kind === 'client' ? text() : draft.project.name || '';
        const outcome = await sharePdfFile(pdfToFile(doc, fileName), { title, text: shareText });
        if (outcome === 'unsupported') savePdf(doc, fileName); // no navigator.share at all: download instead
        else if (outcome === 'shared-text') setShareNote(true); // native sheet opened, but without the PDF attached
      } else {
        savePdf(doc, fileName);
      }
    } catch {
      setPdfError(true);
    } finally {
      job.current = false;
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="rep-title" className="space-y-4">
      <h2 id="rep-title" className="sr-only">
        {t('report.title')}
      </h2>

      <div role="tablist" aria-label={t('report.title')} className="no-print grid grid-cols-2 gap-2">
        {[
          ['client', 'report.commercial'],
          ['tech', 'report.technical'],
        ].map(([v, key]) => (
          <button
            key={v}
            role="tab"
            type="button"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`min-h-[52px] rounded-xl border-2 font-bold transition ${
              view === v ? 'border-brand bg-brand text-black' : 'border-white/10 hover:border-white/30'
            }`}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {view === 'client' ? (
        <ClientView
          model={clientModel}
          photos={draft.attachPhotos ? reportPhotos : []}
          signatureProps={{
            signature: draft.signature,
            total: result.quote.total,
            pricedAt,
            onChange: (signature) => setDraft((d) => ({ ...d, signature })),
          }}
        />
      ) : (
        <TechView model={techModel} photos={reportPhotos} />
      )}

      {photoCount > 0 && (
        <Switch
          checked={!!draft.attachPhotos}
          onChange={(v) => setDraft((d) => ({ ...d, attachPhotos: v, photosChoice: true }))}
          label={t('photo.attach')}
          description={t('photo.attach.desc')}
        />
      )}

      <Switch
        checked={!!draft.showBreakdown}
        onChange={(v) => setDraft((d) => ({ ...d, showBreakdown: v }))}
        label={t('bd.toggle')}
        description={t('bd.toggle.desc')}
        data-testid="breakdown-toggle"
      />

      <div className="no-print space-y-2" data-testid="pdf-actions">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Button className="w-full" disabled={!!busy} onClick={() => runPdf('download')} data-testid="pdf-download">
            {busy === 'download' ? t('pdf.generating') : `⬇ ${t('pdf.download')}`}
          </Button>
          <Button variant="ghost" className="min-w-[132px]" disabled={!!busy} onClick={() => runPdf('share')} data-testid="pdf-share">
            {busy === 'share' ? t('pdf.generating') : t('report.share')}
          </Button>
        </div>
        <p className="text-xs text-neutral-400" data-testid="pdf-hint">
          {view === 'tech' ? t('pdf.techHint') : t('pdf.clientHint')}
        </p>
      </div>
      {shareNote && (
        <p role="status" data-testid="pdf-share-note" className="text-sm text-neutral-300">
          {t('pdf.shareTextOnly')}
        </p>
      )}
      {pdfError && (
        <p role="alert" className="text-sm font-semibold text-red-400">
          {t('pdf.error')}
        </p>
      )}

      <div className="no-print grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => window.print()}>
          {t('report.print')}
        </Button>
        <Button variant="ghost" onClick={copy}>
          {copied ? `✓ ${t('report.copied')}` : t('report.copy')}
        </Button>
      </div>
      <Button
        variant="danger"
        className="no-print w-full"
        onClick={() => {
          if (window.confirm(t('report.confirmNew'))) onNewProject();
        }}
      >
        {t('report.newProject')}
      </Button>
      <p className="no-print text-center text-xs text-neutral-500">{t('report.generatedBy')}</p>
    </section>
  );
}
