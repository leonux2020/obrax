import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { TASKS } from '../../lib/tasks.js';
import { Button, Logo } from '../ui.jsx';

function CompanyBlock({ company, onEditCompany }) {
  const { t, region } = useI18n();
  const has = company && Object.values(company).some(Boolean);
  if (!has) {
    return (
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-neutral-700 px-4 py-3">
        <p className="text-sm text-neutral-300">{t('company.empty')}</p>
        <Button variant="secondary" className="!min-h-[44px] text-sm" onClick={onEditCompany}>
          {t('company.configure')}
        </Button>
      </div>
    );
  }
  const taxLabel = t(`company.taxId.${region.code}`);
  const details = [
    company.taxId && `${taxLabel}: ${company.taxId}`,
    company.phone && `${t('company.phone')}: ${company.phone}`,
    company.email && `${t('company.email')}: ${company.email}`,
    company.city,
  ].filter(Boolean);
  return (
    <div className="mb-4 rounded-xl border border-neutral-800 px-4 py-3" data-testid="company-block">
      {company.name && <p className="break-words text-lg font-extrabold">{company.name}</p>}
      {details.length > 0 && (
        <p className="break-words text-sm text-neutral-300">
          {details.map((d, i) => (
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

function Heading({ title, project, subtitle, company, onEditCompany }) {
  const { t, date } = useI18n();
  return (
    <>
      <CompanyBlock company={company} onEditCompany={onEditCompany} />
      <header className="mb-5 flex items-start gap-4 border-b border-neutral-700 pb-4">
        <Logo size={56} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-extrabold leading-tight sm:text-2xl">{title}</h2>
          {project && <p className="break-words text-lg font-semibold text-brand">{project}</p>}
          <p className="text-sm text-neutral-300">{date()}</p>
          {subtitle}
        </div>
        <span className="sr-only">{t('app.name')}</span>
      </header>
    </>
  );
}

function LeftoverText({ item }) {
  const { num, unit } = useI18n();
  if (item.leftover / item.saleSize < 0.01) return <span className="text-neutral-500">—</span>;
  return (
    <span>
      {num(item.leftover, 2)} {unit(item.baseUnit)}
    </span>
  );
}

function Technical({ draft, result, company, onEditCompany }) {
  const { t, money, num, unit, region } = useI18n();
  const { quote, calc, values } = result;
  const chainLabel =
    draft.chainId === 'best' ? t('prices.best') : region.chains.find((c) => c.id === draft.chainId)?.name;
  const task = TASKS[draft.task];
  // Remnants worth reusing: at least 1% of a sale unit (ignore floating-point crumbs).
  const reusable = quote.items.filter((i) => i.leftover / i.saleSize >= 0.01);

  return (
    <article className="report-sheet card" aria-label={t('report.technical')}>
      <Heading
        title={t('tech.heading')}
        project={draft.project.name || t(`task.${draft.task}`)}
        company={company}
        onEditCompany={onEditCompany}
      />

      <div className="grid gap-5 md:grid-cols-2">
        <section>
          <h3 className="mb-2 text-lg font-bold text-brand">{t('tech.measures')}</h3>
          <dl className="space-y-1">
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-300">{t('tech.task')}</dt>
              <dd className="text-right font-bold">{t(`task.${draft.task}`)}</dd>
            </div>
            {task.fields.map((f) => (
              <div key={f.key} className="flex justify-between gap-3">
                <dt className="text-neutral-300">{t(`field.${f.key}`)}</dt>
                <dd className="font-bold tabular-nums">
                  {num(values[f.key] ?? 0)} {unit(f.unit)}
                </dd>
              </div>
            ))}
            {task.options?.includes('faces') && (
              <div className="flex justify-between gap-3">
                <dt className="text-neutral-300">{t('field.faces')}</dt>
                <dd className="font-bold">{t(`faces.${values.faces}`)}</dd>
              </div>
            )}
          </dl>
        </section>

        <section>
          <h3 className="mb-2 text-lg font-bold text-brand">{t('tech.results')}</h3>
          <dl className="space-y-1">
            {calc.metrics.map((m) => (
              <div key={m.key} className="flex justify-between gap-3">
                <dt className="text-neutral-300">{t(`metric.${m.key}`)}</dt>
                <dd className="font-bold tabular-nums">
                  {num(m.value, 3)} {unit(m.unit)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section className="mt-6">
        <h3 className="mb-1 text-lg font-bold text-brand">{t('tech.materials')}</h3>
        <p className="mb-2 text-sm text-neutral-300">{t('tech.materials.hint')}</p>
        <ul className="divide-y divide-neutral-800 sm:hidden">
          {quote.items.map((i) => (
            <li key={i.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold">{t(`mat.${i.id}`)}</span>
                <span className="shrink-0 font-bold tabular-nums">{money(i.total)}</span>
              </div>
              <p className="mt-1 text-sm text-neutral-300">
                {t('tech.col.need')}: {num(i.need, 3)} {unit(i.baseUnit)} · {t('tech.col.qty')}: {num(i.needWaste, 3)}{' '}
                {unit(i.baseUnit)}
              </p>
              <p className="text-sm text-neutral-300">
                {t('tech.col.buy')}:{' '}
                <b className="text-white">
                  {num(i.packs)} {unit(i.saleUnit)}
                </b>
                {i.saleSize !== 1 && (
                  <span>
                    {' '}
                    ({num(i.purchased, 2)} {unit(i.baseUnit)})
                  </span>
                )}
              </p>
              <p className="text-sm text-brand-light">
                {t('tech.col.leftover')}: <LeftoverText item={i} />
              </p>
              <p className="text-sm text-neutral-300">
                {t('tech.col.price')}: {money(i.unitPrice)} / {unit(i.saleUnit)}
                {i.source === 'manual' && ' *'}
              </p>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-600 text-neutral-300">
                <th className="py-2 pr-2 font-semibold">{t('tech.col.material')}</th>
                <th className="px-2 text-right font-semibold">{t('tech.col.need')}</th>
                <th className="px-2 text-right font-semibold">{t('tech.col.qty')}</th>
                <th className="px-2 text-right font-semibold">{t('tech.col.buy')}</th>
                <th className="px-2 text-right font-semibold">{t('tech.col.leftover')}</th>
                <th className="px-2 text-right font-semibold">{t('tech.col.price')}</th>
                <th className="pl-2 text-right font-semibold">{t('tech.col.total')}</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((i) => (
                <tr key={i.id} className="border-b border-neutral-800 align-top">
                  <td className="py-2 pr-2 font-semibold">{t(`mat.${i.id}`)}</td>
                  <td className="px-2 text-right tabular-nums">
                    {num(i.need, 3)} {unit(i.baseUnit)}
                  </td>
                  <td className="px-2 text-right tabular-nums">
                    {num(i.needWaste, 3)} {unit(i.baseUnit)}
                  </td>
                  <td className="px-2 text-right font-bold tabular-nums">
                    {num(i.packs)} {unit(i.saleUnit)}
                    {i.saleSize !== 1 && (
                      <span className="block text-xs font-normal text-neutral-400">
                        {num(i.purchased, 2)} {unit(i.baseUnit)}
                      </span>
                    )}
                  </td>
                  <td className="px-2 text-right tabular-nums text-brand-light">
                    <LeftoverText item={i} />
                  </td>
                  <td className="px-2 text-right tabular-nums">
                    {money(i.unitPrice)}
                    <span className="block text-xs text-neutral-400">/ {unit(i.saleUnit)}</span>
                    {i.source === 'manual' && <span title={t('tech.manualPrice')}> *</span>}
                  </td>
                  <td className="pl-2 text-right font-bold tabular-nums">{money(i.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          * {t('tech.manualPrice')} · {t('tech.chain')}: {chainLabel}
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-brand/40 bg-brand/5 p-4" data-testid="leftover-summary">
        <h3 className="mb-1 text-lg font-bold text-brand">{t('tech.leftover.title')}</h3>
        {reusable.length === 0 ? (
          <p className="text-sm text-neutral-300">{t('tech.leftover.none')}</p>
        ) : (
          <>
            <ul className="space-y-1 text-sm">
              {reusable.map((i) => (
                <li key={i.id} className="flex justify-between gap-3">
                  <span className="text-neutral-200">{t(`mat.${i.id}`)}</span>
                  <span className="shrink-0 font-bold tabular-nums">
                    {num(i.leftover, 2)} {unit(i.baseUnit)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex justify-between gap-3 border-t border-brand/30 pt-2 font-bold">
              <span>{t('tech.leftover.value')}</span>
              <span className="tabular-nums text-brand">{money(quote.leftoverValue)}</span>
            </p>
            <p className="mt-2 text-xs text-neutral-300">{t('tech.leftover.tip')}</p>
          </>
        )}
      </section>

      <section className="mt-6 grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-lg font-bold text-brand">{t('tech.params')}</h3>
          <dl className="space-y-1">
            {[
              ['fin.waste', draft.finance.waste],
              ['fin.labor', draft.finance.labor],
              ['fin.transport', draft.finance.transport],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-neutral-300">{t(k)}</dt>
                <dd className="font-bold tabular-nums">{v}%</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <dl className="space-y-1">
            {[
              ['fin.materials', quote.materials],
              ['fin.laborLine', quote.labor],
              ['fin.transportLine', quote.transport],
              ['fin.subtotal', quote.subtotal],
              [`${region.taxName} ${num(region.taxRate * 100)}%`, quote.tax],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-neutral-300">{k.includes('.') ? t(k) : k}</dt>
                <dd className="font-bold tabular-nums">{money(v)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-neutral-600 pt-2 text-xl">
              <dt className="font-bold">{t('fin.total')}</dt>
              <dd className="font-extrabold tabular-nums text-brand">{money(quote.total)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="mt-6">
        <h3 className="mb-1 text-lg font-bold text-brand">{t('tech.assumptions')}</h3>
        <p className="text-sm text-neutral-300">{t(`note.${draft.task}`)}</p>
        <p className="mt-2 text-xs text-neutral-400">{t('prices.disclaimer')}</p>
      </section>
    </article>
  );
}

function Commercial({ draft, result, company, onEditCompany }) {
  const { t, money, num, region } = useI18n();
  const { quote, calc, values } = result;
  const metric = (k) => calc.metrics.find((m) => m.key === k)?.value ?? 0;
  const area = draft.task === 'slab' ? metric('area') : metric('netArea');
  const scope = t(`com.scope.${draft.task}`, {
    thickness: num(values.thickness),
    area: num(area),
    faces: t(`faces.${values.faces ?? 2}`),
  });

  const rows = [
    ['com.supply', quote.materials],
    ['com.labor', quote.labor],
    ['com.transport', quote.transport],
  ];

  return (
    <article className="report-sheet card" aria-label={t('report.commercial')}>
      <Heading title={t('com.heading')} project={draft.project.name} company={company} onEditCompany={onEditCompany} />

      <dl className="mb-5 grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-neutral-300">{t('com.client')}</dt>
          <dd className="text-lg font-bold">{draft.project.client || '—'}</dd>
        </div>
        <div>
          <dt className="text-sm text-neutral-300">{t('com.project')}</dt>
          <dd className="text-lg font-bold">{draft.project.name || t(`task.${draft.task}`)}</dd>
        </div>
      </dl>

      <section className="mb-5">
        <h3 className="mb-1 text-lg font-bold text-brand">{t('com.scope')}</h3>
        <p>{scope}</p>
        <p className="mt-2 text-sm text-neutral-300">
          {t('com.includes')}: {quote.items.map((i) => t(`mat.${i.id}`)).join(', ')}.
        </p>
      </section>

      <table className="w-full text-left">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-neutral-800">
              <td className="py-3 text-lg">{t(k)}</td>
              <td className="py-3 text-right text-lg font-bold tabular-nums">{money(v)}</td>
            </tr>
          ))}
          <tr className="border-b border-neutral-800">
            <td className="py-3 text-neutral-300">{t('com.subtotal')}</td>
            <td className="py-3 text-right font-bold tabular-nums">{money(quote.subtotal)}</td>
          </tr>
          <tr className="border-b border-neutral-800">
            <td className="py-3 text-neutral-300">
              {region.taxName} {num(region.taxRate * 100)}%
            </td>
            <td className="py-3 text-right font-bold tabular-nums">{money(quote.tax)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-brand px-4 py-4 text-black">
        <span className="text-lg font-bold">{t('com.total')}</span>
        <span className="text-3xl font-black tabular-nums">{money(quote.total)}</span>
      </div>

      <p className="mt-4 text-sm text-neutral-300">{t('com.valid')}</p>
      <div className="mt-10 w-64 border-t border-neutral-500 pt-1 text-sm text-neutral-300">{t('com.sign')}</div>
    </article>
  );
}

function summaryText({ draft, result, company, region, t, money, date }) {
  const q = result.quote;
  const c = company || {};
  return [
    c.name || null,
    c.taxId ? `${t(`company.taxId.${region.code}`)}: ${c.taxId}` : null,
    c.phone ? `${t('company.phone')}: ${c.phone}` : null,
    c.email ? `${t('company.email')}: ${c.email}` : null,
    c.city || null,
    c.name || c.taxId || c.phone || c.email || c.city ? '' : null,
    `${t('app.name')} - ${t('com.heading')}`,
    `${t('com.project')}: ${draft.project.name || t(`task.${draft.task}`)}`,
    draft.project.client ? `${t('com.client')}: ${draft.project.client}` : null,
    `${t('com.date')}: ${date()}`,
    '',
    `${t('com.supply')}: ${money(q.materials)}`,
    `${t('com.labor')}: ${money(q.labor)}`,
    `${t('com.transport')}: ${money(q.transport)}`,
    `${t('com.subtotal')}: ${money(q.subtotal)}`,
    `${t('com.total')}: ${money(q.total)}`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

export default function StepReport({ draft, result, company, onEditCompany, onNewProject }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [view, setView] = useState('technical');
  const [copied, setCopied] = useState(false);

  if (!result.valid) return null;

  const text = () => summaryText({ draft, result, company, ...i18n });
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: t('app.name'), text: text() });
      else await copy();
    } catch {
      /* user cancelled */
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <section aria-labelledby="rep-title" className="space-y-4">
      <h2 id="rep-title" className="sr-only">
        {t('report.title')}
      </h2>

      <div role="tablist" aria-label={t('report.title')} className="no-print grid grid-cols-2 gap-2">
        {['technical', 'commercial'].map((v) => (
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
            {t(`report.${v}`)}
          </button>
        ))}
      </div>

      {view === 'technical' ? (
        <Technical draft={draft} result={result} company={company} onEditCompany={onEditCompany} />
      ) : (
        <Commercial draft={draft} result={result} company={company} onEditCompany={onEditCompany} />
      )}

      <div className="no-print grid gap-2 sm:grid-cols-3">
        <Button onClick={() => window.print()}>{t('report.print')}</Button>
        <Button variant="secondary" onClick={share}>
          {t('report.share')}
        </Button>
        <Button variant="secondary" onClick={copy}>
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
