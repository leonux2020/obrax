// Report models. Pure functions: they turn a computed project into plain, already-formatted data
// that the screen views and the PDF generators render. Keeping them pure makes the confidentiality
// rules testable:
//   CLIENT model    -> chapters + net subtotal + official tax + total. NEVER store names, unit prices,
//                      per-material data, waste or leftovers.
//   TECHNICAL model -> everything the foreman needs: metrics, purchase plan in sale units, store
//                      breakdown, waste, leftovers inventory and the internal cost structure.

import { TASKS } from './tasks.js';
import { chainLabel } from './regions.js';
import { isSignatureCurrent, normalizeInk } from './signature.js';

export const partidaTitle = (p, t) => p.name || t(`task.${p.task}`);

/** Label of a numeric field; tasks may override the generic label (e.g. paint "wall length"). */
export function fieldLabel(t, task, key) {
  const specific = `field.${task}.${key}`;
  return t(specific) !== specific ? t(specific) : t(`field.${key}`);
}

export const optionLabel = (t, task, key) => t(`opt.${task}.${key}`);
export const optionValueLabel = (t, task, key, value) => t(`opt.${task}.${key}.${value}`);

export function companyInfo(company, region, t) {
  const c = company || {};
  const lines = [];
  if (c.taxId) lines.push(`${t(`company.taxId.${region.code}`)}: ${c.taxId}`);
  if (c.phone) lines.push(`${t('company.phone')}: ${c.phone}`);
  if (c.email) lines.push(`${t('company.email')}: ${c.email}`);
  if (c.city) lines.push(c.city);
  // Read-only data of the contractor, always taken from the company profile snapshot of the project.
  return {
    name: c.name || '',
    details: lines,
    taxLine: c.taxId ? `${t(`company.taxId.${region.code}`)}: ${c.taxId}` : '',
    logo: typeof c.logo === 'string' ? c.logo : '',
    signer: c.proName || '', // the professional who signs (own key names: the confidentiality test greps the model for store names)
    signerLine: c.proTaxId ? `${t(`company.taxId.${region.code}`)}: ${c.proTaxId}` : '',
    empty: !c.name && lines.length === 0 && !c.logo && !c.proName,
  };
}

const AREA_METRIC = { slab: 'area', roof: 'roofArea' };

/** Short, geometry-only description of a partida (safe to show to the client). */
export function scopeText(p, t, num) {
  const v = p.values;
  const metric = (k) => p.calc.metrics.find((m) => m.key === k)?.value ?? 0;
  const area = metric(AREA_METRIC[p.task] || 'netArea');
  return t(`com.scope.${p.task}`, {
    thickness: num(v.thickness ?? 0),
    area: num(area),
    faces: t(`faces.${v.faces ?? 2}`),
    material: v.roofing ? t(`opt.roof.roofing.${v.roofing}`) : '',
    slope: num(v.slope ?? 0),
    format: v.format ? t(`opt.floor.format.${v.format}`) : '',
    coats: num(v.coats ?? 0),
  });
}

/** Client-facing budget. */
export function buildClientModel({ draft, result, company, region, t, num, date }) {
  const q = result.quote;
  return {
    kind: 'client',
    heading: t('com.heading'),
    date: date(),
    company: companyInfo(company, region, t),
    projectLabel: t('com.project'),
    project: draft.project.name || result.partidas.map((p) => partidaTitle(p, t)).join(' · ').slice(0, 80),
    clientLabel: t('com.client'),
    client: draft.project.client || '',
    chaptersLabel: t('com.chapters'),
    amountLabel: t('com.amount'),
    chapters: result.partidas.map((p, k) => ({
      n: k + 1,
      title: t('com.chapter', { n: k + 1, title: partidaTitle(p, t) }),
      description: scopeText(p, t, num),
      amount: q.partidas[k].amount,
    })),
    subtotalLabel: t('com.subtotalNet'),
    subtotal: q.subtotal,
    taxLabel: t('com.taxLine', { name: region.taxName, rate: num(q.taxRate * 100) }),
    tax: q.tax,
    totalLabel: t('com.total'),
    total: q.total,
    validity: t('com.valid'),
    // Opt-in aggregate breakdown: totals that add up to the net subtotal. Never stores / unit prices.
    breakdown: draft.showBreakdown
      ? {
          title: t('bd.title'),
          rows: [
            { label: t('bd.materials'), amount: q.materials },
            { label: t('bd.labor'), amount: q.labor },
            ...(q.transport > 0 ? [{ label: t('bd.transport'), amount: q.transport }] : []),
            ...(q.machinery > 0 ? [{ label: t('bd.machinery'), amount: q.machinery }] : []),
          ],
        }
      : null,
    signClient: t('com.sign'),
    signCompany: t('com.signCompany'),
    // who signs for the contractor: the professional if one is on the profile, else the company
    signCompanyData: (() => {
      const c = companyInfo(company, region, t);
      return (c.signer ? [c.signer, c.signerLine || c.taxLine] : [c.name, c.taxLine]).filter(Boolean);
    })(),
    // The contractor's own signature, saved once in the profile: filled in automatically (null when none).
    contractorSignature: normalizeInk(company?.signature),
    // The client's signature is printed only while it still matches the quote it was given on.
    signature: isSignatureCurrent(draft.signature, q.total)
      ? {
          dataUrl: draft.signature.dataUrl,
          w: draft.signature.w,
          h: draft.signature.h,
          name: draft.signature.name,
          idLine: draft.signature.taxId ? `${t('sign.id')} ${draft.signature.taxId}` : '',
          date: draft.signature.at ? date(new Date(draft.signature.at)) : '',
        }
      : null,
    footer: t('report.generatedBy'),
  };
}

/** Plain-text version of the client budget (copy / share). */
export function clientSummaryText(model, money, appName) {
  return [
    model.company.name || null,
    ...model.company.details,
    model.company.empty ? null : '',
    `${appName} - ${model.heading}`,
    `${model.projectLabel}: ${model.project}`,
    model.client ? `${model.clientLabel}: ${model.client}` : null,
    model.date,
    '',
    ...model.chapters.map((c) => `${c.title}: ${money(c.amount)}`),
    '',
    `${model.subtotalLabel}: ${money(model.subtotal)}`,
    `${model.taxLabel}: ${money(model.tax)}`,
    `${model.totalLabel}: ${money(model.total)}`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/** Technical dossier for the contractor / foreman. */
export function buildTechModel({ draft, result, company, region, t, num, unit, money, date }) {
  const q = result.quote;
  const chainName = (id) => chainLabel(region.chains.find((x) => x.id === id) || { id, name: id }, t);
  const qty = (n, base, digits = 2) => `${num(n, digits)} ${unit(base)}`;

  const partidas = result.partidas.map((p, k) => {
    const def = TASKS[p.task];
    const measures = def.fields.map((f) => [fieldLabel(t, p.task, f.key), `${num(p.values[f.key] ?? 0)} ${unit(f.unit)}`]);
    for (const o of def.options) {
      measures.push([optionLabel(t, p.task, o.key), optionValueLabel(t, p.task, o.key, p.values[o.key])]);
    }
    return {
      n: k + 1,
      title: t('com.chapter', { n: k + 1, title: partidaTitle(p, t) }),
      measures,
      metrics: p.calc.metrics.map((m) => [t(`metric.${m.key}`), `${num(m.value, 3)} ${unit(m.unit)}`]),
      waste: `${p.waste}%`,
      materialsCost: q.partidas[k].materials,
    };
  });

  const materials = q.items.map((i) => ({
    name: t(`mat.${i.id}`),
    store: chainName(i.chainId),
    need: qty(i.need, i.baseUnit, 3),
    needWaste: qty(i.needWaste, i.baseUnit, 3),
    buy: `${num(i.packs)} ${unit(i.saleUnit)}`,
    buyDetail: i.saleSize !== 1 ? qty(i.purchased, i.baseUnit) : '',
    leftover: i.leftover / i.saleSize >= 0.01 ? qty(i.leftover, i.baseUnit) : '-',
    unitPrice: `${money(i.unitPrice)} / ${unit(i.saleUnit)}`,
    manual: i.source === 'manual',
    total: i.total,
  }));

  const byStore = new Map();
  for (const i of q.items) {
    const cur = byStore.get(i.chainId) || { store: chainName(i.chainId), items: 0, total: 0 };
    cur.items += 1;
    cur.total += i.total;
    byStore.set(i.chainId, cur);
  }

  const reusable = q.items.filter((i) => i.leftover / i.saleSize >= 0.01);
  const tasksUsed = [...new Set(result.partidas.map((p) => p.task))];

  return {
    kind: 'technical',
    heading: t('tech.heading'),
    date: date(),
    company: companyInfo(company, region, t),
    projectLabel: t('com.project'),
    project: draft.project.name || result.partidas.map((p) => partidaTitle(p, t)).join(' · ').slice(0, 80),
    clientLabel: t('com.client'),
    client: draft.project.client || '',
    modeLabel: t(`mode.${draft.mode}`),
    chainLabel: draft.chainId === 'best' ? t('prices.best') : chainName(draft.chainId),
    partidas,
    materials,
    stores: [...byStore.values()].map((s) => ({ ...s, total: s.total })),
    leftovers: {
      rows: reusable.map((i) => ({
        name: t(`mat.${i.id}`),
        qty: qty(i.leftover, i.baseUnit),
        value: i.leftoverValue,
      })),
      total: q.leftoverValue,
    },
    costs: {
      materials: q.materials,
      labor: q.labor,
      laborPct: draft.finance.labor,
      transport: q.transport,
      transportPct: draft.finance.transport,
      machinery: q.machinery ?? 0,
      subtotal: q.subtotal,
      taxName: region.taxName,
      taxRate: q.taxRate,
      tax: q.tax,
      total: q.total,
    },
    planning: buildPlanningModel({ result, t }),
    machinery: (result.machinery?.items ?? []).map((m) => ({
      name: t(`mach.${m.id}`),
      partida: partidaTitle(result.partidas[m.partida], t),
      qty: m.qty,
      days: m.days,
      rate: m.rate,
      total: m.total,
      included: m.included,
    })),
    notes: tasksUsed.map((id) => t(`note.${id}`)),
    disclaimer: t('prices.disclaimer'),
    footer: t('report.generatedBy'),
  };
}

/** Crew plan for the technical dossier: HH, dead technical time and the site duration, per partida. */
export function buildPlanningModel({ result, t }) {
  const s = result.schedule;
  if (!s) return null;
  return {
    crew: s.crew,
    hoursPerDay: s.hoursPerDay,
    rows: s.rows.map((r) => ({
      n: r.index + 1,
      title: t('com.chapter', { n: r.index + 1, title: partidaTitle(result.partidas[r.index], t) }),
      hh: r.hh,
      activeDays: r.activeDays,
      deadDays: r.deadDays,
      deadNote: r.dead.map((d) => `${t(`sched.dead.${d.key}`)} ${d.days} ${t('sched.d')}`).join(' · '),
    })),
    totals: s.totals,
  };
}
