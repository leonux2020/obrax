// The captions of the field photos in the technical report and the client budget: small dark-grey italics under each picture, nothing reserved for a
// photo with no caption, and rows tall enough that a caption never touches the next row (node environment: the jsPDF streams stay readable).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeI18n } from '../src/lib/i18n.jsx';
import { emptySlots, photosForReport, putPhoto } from '../src/lib/photos.js';
import { CAPTION_PT, pdfMoneyFormatter, renderClientPdf, renderTechPdf } from '../src/lib/pdf.js';
import { newDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { buildClientModel, buildTechModel } from '../src/lib/reports.js';

// every drawing call of every jsPDF document is recorded (with the page it landed on): the tests read the layout, not the bytes
const rec = vi.hoisted(() => ({ calls: [] }));
vi.mock('jspdf', async (orig) => {
  const mod = await orig();
  class Spy extends mod.jsPDF {
    constructor(...a) {
      super(...a);
      for (const m of ['text', 'addImage', 'setFont', 'setFontSize', 'setTextColor']) {
        const f = this[m];
        this[m] = (...args) => {
          rec.calls.push({ m, args, page: this.internal.getCurrentPageInfo().pageNumber });
          return f.apply(this, args);
        };
      }
    }
  }
  return { ...mod, jsPDF: Spy };
});
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const variant = (k) => {
  const at = JPEG.indexOf('//////') + 40 + (k % 20);
  return JPEG.slice(0, at) + 'ABCD'[Math.floor(k / 20) % 4] + JPEG.slice(at + 1);
};
const raw = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
const pages = (s) => (s.match(/\/Type \/Page\b/g) || []).length;
const stable = (s) => s.replace(/\/CreationDate[^\n]*\n?/g, '').replace(/\/ID \[[^\]]*\]/g, '').replace(/D:\d{14}[^)]*/g, '');

const ctx = () => {
  const d = newDraft('CL');
  d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
  const result = computeAll(d, 1_700_000_000_000);
  const i = makeI18n('es', 'CL');
  const money = pdfMoneyFormatter(i.region, i.locale);
  const base = { draft: d, result, company: { name: 'Obra', taxId: '', phone: '', email: '', city: '' }, region: i.region, t: i.t, num: i.num, unit: i.unit, date: i.date };
  // n photos; `desc(k)` gives the caption of the k-th (undefined = a photo with none)
  const photos = (n, desc = () => undefined) =>
    photosForReport(
      Array.from({ length: n }, (_, k) => k).reduce((s, k) => putPhoto(s, k, { slot: k, dataUrl: variant(k), width: 1080, height: 810, at: 1, description: desc(k) }), emptySlots()),
      i.t,
    );
  const tech = async (ph) => renderTechPdf(buildTechModel({ ...base, money }), { t: i.t, num: i.num, money, photos: ph });
  const client = async (ph) => renderClientPdf(buildClientModel(base), { money, photos: ph, photosTitle: 'Registro fotografico' });
  return { tech, client, photos };
};

beforeEach(() => {
  rec.calls.length = 0;
});

/** The caption lines (the only text the report draws in italics) with the font / size / colour in force when they were drawn. */
const captionDraws = () => {
  const out = [];
  let font = null;
  let size = null;
  let color = null;
  for (const c of rec.calls) {
    if (c.m === 'setFont') font = c.args[1];
    else if (c.m === 'setFontSize') size = c.args[0];
    else if (c.m === 'setTextColor') color = c.args.slice(0, 3);
    else if (c.m === 'text' && typeof c.args[0] === 'string' && font === 'italic') out.push({ page: c.page, x: c.args[1], y: c.args[2], str: c.args[0], font, size, color, align: c.args[3]?.align });
  }
  return out;
};
const italicUsed = () => rec.calls.some((c) => c.m === 'setFont' && c.args[1] === 'italic');

describe('captions in the PDF', () => {
  it('a caption is printed under its photo: italic, 8.5 pt, dark grey (not black), centred; both documents', async () => {
    const { tech, client, photos } = ctx();
    for (const make of [tech, client]) {
      rec.calls.length = 0;
      const s = raw(await make(photos(2, (k) => `Armadura del eje ${k} lista`)));
      expect(s).toContain('Armadura del eje 0 lista');
      expect(s).toContain('Armadura del eje 1 lista');
      const draws = captionDraws();
      expect(draws).toHaveLength(2);
      for (const d of draws) {
        expect(d.font).toBe('italic');
        expect(d.size).toBe(CAPTION_PT);
        expect(d.size).toBeGreaterThanOrEqual(8);
        expect(d.size).toBeLessThanOrEqual(9);
        expect(d.color).toEqual([64, 64, 64]); // dark grey: neither pure black nor the label's lighter grey
        expect(d.align).toBe('center');
      }
    }
  });

  it('no description = nothing extra: the file is identical to one without the field (blank / null / numbers count as none) and the italic face is never used', async () => {
    const { tech, photos } = ctx();
    const none = stable(raw(await tech(photos(5))));
    expect(italicUsed()).toBe(false);
    for (const junk of ['', '   ', '\n\t', null, 7, {}]) expect(stable(raw(await tech(photos(5, () => junk))))).toBe(none);
    expect(italicUsed()).toBe(false);
  });

  it('accents and symbols a PDF font cannot draw never break it (transliterated)', async () => {
    const { tech, photos } = ctx();
    const s = raw(await tech(photos(1, () => 'Cañería nº 3 — válvula ✓')));
    expect(captionDraws()).toHaveLength(1);
    expect(s).not.toContain('\u2713');
  });

  it('twelve long captions: the second group of six is still ONE page (6 per page), every picture embedded, every caption present and nothing cut', async () => {
    const { tech, photos } = ctx();
    const long = (k) => `CAP${k} ${'zanja terminada hasta el eje tres con encofrado revisado '.repeat(5)}`.slice(0, 280);
    const t12 = raw(await tech(photos(12, long)));
    expect((t12.match(/\/Subtype \/Image/g) || []).length).toBe(12);
    const imgs = rec.calls.filter((c) => c.m === 'addImage');
    expect(new Set(imgs.slice(6).map((c) => c.page)).size).toBe(1); // photos 7-12: one page, the pictures shrink a little instead of spilling
    expect(imgs[6].args[5]).toBeLessThan(58); // shrunk (long captions) ...
    expect(imgs[6].args[5]).toBeGreaterThanOrEqual(44); // ... but never squeezed below the floor
    for (let k = 0; k < 12; k += 1) expect(t12).toContain(`CAP${k} `);
    const shown = captionDraws().filter((d) => /^CAP7 /.test(d.str) || d.page === imgs[6].page);
    expect(shown.length).toBeGreaterThan(0);
    expect(t12).toContain('\\(2/2\\)');
  });

  it('layout: every caption line sits under its own picture and a clear gap above the picture of the next row, inside the page (mixed captions, both documents)', async () => {
    const { tech, client, photos } = ctx();
    const mixed = (k) => (k % 3 === 0 ? `CAP${k} ${'zanja terminada hasta el eje tres con encofrado revisado '.repeat(5)}`.slice(0, 280) : k % 3 === 1 ? `CAP${k} corto` : undefined);
    for (const make of [tech, client]) {
      rec.calls.length = 0;
      await make(photos(12, mixed));
      const imgs = rec.calls.filter((c) => c.m === 'addImage').map((c) => ({ page: c.page, y: c.args[3], h: c.args[5] }));
      const lines = captionDraws();
      expect(imgs).toHaveLength(12);
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) {
        const onPage = imgs.filter((im) => im.page === l.page);
        const above = onPage.filter((im) => im.y + im.h <= l.y + 0.01);
        expect(above.length).toBeGreaterThan(0); // below a picture
        const rowTop = Math.max(...above.map((im) => im.y));
        const nextRow = onPage.filter((im) => im.y > rowTop + 20).map((im) => im.y); // the other cell of the SAME row is at the same height
        if (nextRow.length) expect(Math.min(...nextRow) - l.y).toBeGreaterThan(3); // caption baseline + descender stay clear of the next row
        expect(l.y).toBeLessThanOrEqual(297 - 15 - 8); // inside the page
      }
    }
  });
});
