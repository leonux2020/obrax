import { useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { buildClientModel, buildTechModel, clientSummaryText } from '../../lib/reports.js';
import {
  pdfFileName,
  pdfMoneyFormatter,
  rasterizeLogo,
  renderClientPdf,
  renderTechPdf,
  savePdf,
} from '../../lib/pdf.js';
import { ICON_DATA_URI } from '../../brand/icon.js';
import { photosForReport, countPhotos } from '../../lib/photos.js';
import { Button, Logo } from '../ui.jsx';

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

function CompanyBlock({ company, onEditCompany }) {
  const { t } = useI18n();
  if (company.empty) {
    return (
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-neutral-700 px-4 py-3">
        <p className="text-sm text-neutral-300">{t('company.empty')}</p>
        <Button variant="secondary" className="!min-h-[44px] text-sm" onClick={onEditCompany}>
          {t('company.configure')}
        </Button>
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-xl border border-neutral-800 px-4 py-3" data-testid="company-block">
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
  );
}

function Heading({ model, onEditCompany }) {
  return (
    <>
      <CompanyBlock company={model.company} onEditCompany={onEditCompany} />
      <header className="mb-5 flex items-start gap-4 border-b border-neutral-700 pb-4">
        <Logo size={56} className="shrink-0" />
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
function ClientView({ model, photos, onEditCompany }) {
  const { t, money } = useI18n();
  return (
    <article className="report-sheet card" aria-label={model.heading}>
      <Heading model={model} onEditCompany={onEditCompany} />
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
        <div className="border-t border-neutral-500 pt-1 text-sm text-neutral-300">{model.signCompany}</div>
        <div className="border-t border-neutral-500 pt-1 text-sm text-neutral-300">{model.signClient}</div>
      </div>
    </article>
  );
}

/** Contractor / foreman dossier. Internal: contains stores, unit prices, leftovers and cost structure. */
function TechView({ model, photos, onEditCompany }) {
  const { t, money, num } = useI18n();
  return (
    <article className="report-sheet card" aria-label={model.heading}>
      <Heading model={model} onEditCompany={onEditCompany} />
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

      <h3 className="mb-1 mt-6 text-lg font-bold text-brand">{t('pdf.costs')}</h3>
      <Row label={t('fin.materials')} value={money(model.costs.materials)} muted />
      <Row label={`${t('fin.laborLine')} (${model.costs.laborPct}%)`} value={money(model.costs.labor)} muted />
      <Row label={`${t('fin.transportLine')} (${model.costs.transportPct}%)`} value={money(model.costs.transport)} muted />
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

export default function StepReport({ draft, setDraft, result, photos, company, onEditCompany, onNewProject }) {
  const i18n = useI18n();
  const { t, region, locale, num } = i18n;
  const [view, setView] = useState('client');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(null); // 'client' | 'tech' | null
  const [pdfError, setPdfError] = useState(false);

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
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: t('app.name'), text: text() });
      else await copy();
    } catch {
      /* user cancelled */
    }
  };

  const download = async (kind) => {
    if (busy) return;
    setBusy(kind);
    setPdfError(false);
    try {
      // pdf.js loads the jsPDF engine on demand, so it never weighs on the first paint.
      const logo = await rasterizeLogo(ICON_DATA_URI);
      const money = pdfMoneyFormatter(region, locale);
      const appName = t('app.name');
      const base = { money, logo, appName };
      let doc;
      if (kind === 'client') {
        doc = await renderClientPdf(buildClientModel(ctx), {
          ...base,
          photos: draft.attachPhotos ? reportPhotos : [],
          photosTitle: t('photo.pdfClientTitle'),
        });
      } else {
        doc = await renderTechPdf(buildTechModel({ ...ctx, money }), { ...base, t, num, photos: reportPhotos });
      }
      savePdf(doc, pdfFileName(kind === 'client' ? t('pdf.file.client') : t('pdf.file.tech'), draft.project.name));
    } catch {
      setPdfError(true);
    } finally {
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
              view === v ? 'border-brand bg-brand text-black' : 'border-neutral-700 hover:border-neutral-500'
            }`}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {view === 'client' ? (
        <ClientView model={clientModel} photos={draft.attachPhotos ? reportPhotos : []} onEditCompany={onEditCompany} />
      ) : (
        <TechView model={techModel} photos={reportPhotos} onEditCompany={onEditCompany} />
      )}

      {photoCount > 0 && (
        <label className="no-print card flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            role="switch"
            checked={!!draft.attachPhotos}
            onChange={(e) => setDraft((d) => ({ ...d, attachPhotos: e.target.checked }))}
            className="mt-1 h-6 w-6 shrink-0 accent-green-500"
          />
          <span>
            <span className="block font-bold">{t('photo.attach')}</span>
            <span className="block text-sm text-neutral-400">{t('photo.attach.desc')}</span>
          </span>
        </label>
      )}

      <div className="no-print grid gap-3 sm:grid-cols-2">
        <div>
          <Button className="w-full" disabled={!!busy} onClick={() => download('client')}>
            {busy === 'client' ? t('pdf.generating') : `⬇ ${t('pdf.client')}`}
          </Button>
          <p className="mt-1 text-xs text-neutral-400">{t('pdf.clientHint')}</p>
        </div>
        <div>
          <Button variant="secondary" className="w-full" disabled={!!busy} onClick={() => download('tech')}>
            {busy === 'tech' ? t('pdf.generating') : `⬇ ${t('pdf.tech')}`}
          </Button>
          <p className="mt-1 text-xs text-neutral-400">{t('pdf.techHint')}</p>
        </div>
      </div>
      {pdfError && (
        <p role="alert" className="text-sm font-semibold text-red-400">
          {t('pdf.error')}
        </p>
      )}

      <div className="no-print grid gap-2 sm:grid-cols-3">
        <Button variant="ghost" onClick={() => window.print()}>
          {t('report.print')}
        </Button>
        <Button variant="ghost" onClick={share}>
          {t('report.share')}
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
