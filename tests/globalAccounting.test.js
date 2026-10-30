// @vitest-environment happy-dom
// Contabilidad Global: HUD (net cash, tax shield, receivables), activity pulse, ordering and the amber / orange signals.
// Everything is deduced from records already stored: pure functions in ledger.js, no schema change.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import GlobalAccounting from '../src/components/GlobalAccounting.jsx';
import { newProject } from '../src/lib/projects.js';
import { DB_VERSION } from '../src/lib/db.js';
import {
  getLastProjectActivity,
  activityKey,
  daysAgo,
  sortByActivity,
  taxIncluded,
  projectTaxReserve,
  globalLiquidity,
  globalBreakdown,
  receivableList,
  globalTaxLabel,
  globalTaxReserve,
  globalReceivables,
  collectionDelay,
  lateCollections,
  projectDateRange,
} from '../src/lib/ledger.js';

const DAY = 86_400_000;
const NOW = new Date(2026, 5, 15, 12).getTime();
const ago = (days, hour = 12) => new Date(2026, 5, 15 - days, hour).getTime();
const mk = (regionCode, extra = {}) => ({ ...newProject({ regionCode, name: extra.name ?? 'Obra', client: 'Cli', now: ago(30) }), ...extra });
const pay = (amount, at) => ({ id: `p${at}${amount}`, amount, at });

describe('Escudo Tributario: impuesto contenido en los cobros reales', () => {
  it('extrae el impuesto del importe bruto: 119 cobrados al 19 % contienen 19', () => {
    expect(taxIncluded(119, 0.19)).toBe(19);
    expect(taxIncluded(1210, 0.21)).toBe(210);
    expect(taxIncluded(100, 0.16)).toBe(13.79); // 100 x 0.16 / 1.16, al centavo
  });

  it('sin cobros, sin tasa o con valores raros el escudo es 0 (nunca NaN ni negativo)', () => {
    expect(taxIncluded(0, 0.19)).toBe(0);
    expect(taxIncluded(-50, 0.19)).toBe(0);
    expect(taxIncluded(100, 0)).toBe(0);
    expect(taxIncluded(undefined, 0.19)).toBe(0);
    expect(taxIncluded('x', 'y')).toBe(0);
  });

  it('usa la tasa de CADA proyecto (CL 19 %, ES 21 %) y suma solo lo realmente cobrado', () => {
    const cl = mk('CL', { payments: [pay(119000, ago(3)), pay(59500, ago(2))] }); // 178.500 cobrados
    const es = mk('ES', { payments: [pay(121, ago(1))] });
    expect(projectTaxReserve(cl)).toBe(28500);
    expect(projectTaxReserve(es)).toBe(21);
    expect(globalTaxReserve([cl, es])).toEqual([
      { currency: 'CLP', regionCode: 'CL', amount: 28500 },
      { currency: 'EUR', regionCode: 'ES', amount: 21 },
    ]);
  });

  it('en mercados con tasa editable respeta la del contratista', () => {
    const us = mk('US', { payments: [pay(110, ago(1))] });
    us.draft.finance = { ...(us.draft.finance || {}), tax: 10 };
    expect(projectTaxReserve(us)).toBe(10);
  });

  it('no cuenta los proyectos finalizados', () => {
    const done = mk('CL', { payments: [pay(119, ago(5))], closedAt: ago(2) });
    const live = mk('CL', { payments: [pay(119, ago(5))] });
    expect(globalTaxReserve([done, live])).toEqual([{ currency: 'CLP', regionCode: 'CL', amount: 19 }]);
  });
});

describe('Pulso de actividad: la interacción real más reciente', () => {
  it('toma la más reciente entre bitácora, gastos, cobros y adelantos', () => {
    const p = mk('CL', {
      logbook: [{ id: 'n1', text: 'a', at: ago(9) }],
      expenses: [{ id: 'e1', amount: 5, at: ago(6) }],
      payments: [pay(10, ago(4))],
      advances: [{ id: 'a1', amount: 3, at: ago(1) }],
    });
    expect(getLastProjectActivity(p)).toBe(ago(1));
    expect(getLastProjectActivity({ ...p, logbook: [...p.logbook, { id: 'n2', text: 'b', at: ago(0, 18) }] })).toBe(ago(0, 18));
  });

  it('un proyecto vacío o sin listas no falla: 0 y sin pulso', () => {
    expect(getLastProjectActivity(mk('CL'))).toBe(0);
    expect(getLastProjectActivity({})).toBe(0);
    expect(getLastProjectActivity(null)).toBe(0);
    expect(getLastProjectActivity({ payments: null, expenses: 'x', logbook: [null, { at: 'basura' }], advances: [{ at: NaN }] })).toBe(0);
    expect(daysAgo(0, NOW)).toBeNull();
  });

  it('cuenta días de calendario: hoy 0, ayer 1, y nunca negativo', () => {
    expect(daysAgo(ago(0, 1), NOW)).toBe(0);
    expect(daysAgo(ago(1, 23), NOW)).toBe(1);
    expect(daysAgo(ago(7), NOW)).toBe(7);
    expect(daysAgo(NOW + 3 * DAY, NOW)).toBe(0);
  });

  it('ordena por el último movimiento (el más reciente primero); sin movimientos cae a la creación y el empate respeta el orden', () => {
    const old = mk('CL', { name: 'vieja', createdAt: ago(40), payments: [pay(1, ago(20))] });
    const fresh = mk('CL', { name: 'fresca', createdAt: ago(40), expenses: [{ id: 'e', amount: 1, at: ago(1) }] });
    const empty = mk('CL', { name: 'vacía', createdAt: ago(10) });
    expect(activityKey(empty)).toBe(ago(10));
    expect(sortByActivity([old, empty, fresh]).map((p) => p.draft.project.name)).toEqual(['fresca', 'vacía', 'vieja']);
    const a = mk('CL', { name: 'a', createdAt: 5 });
    const b = mk('CL', { name: 'b', createdAt: 5 });
    expect(sortByActivity([a, b])).toEqual([a, b]);
    expect(sortByActivity(undefined)).toEqual([]);
  });
});

describe('Liquidez y por cobrar globales', () => {
  it('suma cobros - gastos - adelantos de los proyectos activos, una línea por moneda', () => {
    const a = mk('CL', { payments: [pay(1000, ago(2))], expenses: [{ id: 'e', amount: 300, at: ago(1) }], advances: [{ id: 'a', amount: 200, at: ago(1) }] });
    const b = mk('CL', { payments: [pay(500, ago(2))] });
    const c = mk('ES', { payments: [pay(100, ago(2))], expenses: [{ id: 'e', amount: 130, at: ago(1) }] });
    expect(globalLiquidity([a, b, c])).toEqual([
      { currency: 'CLP', regionCode: 'CL', amount: 1000 },
      { currency: 'EUR', regionCode: 'ES', amount: -30 },
    ]);
  });

  it('proyectos vacíos, sin lista o sin proyectos no rompen: 0 / lista vacía', () => {
    expect(globalLiquidity([])).toEqual([]);
    expect(globalLiquidity(undefined)).toEqual([]);
    expect(globalLiquidity([mk('CL'), { draft: {} }, {}, null])).toEqual([{ currency: 'CLP', regionCode: 'CL', amount: 0 }]); // unknown market: skipped
    expect(globalTaxReserve([mk('CL')])).toEqual([{ currency: 'CLP', regionCode: 'CL', amount: 0 }]);
  });

  it('por cobrar = presupuesto con impuesto - pagos recibidos, sin saldos negativos ni cotizaciones sin valor', () => {
    const a = mk('CL', { payments: [pay(400, ago(2))] });
    const b = mk('CL', { payments: [pay(900, ago(2))] }); // pagó de más: no resta
    const c = mk('CL'); // sin cotización
    const budgets = new Map([[a.id, 1000], [b.id, 500], [c.id, null]]);
    expect(globalReceivables([a, b, c], budgets)).toEqual([{ currency: 'CLP', regionCode: 'CL', amount: 600 }]);
    expect(globalReceivables([a], undefined)).toEqual([{ currency: 'CLP', regionCode: 'CL', amount: 0 }]);
  });

  it('redondea al centavo sin errores de punto flotante', () => {
    const p = mk('ES', { payments: [pay(0.1, ago(1)), pay(0.2, ago(1))], expenses: [{ id: 'e', amount: 0.1, at: ago(1) }] });
    expect(globalLiquidity([p])[0].amount).toBe(0.2);
  });
});

describe('Alerta de cobranza: saldo pendiente y más de 15 días sin abonos', () => {
  it('avisa con los días cuando hay saldo y el último abono es anterior a 15 días', () => {
    const p = mk('CL', { payments: [pay(100, ago(20))] });
    expect(collectionDelay(p, 1000, NOW)).toBe(20);
    expect(collectionDelay(mk('CL', { payments: [pay(100, ago(15))] }), 1000, NOW)).toBe(0); // 15 exactos no es "más de 15"
    expect(collectionDelay(mk('CL', { payments: [pay(100, ago(16))] }), 1000, NOW)).toBe(16);
  });

  it('sin abonos mide desde la creación; sin saldo, finalizado o sin cotización no avisa', () => {
    expect(collectionDelay(mk('CL', { createdAt: ago(30) }), 1000, NOW)).toBe(30);
    expect(collectionDelay(mk('CL', { payments: [pay(1000, ago(40))] }), 1000, NOW)).toBe(0);
    expect(collectionDelay(mk('CL', { createdAt: ago(30), closedAt: ago(2) }), 1000, NOW)).toBe(0);
    expect(collectionDelay(mk('CL', { createdAt: ago(30) }), null, NOW)).toBe(0);
    expect(collectionDelay(mk('CL', { createdAt: ago(30) }), 1000, NOW, 60)).toBe(0);
  });

  it('lateCollections lista solo los proyectos atrasados', () => {
    const late = mk('CL', { payments: [pay(10, ago(30))] });
    const ok = mk('CL', { payments: [pay(10, ago(2))] });
    const budgets = new Map([[late.id, 1000], [ok.id, 1000]]);
    expect(lateCollections([late, ok], budgets, NOW)).toEqual([{ id: late.id, days: 30 }]);
  });
});

describe('Rango de fechas y formato', () => {
  it('rango inicio – término con año al final', () => {
    const r = projectDateRange({ startDate: '2026-03-12', endDate: '2026-04-28' }, 'es');
    expect(r.kind).toBe('range');
    expect(r.text).toContain('12');
    expect(r.text).toContain('28');
    expect(r.text).toContain('2026');
    expect(r.text).toContain('–');
  });

  it('sin fechas explícitas cae a la fecha de creación; sin nada, vacío (nunca lanza)', () => {
    const created = projectDateRange({ createdAt: new Date(2026, 2, 12, 10).getTime() }, 'es');
    expect(created.kind).toBe('created');
    expect(created.text).toContain('2026');
    expect(projectDateRange({}, 'es')).toEqual({ kind: 'none', text: '' });
    expect(projectDateRange(null)).toEqual({ kind: 'none', text: '' });
    expect(projectDateRange({ startDate: '2026-13-45', endDate: 'x', createdAt: 0 }, 'es').kind).toBe('none');
    expect(projectDateRange({ startDate: '2026-03-12' }, 'xx-invalid-locale-').kind).toBe('start');
  });
});

describe('Desglose global (funciones puras)', () => {
  const a = mk('CL', { payments: [pay(119000, ago(2))], expenses: [{ id: 'e', amount: 30000, at: ago(1) }], advances: [{ id: 'v', amount: 9000, at: ago(1) }] });
  const b = mk('ES', { payments: [pay(121, ago(2))] });
  const budgets = new Map([[a.id, 200000], [b.id, 0]]);

  it('cada cifra del desglose coincide con las funciones globales y la fórmula (+) − − = ', () => {
    const rows = globalBreakdown([a, b], budgets);
    const cl = rows.find((x) => x.currency === 'CLP');
    expect(cl).toMatchObject({ received: 119000, spent: 30000, advanced: 9000, liquid: 80000, tax: 19000, receivable: 81000 });
    expect(cl.liquid).toBe(cl.received - cl.spent - cl.advanced);
    expect(rows.map((x) => ({ currency: x.currency, regionCode: x.regionCode, amount: x.liquid }))).toEqual(globalLiquidity([a, b]));
    expect(rows.map((x) => ({ currency: x.currency, regionCode: x.regionCode, amount: x.tax }))).toEqual(globalTaxReserve([a, b]));
    expect(rows.map((x) => ({ currency: x.currency, regionCode: x.regionCode, amount: x.receivable }))).toEqual(globalReceivables([a, b], budgets));
  });

  it('vacío o sin lista no falla', () => {
    expect(globalBreakdown([], undefined)).toEqual([]);
    expect(globalBreakdown(undefined, undefined)).toEqual([]);
    expect(globalBreakdown([mk('CL')], undefined)).toEqual([{ currency: 'CLP', regionCode: 'CL', received: 0, spent: 0, advanced: 0, liquid: 0, tax: 0, receivable: 0 }]);
  });

  it('lista de por cobrar: solo activas con saldo, las atrasadas primero y luego por monto', () => {
    const late = mk('CL', { payments: [pay(10, ago(30))] });
    const big = mk('CL', { payments: [pay(10, ago(1))] });
    const small = mk('CL', { payments: [pay(10, ago(1))] });
    const paid = mk('CL', { payments: [pay(1000, ago(1))] });
    const closed = mk('CL', { closedAt: ago(1) });
    const bud = new Map([[late.id, 500], [big.id, 9000], [small.id, 100], [paid.id, 1000], [closed.id, 5000]]);
    expect(receivableList([small, closed, paid, big, late], bud, NOW).map((x) => x.id)).toEqual([late.id, big.id, small.id]);
    expect(receivableList([late], bud, NOW)[0]).toMatchObject({ pending: 490, late: 30, currency: 'CLP' });
    expect(receivableList([], undefined)).toEqual([]);
  });

  it('identificador tributario: el del país (IVA, VAT...) o vacío si los mercados difieren', () => {
    expect(globalTaxLabel([mk('CL'), mk('ES'), mk('MX')])).toBe('IVA');
    expect(globalTaxLabel([mk('CL', { closedAt: ago(1) }), mk('ES')])).toBe('IVA');
    expect(globalTaxLabel([mk('CL'), mk('GB')])).toBe('');
    expect(globalTaxLabel([])).toBe('');
  });
});

describe('No hay migración de esquema', () => {
  it('IndexedDB v6: solo añade la cola de exportación, sin migrar datos', () => {
    expect(DB_VERSION).toBe(6);
  });
});

describe('Vista Contabilidad Global', () => {
  let host;
  let root;
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const flush = (ms = 0) => act(async () => new Promise((r) => setTimeout(r, ms)));
  const click = async (el) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush(10);
  };
  const render = async (projects) => {
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(GlobalAccounting, { projects })));
    });
    await flush();
  };
  const sized = (p) => {
    p.draft.partidas[0].dims = { ...p.draft.partidas[0].dims, length: 6, width: 4 };
    return p;
  };
  const now = Date.now();
  const back = (days) => now - days * DAY;

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('muestra el HUD de 3 bloques antes de la lista, sin mezclar monedas', async () => {
    const cl = sized(mk('CL', { payments: [pay(119000, back(1))] }));
    const es = sized(mk('ES', { payments: [pay(121, back(1))] }));
    await render([cl, es]);
    const hud = q('acc-hud');
    expect(hud).not.toBeNull();
    expect(hud.compareDocumentPosition(host.querySelector('ul')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(q('acc-liquid-CLP').textContent).toMatch(/119/);
    expect(q('acc-liquid-EUR').textContent).toMatch(/121/);
    expect(q('acc-liquid-CLP').textContent).not.toMatch(/€/);
    expect(q('acc-tax-CLP').textContent).toMatch(/19/);
    expect(q('acc-tax-EUR').textContent).toMatch(/21/);
    expect(q('acc-tax').textContent).not.toContain('A reservar'); // ultra-compact: the explanation lives in the sheet
    expect(q('acc-receivable-CLP')).not.toBeNull();
    expect(hud.className).toContain('border-white/10');
    expect(hud.className).toContain('bg-black');
  });

  it('caja negativa en ámbar suave; positiva en #E0E0E0', async () => {
    const neg = mk('CL', { expenses: [{ id: 'e', amount: 5000, at: back(1) }] });
    await render([neg]);
    expect(q('acc-liquid-CLP').className).toContain('#e8c35f');
    const pos = mk('CL', { payments: [pay(5000, back(1))] });
    await render([pos]);
    expect(q('acc-liquid-CLP').className).toContain('#E0E0E0');
    expect(q('acc-liquid-CLP').className).not.toContain('#e8c35f');
  });

  it('ordena las tarjetas por el último movimiento y muestra fechas + pulso', async () => {
    const old = mk('CL', { name: 'Vieja', payments: [pay(10, back(10))] });
    const fresh = mk('CL', { name: 'Fresca', logbook: [{ id: 'n', text: 'x', at: back(0) }] });
    const mid = mk('CL', { name: 'Media', expenses: [{ id: 'e', amount: 1, at: back(2) }] });
    await render([old, mid, fresh]);
    const order = [...host.querySelectorAll('[data-testid^="acc-row-"]')].map((el) => el.getAttribute('data-testid').slice(8));
    expect(order).toEqual([fresh.id, mid.id, old.id]);
    expect(q(`acc-timeline-${fresh.id}`).textContent).toContain('Activo: hoy');
    expect(q(`acc-timeline-${mid.id}`).textContent).toContain('hace 2 días');
    expect(q(`acc-timeline-${old.id}`).textContent).toContain('hace 10 días');
    expect(q(`acc-timeline-${old.id}`).className).toContain('text-xs');
    expect(q(`acc-timeline-${old.id}`).className).toContain('#E0E0E0]/50');
  });

  it('sin fechas muestra la creación; sin actividad lo dice, sin fallar', async () => {
    const p = mk('CL', { createdAt: new Date(2026, 2, 12, 10).getTime() });
    await render([p]);
    const text = q(`acc-timeline-${p.id}`).textContent;
    expect(text).toContain('Creado el');
    expect(text).toContain('Sin actividad');
  });

  it('borde izquierdo ámbar solo en proyectos con liquidez negativa', async () => {
    const neg = mk('CL', { name: 'Roja', advances: [{ id: 'a', amount: 700, at: back(1) }] });
    const ok = mk('CL', { name: 'Sana', payments: [pay(700, back(1))] });
    await render([neg, ok]);
    expect(q(`acc-row-${neg.id}`).className).toContain('border-l-2');
    expect(q(`acc-row-${neg.id}`).className).toContain('border-l-[#e8c35f]');
    expect(q(`acc-row-${neg.id}`).getAttribute('data-overdrawn')).toBe('true');
    expect(q(`acc-row-${ok.id}`).className).not.toContain('#e8c35f');
  });

  it('badge naranja de cobranza con saldo y más de 15 días sin abonos', async () => {
    const late = sized(mk('CL', { name: 'Atrasada', createdAt: back(40), payments: [pay(10, back(20))] }));
    const fine = sized(mk('CL', { name: 'Al día', createdAt: back(40), payments: [pay(10, back(1))] }));
    await render([late, fine]);
    expect(q(`acc-late-${late.id}`)).not.toBeNull();
    expect(q(`acc-late-${late.id}`).className).toContain('text-orange-400');
    expect(q(`acc-late-${late.id}`).textContent).toContain('20');
    expect(q(`acc-late-${fine.id}`)).toBeNull();
    expect(q('acc-late-badge').getAttribute('aria-label')).toContain('1');
  });

  it('es UN solo rectángulo táctil con 3 columnas sin cajas internas y etiquetas cortas', async () => {
    const cl = sized(mk('CL', { payments: [pay(119000, back(1))] }));
    await render([cl]);
    const hud = q('acc-hud');
    expect(hud.tagName).toBe('BUTTON');
    expect(host.querySelectorAll('[data-testid^="acc-hud"]')).toHaveLength(1);
    for (const c of ['grid-cols-3', 'rounded-2xl', 'border', 'border-white/10', 'bg-black', 'cursor-pointer', 'active:opacity-80', 'text-center']) expect(hud.className).toContain(c);
    for (const id of ['acc-liquid', 'acc-tax', 'acc-receivable']) {
      expect(hud.contains(q(id))).toBe(true);
      expect(q(id).className).not.toMatch(/border|rounded|bg-/); // floating: no per-column box or divider
    }
    const labels = [q('acc-liquid'), q('acc-tax'), q('acc-receivable')].map((el) => el.firstChild);
    labels.forEach((l) => {
      expect(l.className).toContain('uppercase');
      expect(l.className).toContain('text-white/50');
    });
    expect(labels.map((l) => l.textContent.toUpperCase())).toEqual(['DISPONIBLE', 'IVA', 'POR COBRAR']);
  });

  it('el rótulo de impuesto es el del país y cae a uno genérico con mercados distintos', async () => {
    await render([mk('ES')]);
    expect(q('acc-tax').firstChild.textContent).toBe('IVA');
    await render([mk('ES'), mk('GB')]);
    expect(q('acc-tax').firstChild.textContent.toUpperCase()).toBe('IMPUESTOS');
  });

  it('los montos no saltan de línea y reducen la letra cuando son largos (pantallas de 320 px)', async () => {
    const big = mk('CL', { payments: [pay(1234567890, back(1))] });
    const small = mk('ES', { payments: [pay(5, back(1))] });
    await render([big, small]);
    for (const code of ['CLP', 'EUR']) expect(q(`acc-liquid-${code}`).className).toContain('whitespace-nowrap');
    expect(q('acc-liquid-CLP').className).toMatch(/text-\[1[01]px\]|text-xs/);
    expect(q('acc-liquid-EUR').className).toContain('text-sm');
  });

  it('tocar el rectángulo abre la ficha "Desglose Financiero Global" con las tres secciones', async () => {
    const a = sized(mk('CL', { name: 'Casa Norte', createdAt: back(40), payments: [pay(119000, back(20))], expenses: [{ id: 'e', amount: 30000, at: back(20) }], advances: [{ id: 'v', amount: 9000, at: back(20) }] }));
    await render([a]);
    expect(q('acc-sheet')).toBeNull();
    await click(q('acc-hud'));
    expect(q('acc-sheet')).not.toBeNull();
    expect(document.body.textContent).toContain('Desglose Financiero Global');
    expect(q('acc-sheet-in-CLP').textContent).toMatch(/119/);
    expect(q('acc-sheet-exp-CLP').textContent).toMatch(/30/);
    expect(q('acc-sheet-adv-CLP').textContent).toMatch(/9/);
    expect(q('acc-sheet-liquid-CLP').textContent).toMatch(/80/);
    expect(q('acc-sheet-avail').textContent).toContain('Efectivo real para operar hoy');
    expect(q('acc-sheet-taxamt-CLP').textContent).toMatch(/19/);
    expect(q('acc-sheet-tax').textContent).toContain('Monto a apartar para evitar imprevistos fiscales');
    expect(q('acc-sheet-tax').textContent).toContain('IVA');
    expect(q(`acc-sheet-rec-${a.id}`).textContent).toContain('Casa Norte');
    expect(q(`acc-sheet-late-${a.id}`).className).toContain('text-orange-400'); // 20 days without payments
  });

  it('en la ficha una obra al día no lleva el distintivo naranja y sin pendientes lo dice', async () => {
    const fine = sized(mk('CL', { payments: [pay(10, back(1))] }));
    await render([fine]);
    await click(q('acc-hud'));
    expect(q(`acc-sheet-rec-${fine.id}`)).not.toBeNull();
    expect(q(`acc-sheet-late-${fine.id}`)).toBeNull();
    await click(document.querySelector('[data-sheet-close]'));
    await render([mk('CL')]); // no quote yet: nothing to collect
    await click(q('acc-hud'));
    expect(q('acc-sheet-rec').textContent).toContain('Nada pendiente de cobro');
  });

  it('se cierra con ✕ (≥44 px), tocando fuera, Escape y deslizando hacia abajo', async () => {
    await render([sized(mk('CL', { payments: [pay(10, back(1))] }))]);
    const close = () => document.querySelector('[data-sheet-close]');
    const dialog = () => document.querySelector('[role="dialog"]');
    await click(q('acc-hud'));
    expect(close().className).toContain('h-11');
    expect(close().className).toContain('w-11');
    expect(dialog().className).toContain('bg-black');
    await click(close());
    expect(q('acc-sheet')).toBeNull();
    await click(q('acc-hud'));
    await click(q('sheet-backdrop')); // backdrop
    expect(q('acc-sheet')).toBeNull();
    await click(q('acc-hud'));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q('acc-sheet')).toBeNull();
    // swipe down: short drag springs back, long drag closes
    const touch = (type, y) =>
      act(async () => {
        const e = new Event(type, { bubbles: true });
        e.touches = type === 'touchend' ? [] : [{ clientY: y }];
        dialog().dispatchEvent(e);
      });
    await click(q('acc-hud'));
    await touch('touchstart', 100);
    await touch('touchmove', 140);
    await touch('touchend', 140);
    expect(q('acc-sheet')).not.toBeNull();
    await touch('touchstart', 100);
    await touch('touchmove', 260);
    await touch('touchend', 260);
    expect(q('acc-sheet')).toBeNull();
  });

  it('el botón Atrás del dispositivo cierra la ficha sin salir de la vista', async () => {
    await render([sized(mk('CL', { payments: [pay(10, back(1))] }))]);
    await click(q('acc-hud'));
    expect(window.history.state).toMatchObject({ modalOpen: true });
    await act(async () => {
      window.history.back();
    });
    await flush(30);
    expect(q('acc-sheet')).toBeNull();
    expect(q('acc-hud')).not.toBeNull(); // still in Contabilidad Global
    expect(window.history.state?.cubraxLayer).toBeUndefined();
  });

  it('tocar el fondo negro cierra la ficha; tocar dentro de ella no hace nada', async () => {
    await render([sized(mk('CL', { payments: [pay(10, back(1))] }))]);
    await click(q('acc-hud'));
    const backdrop = q('sheet-backdrop');
    for (const inside of [document.querySelector('[role="dialog"]'), q('acc-sheet'), q('acc-sheet-avail'), q('acc-sheet-liquid-CLP')]) {
      await click(inside);
      expect(q('acc-sheet')).not.toBeNull();
    }
    expect(backdrop.contains(document.querySelector('[role="dialog"]'))).toBe(true); // the dialog is a CHILD of the overlay
    await click(backdrop);
    expect(q('acc-sheet')).toBeNull();
  });

  it('cada forma de cerrar (✕, fondo, deslizar) retira la entrada del historial con UN solo history.back()', async () => {
    const dialog = () => document.querySelector('[role="dialog"]');
    const swipe = async () => {
      const touch = (type, y) =>
        act(async () => {
          const e = new Event(type, { bubbles: true });
          e.touches = type === 'touchend' ? [] : [{ clientY: y }];
          dialog().dispatchEvent(e);
        });
      await touch('touchstart', 0);
      await touch('touchmove', 200);
      await touch('touchend', 200);
    };
    const ways = [() => click(document.querySelector('[data-sheet-close]')), () => click(q('sheet-backdrop')), swipe];
    for (const closeIt of ways) {
      window.history.replaceState(null, '');
      const spy = vi.spyOn(window.history, 'back');
      await render([sized(mk('CL', { payments: [pay(10, back(1))] }))]);
      await click(q('acc-hud'));
      expect(window.history.state).toMatchObject({ modalOpen: true });
      await closeIt();
      await flush(30);
      expect(q('acc-sheet')).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(window.history.state?.modalOpen).toBeUndefined(); // no leftover: no "Back twice"
      spy.mockRestore();
    }
  });

  it('el botón Atrás físico (popstate) solo cierra la ficha: no llama history.back otra vez ni se propaga', async () => {
    await render([sized(mk('CL', { payments: [pay(10, back(1))] }))]);
    const spy = vi.spyOn(window.history, 'back');
    const seen = vi.fn();
    window.addEventListener('popstate', seen); // a bubbling listener = "the rest of the app"
    await click(q('acc-hud'));
    await act(async () => {
      window.history.back(); // the device's back: the real pop, not our own
    });
    await flush(30);
    spy.mockClear();
    window.removeEventListener('popstate', seen);
    expect(q('acc-sheet')).toBeNull();
    expect(q('acc-hud')).not.toBeNull();
    expect(spy).not.toHaveBeenCalled(); // the entry was already consumed by the user's Back
    expect(seen).not.toHaveBeenCalled(); // consumed: stopImmediatePropagation
  });

  it('cerrar con ✕ retira la entrada del historial (no se acumula) y no toca el marcador de proyecto', async () => {
    await render([sized(mk('CL', { payments: [pay(10, back(1))] }))]);
    await click(q('acc-hud'));
    await click(document.querySelector('[data-sheet-close]'));
    await flush(50);
    expect(window.history.state?.cubraxLayer).toBeUndefined();
    expect(window.history.state?.cubraxProject).toBeUndefined();
  });

  it('si la vista se desmonta con la ficha abierta tampoco deja basura en el historial', async () => {
    await render([sized(mk('CL', { payments: [pay(10, back(1))] }))]);
    await click(q('acc-hud'));
    expect(window.history.state?.cubraxLayer).toBeTruthy();
    await render([]); // same root: the GlobalAccounting stays, the sheet goes away with the list
    await flush(50);
    expect(window.history.state?.cubraxLayer).toBeUndefined();
  });

  it('con una lista vacía solo se ve el estado vacío (sin HUD)', async () => {
    await render([]);
    expect(q('acc-empty')).not.toBeNull();
    expect(q('acc-hud')).toBeNull();
  });

  it('un proyecto totalmente vacío se renderiza sin errores', async () => {
    const p = mk('CL');
    p.draft.project = {};
    delete p.startDate;
    await render([p, { ...mk('CL'), logbook: undefined, payments: undefined, expenses: undefined, advances: undefined }]);
    expect(q('acc-hud')).not.toBeNull();
    expect(host.textContent).not.toMatch(/NaN|undefined/);
  });
});
