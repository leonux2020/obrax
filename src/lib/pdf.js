// PDF generation (A4, white background, print-ready). jsPDF is loaded on demand so it never weighs on
// the initial app load; the service worker still precaches the chunk, so it also works offline.
//
// Two independent documents:
//   renderClientPdf  -> corporate budget for the customer (chapters + net subtotal + VAT + total)
//   renderTechPdf    -> technical dossier for the contractor (purchase plan, stores, waste, leftovers, costs)
// Both are drawn from the pure models in reports.js, so what is (not) in the model is (not) in the file.

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 15;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const C = {
  text: [17, 17, 17],
  muted: [95, 95, 95],
  accent: [21, 128, 61],
  line: [205, 205, 205],
  zebra: [245, 248, 246],
  white: [255, 255, 255],
};

// ---- text safety -----------------------------------------------------------------------------
// Standard PDF fonts only cover WinAnsi. Anything else is transliterated (accents stripped) or '?'.
const WIN_ANSI_EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);

export function pdfSafe(input) {
  const s = String(input ?? '')
    .normalize('NFC')
    .replace(/[\u00a0\u202f\u2009\u2007\u2008\u200a\u2002\u2003]/g, ' ')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '');
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === 0x0a || (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp)) {
      out += ch;
      continue;
    }
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    out += base && base !== ch && /^[\x20-\x7e\xa0-\xff]+$/.test(base) ? base : '?';
  }
  return out;
}

/** "CLP 1.234.567" - ISO code + localised number: unambiguous and always printable in a PDF. */
export function pdfMoneyFormatter(region, locale = region.locale) {
  const fmt = new Intl.NumberFormat(locale, {
    minimumFractionDigits: region.digits,
    maximumFractionDigits: region.digits,
  });
  return (n) => pdfSafe(`${region.currency} ${fmt.format(n)}`);
}

export function pdfFileName(prefix, projectName, date = new Date()) {
  const slug = String(projectName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  // Local calendar date (toISOString would be UTC and shift the day late in the evening).
  const pad = (n) => String(n).padStart(2, '0');
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${prefix}${slug ? `-${slug}` : ''}-${d}.pdf`;
}

// ---- tiny layout engine ------------------------------------------------------------------------
class Writer {
  constructor(doc, appName) {
    this.doc = doc;
    this.appName = appName;
    this.y = MARGIN;
  }

  color(rgb) {
    this.doc.setTextColor(...rgb);
  }

  font(style = 'normal', size = 10) {
    this.doc.setFont('helvetica', style);
    this.doc.setFontSize(size);
  }

  lineHeight(size) {
    return size * 0.42;
  }

  text(str, x, y, opts) {
    this.doc.text(pdfSafe(str), x, y, opts);
  }

  wrap(str, width) {
    return this.doc.splitTextToSize(pdfSafe(str), width);
  }

  ensure(height) {
    if (this.y + height > PAGE_H - MARGIN - 8) {
      this.doc.addPage();
      this.y = MARGIN;
      return true;
    }
    return false;
  }

  rule(color = C.line, width = 0.3) {
    this.doc.setDrawColor(...color);
    this.doc.setLineWidth(width);
    this.doc.line(MARGIN, this.y, PAGE_W - MARGIN, this.y);
  }

  gap(mm) {
    this.y += mm;
  }

  section(title) {
    this.ensure(14);
    this.gap(3);
    this.font('bold', 11.5);
    this.color(C.accent);
    this.text(title, MARGIN, this.y + 4);
    this.y += 6;
    this.rule(C.accent, 0.4);
    this.gap(3);
    this.color(C.text);
  }

  paragraph(str, { size = 9, color = C.text, style = 'normal', width = CONTENT_W, x = MARGIN } = {}) {
    this.font(style, size);
    this.color(color);
    const lines = this.wrap(str, width);
    const lh = this.lineHeight(size);
    for (const line of lines) {
      this.ensure(lh + 1);
      this.text(line, x, this.y + lh);
      this.y += lh;
    }
    this.gap(1.5);
    this.color(C.text);
  }

  /** Two columns of label / value pairs. */
  pairs(rows, { size = 9 } = {}) {
    const colW = (CONTENT_W - 6) / 2;
    const lh = this.lineHeight(size) + 1.2;
    for (let i = 0; i < rows.length; i += 2) {
      this.ensure(lh + 1);
      [rows[i], rows[i + 1]].forEach((row, k) => {
        if (!row) return;
        const x = MARGIN + k * (colW + 6);
        this.font('normal', size);
        this.color(C.muted);
        this.text(row[0], x, this.y + lh - 1);
        this.font('bold', size);
        this.color(C.text);
        this.text(row[1], x + colW, this.y + lh - 1, { align: 'right' });
      });
      this.y += lh;
    }
    this.gap(1);
  }

  /**
   * columns: [{label, width, align}] (widths sum to CONTENT_W). rows: arrays of cells; a cell is a string
   * or {text, sub} (second muted line). Header repeats after a page break.
   */
  table(columns, rows, { size = 8, zebra = true, footerRow = null } = {}) {
    const lh = this.lineHeight(size);
    const pad = 1.6;
    const drawHeader = () => {
      this.ensure(9);
      this.doc.setFillColor(...C.accent);
      this.doc.rect(MARGIN, this.y, CONTENT_W, 6.5, 'F');
      this.font('bold', size);
      this.color(C.white);
      let x = MARGIN;
      for (const col of columns) {
        const tx = col.align === 'right' ? x + col.width - pad : x + pad;
        this.text(col.label, tx, this.y + 4.4, { align: col.align === 'right' ? 'right' : 'left', maxWidth: col.width - 2 * pad });
        x += col.width;
      }
      this.y += 6.5;
      this.color(C.text);
    };

    const measure = (cell, width, bold) => {
      const text = typeof cell === 'object' ? cell.text : cell;
      this.font(bold ? 'bold' : 'normal', size);
      const main = this.wrap(String(text ?? ''), width - 2 * pad);
      const sub = typeof cell === 'object' && cell.sub ? this.wrap(cell.sub, width - 2 * pad) : [];
      return { main, sub };
    };

    const drawRow = (row, index, bold = false) => {
      const cells = row.map((cell, k) => measure(cell, columns[k].width, bold || (typeof cell === 'object' && cell.bold)));
      const lines = Math.max(...cells.map((c) => c.main.length + c.sub.length));
      const h = lines * lh + 2.6;
      if (this.ensure(h + 7)) drawHeader();
      if (zebra && index % 2 === 1) {
        this.doc.setFillColor(...C.zebra);
        this.doc.rect(MARGIN, this.y, CONTENT_W, h, 'F');
      }
      let x = MARGIN;
      cells.forEach((c, k) => {
        const col = columns[k];
        const tx = col.align === 'right' ? x + col.width - pad : x + pad;
        const opts = { align: col.align === 'right' ? 'right' : 'left' };
        let cy = this.y + lh + 0.9;
        this.font(bold ? 'bold' : 'normal', size);
        this.color(C.text);
        for (const line of c.main) {
          this.text(line, tx, cy, opts);
          cy += lh;
        }
        this.font('normal', size - 1);
        this.color(C.muted);
        for (const line of c.sub) {
          this.text(line, tx, cy, opts);
          cy += lh;
        }
        x += col.width;
      });
      this.color(C.text);
      this.y += h;
      this.doc.setDrawColor(...C.line);
      this.doc.setLineWidth(0.15);
      this.doc.line(MARGIN, this.y, PAGE_W - MARGIN, this.y);
    };

    drawHeader();
    rows.forEach((row, i) => drawRow(row, i));
    if (footerRow) drawRow(footerRow, 0, true);
    this.gap(3);
  }

  header(model, { logo, title }) {
    const top = this.y;
    let textX = MARGIN;
    if (logo) {
      try {
        this.doc.addImage(logo, 'PNG', MARGIN, top, 18, 18);
        textX = MARGIN + 22;
      } catch {
        /* logo is decoration only */
      }
    }
    const company = model.company;
    this.font('bold', 14);
    this.color(C.text);
    let cy = top + 5;
    this.text(company.name || this.appName, textX, cy, { maxWidth: 100 });
    this.font('normal', 8.5);
    this.color(C.muted);
    for (const line of company.details) {
      cy += 4;
      this.text(line, textX, cy, { maxWidth: 100 });
    }
    // right block: document title + date
    this.font('bold', 16);
    this.color(C.accent);
    this.text(title, PAGE_W - MARGIN, top + 6, { align: 'right' });
    this.font('normal', 9);
    this.color(C.muted);
    this.text(model.date, PAGE_W - MARGIN, top + 11.5, { align: 'right' });
    this.y = Math.max(cy, top + 18) + 4;
    this.rule(C.accent, 0.8);
    this.gap(4);
    this.color(C.text);
  }

  /** Balanced 2x2 photo grid (images are contained in equal cells, captions below). */
  photoGrid(title, photos) {
    if (!photos || photos.length === 0) return;
    const gutter = 6;
    const cellW = (CONTENT_W - gutter) / 2;
    const imgH = 56;
    const cellH = imgH + 8;
    this.ensure(14 + cellH);
    this.section(title);
    photos.slice(0, 4).forEach((p, i) => {
      const col = i % 2;
      if (col === 0 && i > 0) this.y += cellH + 2;
      if (col === 0) this.ensure(cellH);
      const x = MARGIN + col * (cellW + gutter);
      const y = this.y;
      this.doc.setDrawColor(...C.line);
      this.doc.setLineWidth(0.3);
      this.doc.rect(x, y, cellW, imgH);
      const k = Math.min(cellW / p.width, imgH / p.height);
      const w = p.width * k;
      const h = p.height * k;
      try {
        this.doc.addImage(p.dataUrl, 'JPEG', x + (cellW - w) / 2, y + (imgH - h) / 2, w, h, undefined, 'FAST');
      } catch {
        /* an undecodable photo must never break the document */
      }
      this.font('normal', 8.5);
      this.color(C.muted);
      this.text(p.label, x, y + imgH + 4.5, { maxWidth: cellW });
    });
    this.y += cellH + 4;
    this.color(C.text);
  }

  footers(leftText) {
    const total = this.doc.getNumberOfPages();
    for (let i = 1; i <= total; i += 1) {
      this.doc.setPage(i);
      this.font('normal', 7.5);
      this.color(C.muted);
      this.doc.setDrawColor(...C.line);
      this.doc.setLineWidth(0.2);
      this.doc.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12);
      this.text(leftText, MARGIN, PAGE_H - 8);
      this.text(`${i} / ${total}`, PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' });
    }
  }
}

async function newDoc(title, author) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: typeof document !== 'undefined' }); // readable (uncompressed) in Node so tests can assert on the text
  doc.setProperties({ title: pdfSafe(title), author: pdfSafe(author || ''), creator: 'CUBRAX' });
  return doc;
}

// ---- CLIENT budget ---------------------------------------------------------------------------------
/** @param model buildClientModel() result @param ctx {money, logo, appName} */
export async function renderClientPdf(model, { money, logo = null, appName = 'CUBRAX', photos = [], photosTitle = '' }) {
  const doc = await newDoc(`${model.heading} - ${model.project}`, model.company.name);
  const w = new Writer(doc, appName);
  w.header(model, { logo, title: model.heading.toUpperCase() });

  w.pairs([
    [model.projectLabel, model.project],
    [model.clientLabel, model.client || '-'],
  ], { size: 10 });
  w.gap(2);

  w.section(model.chaptersLabel);
  w.table(
    [
      { label: model.chaptersLabel, width: CONTENT_W - 42 },
      { label: model.amountLabel, width: 42, align: 'right' },
    ],
    model.chapters.map((c) => [{ text: c.title, sub: c.description, bold: true }, money(c.amount)]),
    { size: 9.5 }
  );

  // opt-in: Materials / Labor / Transport totals that add up to the net subtotal (no stores, no unit prices)
  if (model.breakdown) {
    w.gap(2);
    w.table(
      [
        { label: model.breakdown.title, width: CONTENT_W - 42 },
        { label: model.amountLabel, width: 42, align: 'right' },
      ],
      model.breakdown.rows.map((r) => [r.label, money(r.amount)]),
      { size: 9.5, zebra: false }
    );
  }

  // totals block (right aligned)
  w.ensure(34);
  const boxW = 80;
  const bx = PAGE_W - MARGIN - boxW;
  const line = (label, value, bold = false) => {
    w.font(bold ? 'bold' : 'normal', 10);
    w.color(C.text);
    w.text(label, bx, w.y + 4.5, { maxWidth: 40 });
    w.text(value, bx + boxW, w.y + 4.5, { align: 'right' });
    w.y += 7;
  };
  line(model.subtotalLabel, money(model.subtotal));
  line(model.taxLabel, money(model.tax));
  w.doc.setFillColor(...C.accent);
  w.doc.rect(bx - 4, w.y, boxW + 8, 11, 'F');
  w.font('bold', 12);
  w.color(C.white);
  w.text(model.totalLabel, bx, w.y + 7.3);
  w.text(money(model.total), bx + boxW, w.y + 7.3, { align: 'right' });
  w.y += 17;
  w.color(C.text);

  w.paragraph(model.validity, { size: 8.5, color: C.muted });
  w.photoGrid(photosTitle, photos); // only when the caller opted in

  // signature lines (the client's ink sits on top of its line, with name / ID / date underneath)
  const sig = model.signature;
  w.ensure(sig || model.contractorSignature ? 52 : 38);
  w.gap(sig || model.contractorSignature ? 28 : 18);
  const half = (CONTENT_W - 16) / 2;
  const clientX = MARGIN + half + 16;
  const own = model.contractorSignature; // contractor's ink from the profile, auto-filled above their line
  if (own) {
    const k = Math.min(half / own.w, 24 / own.h);
    try {
      w.doc.addImage(own.dataUrl, 'PNG', MARGIN, w.y - own.h * k - 0.5, own.w * k, own.h * k);
    } catch {
      /* an undecodable signature must never break the document */
    }
  }
  if (sig) {
    const k = Math.min(half / sig.w, 24 / sig.h);
    try {
      w.doc.addImage(sig.dataUrl, 'PNG', clientX, w.y - sig.h * k - 0.5, sig.w * k, sig.h * k);
    } catch {
      /* an undecodable signature must never break the document */
    }
  }
  w.doc.setDrawColor(...C.muted);
  w.doc.setLineWidth(0.3);
  w.doc.line(MARGIN, w.y, MARGIN + half, w.y);
  w.doc.line(clientX, w.y, clientX + half, w.y);
  w.font('normal', 8.5);
  w.color(C.muted);
  w.text(model.signCompany, MARGIN, w.y + 4.5, { maxWidth: half });
  w.text(model.signClient, clientX, w.y + 4.5, { maxWidth: half });
  // contractor data, read from the company profile: name and tax ID under their line
  (model.signCompanyData ?? []).forEach((line, i) => {
    w.font(i === 0 ? 'bold' : 'normal', 8);
    w.color(i === 0 ? C.text : C.muted);
    w.text(line, MARGIN, w.y + 9 + i * 4, { maxWidth: half });
  });
  w.font('normal', 8.5);
  w.color(C.muted);
  if (sig) {
    let sy = w.y + 9;
    const extra = [
      [sig.name, 'bold', C.text],
      [sig.idLine, 'normal', C.muted],
      [sig.date, 'normal', C.muted],
    ];
    for (const [text, style, color] of extra) {
      if (!text) continue;
      w.font(style, 8.5);
      w.color(color);
      w.text(text, clientX, sy, { maxWidth: half });
      sy += 4;
    }
  }

  w.footers(`${model.footer}${model.company.name ? ` - ${model.company.name}` : ''}`);
  return doc;
}

// ---- TECHNICAL dossier ------------------------------------------------------------------------------------
/** @param model buildTechModel() result @param ctx {t, money, logo, appName} */
export async function renderTechPdf(model, { t, money, num = (n) => String(n), logo = null, appName = 'CUBRAX', photos = [] }) {
  const doc = await newDoc(`${model.heading} - ${model.project}`, model.company.name);
  const w = new Writer(doc, appName);
  w.header(model, { logo, title: model.heading.toUpperCase() });

  w.pairs([
    [model.projectLabel, model.project],
    [model.clientLabel, model.client || '-'],
    [t('pdf.mode'), model.modeLabel],
    [t('tech.chain'), model.chainLabel],
  ]);

  // geometric metrics per partida
  w.section(t('pdf.metrics'));
  for (const p of model.partidas) {
    w.ensure(22);
    w.font('bold', 10);
    w.color(C.text);
    w.text(`${p.title}  (${t('fin.waste')}: ${p.waste})`, MARGIN, w.y + 4);
    w.y += 6;
    w.pairs([...p.measures, ...p.metrics], { size: 8.5 });
    w.gap(1);
  }

  // purchase plan
  w.section(t('pdf.purchasePlan'));
  w.paragraph(t('tech.materials.hint'), { size: 8, color: C.muted });
  w.table(
    [
      { label: t('tech.col.material'), width: 35 },
      { label: t('tech.col.need'), width: 25, align: 'right' },
      { label: t('tech.col.qty'), width: 20, align: 'right' },
      { label: t('tech.col.buy'), width: 24, align: 'right' },
      { label: t('tech.col.leftover'), width: 19, align: 'right' },
      { label: t('tech.col.price'), width: 30, align: 'right' },
      { label: t('tech.col.total'), width: 28, align: 'right' },
    ],
    model.materials.map((m) => [
      { text: m.name, sub: `${t('pdf.buyAt')}: ${m.store}` },
      m.need,
      m.needWaste,
      { text: m.buy, sub: m.buyDetail },
      m.leftover,
      `${m.unitPrice}${m.manual ? ' *' : ''}`,
      money(m.total),
    ]),
    { size: 7.5, footerRow: [t('prices.materials'), '', '', '', '', '', money(model.costs.materials)] }
  );
  w.paragraph(`* ${t('tech.manualPrice')}`, { size: 7.5, color: C.muted });

  // store breakdown
  w.section(t('pdf.stores'));
  w.table(
    [
      { label: t('pdf.store'), width: CONTENT_W - 70 },
      { label: t('pdf.items'), width: 30, align: 'right' },
      { label: t('tech.col.total'), width: 40, align: 'right' },
    ],
    model.stores.map((s) => [s.store, String(s.items), money(s.total)]),
    { size: 8.5 }
  );

  // leftovers inventory
  w.section(t('tech.leftover.title'));
  if (model.leftovers.rows.length === 0) {
    w.paragraph(t('tech.leftover.none'), { size: 8.5, color: C.muted });
  } else {
    w.table(
      [
        { label: t('tech.col.material'), width: CONTENT_W - 80 },
        { label: t('pdf.leftoverQty'), width: 40, align: 'right' },
        { label: t('pdf.leftoverValue'), width: 40, align: 'right' },
      ],
      model.leftovers.rows.map((r) => [r.name, r.qty, money(r.value)]),
      { size: 8.5, footerRow: [t('tech.leftover.value'), '', money(model.leftovers.total)] }
    );
    w.paragraph(t('tech.leftover.tip'), { size: 8, color: C.muted });
  }

  // crew planning: man-hours vs technical dead time
  if (model.planning && model.planning.totals.hh > 0) {
    const pl = model.planning;
    w.section(t('sched.title'));
    w.paragraph(t('sched.summary', { days: num(pl.totals.totalDays, 1), hh: num(pl.totals.hh, 1), n: pl.crew }), { size: 8.5 });
    w.table(
      [
        { label: t('com.chapters'), width: CONTENT_W - 94 },
        { label: t('sched.col.hh'), width: 20, align: 'right' },
        { label: t('sched.col.active'), width: 26, align: 'right' },
        { label: t('sched.col.dead'), width: 26, align: 'right' },
        { label: t('tech.col.total'), width: 22, align: 'right' },
      ],
      pl.rows
        .filter((r) => r.hh > 0)
        .map((r) => [
          { text: r.title, sub: r.deadNote || undefined },
          num(r.hh, 1),
          num(r.activeDays, 1),
          num(r.deadDays, 1),
          `${num(r.activeDays + r.deadDays, 1)} ${t('sched.d')}`,
        ]),
      { size: 8, footerRow: [t('sched.total'), num(pl.totals.hh, 1), num(pl.totals.activeDays, 1), num(pl.totals.deadDays, 1), `${num(pl.totals.totalDays, 1)} ${t('sched.d')}`] }
    );
    w.paragraph(`${t('sched.note')} ${t('sched.perDay', { h: pl.hoursPerDay })}`, { size: 7.5, color: C.muted });
  }

  // major machinery rental (indirect cost)
  const rented = model.machinery.filter((m) => m.included);
  if (rented.length > 0) {
    w.section(t('mach.title'));
    w.table(
      [
        { label: t('mach.col.machine'), width: CONTENT_W - 88 },
        { label: t('mach.col.days'), width: 16, align: 'right' },
        { label: t('mach.col.rate'), width: 34, align: 'right' },
        { label: t('tech.col.total'), width: 38, align: 'right' },
      ],
      rented.map((m) => [{ text: m.name, sub: `${m.partida} · ${num(m.qty, 0)}` }, num(m.days, 0), money(m.rate), money(m.total)]),
      { size: 8.5, footerRow: [t('mach.total'), '', '', money(model.costs.machinery)] }
    );
    w.paragraph(t('mach.nohand'), { size: 7.5, color: C.muted });
  }

  // internal cost structure
  w.section(t('pdf.costs'));
  const c = model.costs;
  w.table(
    [
      { label: t('pdf.concept'), width: CONTENT_W - 50 },
      { label: t('tech.col.total'), width: 50, align: 'right' },
    ],
    [
      [t('fin.materials'), money(c.materials)],
      [`${t('fin.laborLine')} (${c.laborPct}%)`, money(c.labor)],
      [`${t('fin.transportLine')} (${c.transportPct}%)`, money(c.transport)],
      ...(c.machinery > 0 ? [[t('mach.total'), money(c.machinery)]] : []),
      ...(c.contingency > 0 ? [[`${t('fin.contingencyLine')} (${c.contingencyPct}%)`, money(c.contingency)]] : []),
      ...(c.profit > 0 ? [[`${t('fin.profitLine')} (${c.profitPct}%)`, money(c.profit)]] : []),
      [t('com.subtotalNet'), money(c.subtotal)],
      [t('com.taxLine', { name: c.taxName, rate: num(c.taxRate * 100) }), money(c.tax)],
    ],
    { size: 9, footerRow: [t('fin.total'), money(c.total)] }
  );

  // visual field record
  w.photoGrid(t('photo.pdfTitle'), photos);

  // assumptions
  w.section(t('tech.assumptions'));
  for (const note of model.notes) w.paragraph(note, { size: 8, color: C.muted });
  w.paragraph(model.disclaimer, { size: 8, color: C.muted });

  w.footers(`${model.footer}${model.company.name ? ` - ${model.company.name}` : ''} - ${t('pdf.internal')}`);
  return doc;
}

// ---- LOGBOOK (Bitácora) ------------------------------------------------------------------------------------
/**
 * Clean, corporate list of the Bitácora: Date | Note | Author, oldest first, full text. A note with a photo says where the picture is
 * (the images themselves are not embedded: they are separate files in "Fotos Obra").
 * @param model buildLogbookModel() result
 */
export async function renderLogbookPdf(model, { t, logo = null, appName = 'CUBRAX' }) {
  const doc = await newDoc(`${model.heading} - ${model.project}`, model.author);
  const w = new Writer(doc, appName);
  w.header(model, { logo, title: model.heading.toUpperCase() });
  w.pairs([
    [model.projectLabel, model.project],
    ...(model.client ? [[model.clientLabel, model.client]] : []),
    [model.authorLabel, model.author],
    [model.countLabel, String(model.count)],
  ]);
  w.section(model.heading);
  w.table(
    [
      { label: t('logpdf.col.date'), width: 36 },
      { label: t('logpdf.col.note'), width: CONTENT_W - 36 - 34 },
      { label: t('logpdf.col.author'), width: 34 },
    ],
    model.entries.map((e) => [e.when, { text: e.text, sub: e.photo ? t('logpdf.photo') : undefined }, e.author]),
    { size: 8.5 }
  );
  w.footers(`${model.footer}${model.company.name ? ` - ${model.company.name}` : ''}`);
  return doc;
}

// ---- browser helpers ---------------------------------------------------------------------------------------
/** Rasterise the SVG brand icon to a PNG data URL for the PDF header. Returns null if unavailable. */
export function rasterizeLogo(svgDataUri, size = 160) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        // contain-fit: a wide company logo must not be squashed into the square
        const k = Math.min(size / (img.naturalWidth || size), size / (img.naturalHeight || size));
        const w = Math.max(1, Math.round((img.naturalWidth || size) * k));
        const h = Math.max(1, Math.round((img.naturalHeight || size) * k));
        canvas.getContext('2d').drawImage(img, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = svgDataUri;
  });
}

export function savePdf(doc, fileName) {
  doc.save(fileName);
}
