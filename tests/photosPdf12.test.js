// 12 progress photos in the PDFs: 6 per page, titled "(1/2)", "(2/2)", nothing cut by a page break (node environment: jsPDF streams stay readable).
import { describe, it, expect } from 'vitest';
import { makeI18n } from '../src/lib/i18n.jsx';
import { MAX_PHOTOS, emptySlots, photosForReport, putPhoto } from '../src/lib/photos.js';
import { PHOTOS_PER_PAGE, pdfMoneyFormatter, renderClientPdf, renderTechPdf } from '../src/lib/pdf.js';
import { newDraft } from '../src/lib/draft.js';
import { computeAll } from '../src/lib/engine.js';
import { buildClientModel, buildTechModel } from '../src/lib/reports.js';

const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
// jsPDF embeds identical pictures once, so every test photo gets its own bytes (like real ones do)
const variant = (k) => {
  const at = JPEG.indexOf('//////') + 40 + (k % 20);
  return JPEG.slice(0, at) + 'ABCD'[Math.floor(k / 20) % 4] + JPEG.slice(at + 1);
};
const photo = (slot) => ({ slot, dataUrl: slot < 12 ? variant(slot) : JPEG, width: 1080, height: 810, at: 1 });

describe('PDF: 12 photos, paginated', () => {
  const raw = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
  const images = (s) => (s.match(/\/Subtype \/Image/g) || []).length;
  const pages = (s) => (s.match(/\/Type \/Page\b/g) || []).length;

  const ctx = () => {
    const d = newDraft('CL');
    d.partidas[0].dims = { ...d.partidas[0].dims, length: 6, width: 4 };
    const result = computeAll(d, 1_700_000_000_000);
    const i = makeI18n('es', 'CL');
    const money = pdfMoneyFormatter(i.region, i.locale);
    const base = { draft: d, result, company: { name: 'Obra', taxId: '', phone: '', email: '', city: '' }, region: i.region, t: i.t, num: i.num, unit: i.unit, date: i.date };
    const slotsOf = (n) => Array.from({ length: n }, (_, k) => k).reduce((s, k) => putPhoto(s, k, photo(k)), emptySlots());
    return { base, i, money, photosOf: (n) => photosForReport(slotsOf(n), i.t) };
  };

  it('6 per page: 12 photos = 2 photo pages, each titled "(1/2)", "(2/2)"; every picture is embedded', async () => {
    expect(PHOTOS_PER_PAGE).toBe(6);
    const { base, i, money, photosOf } = ctx();
    const tech12 = raw(await renderTechPdf(buildTechModel({ ...base, money }), { t: i.t, num: i.num, money, photos: photosOf(12) }));
    const tech6 = raw(await renderTechPdf(buildTechModel({ ...base, money }), { t: i.t, num: i.num, money, photos: photosOf(6) }));
    expect(images(tech12)).toBe(12);
    expect(tech12).toContain('Registro visual en terreno \\(1/2\\)'); // parentheses are escaped inside a PDF string
    expect(tech12).toContain('Registro visual en terreno \\(2/2\\)');
    expect(tech12).toContain('Avance 12');
    expect(tech6).not.toContain('\\(1/');
    expect(pages(tech12)).toBe(pages(tech6) + 1); // exactly one more page for the second group of six
  });

  it('4 photos stay as before (single grid, no "(1/n)"), 0 photos print nothing, and the client PDF paginates too', async () => {
    const { base, i, money, photosOf } = ctx();
    const four = raw(await renderTechPdf(buildTechModel({ ...base, money }), { t: i.t, num: i.num, money, photos: photosOf(4) }));
    expect(images(four)).toBe(4);
    expect(four).not.toContain('\\(1/');
    const none = raw(await renderTechPdf(buildTechModel({ ...base, money }), { t: i.t, num: i.num, money, photos: [] }));
    expect(images(none)).toBe(0);
    const client = raw(await renderClientPdf(buildClientModel(base), { money, photos: photosOf(12), photosTitle: 'Registro fotografico' }));
    expect(images(client)).toBe(12);
    expect(client).toContain('Registro fotografico \\(2/2\\)');
  });

  it('never more than MAX_PHOTOS even if a caller passes extras', async () => {
    const { base, i, money, photosOf } = ctx();
    const many = [...photosOf(12), ...photosOf(3)];
    const s = raw(await renderTechPdf(buildTechModel({ ...base, money }), { t: i.t, num: i.num, money, photos: many }));
    expect(images(s)).toBe(MAX_PHOTOS);
  });
});

