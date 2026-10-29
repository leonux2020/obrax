// @vitest-environment node
// The Bitácora as a readable PDF for the Drive expediente: chronological, full text, author, no embedded photos, skipped when empty.
import { File as NodeFile } from 'node:buffer';
import { describe, it, expect } from 'vitest';
import { makeI18n } from '../src/lib/i18n.jsx';
import { buildLogbookModel } from '../src/lib/reports.js';
import { createLogbookPdf } from '../src/lib/reportPdf.js';
import { buildDossierDocuments } from '../src/lib/exportActions.js';
import { newProject } from '../src/lib/projects.js';
import { getRegion } from '../src/lib/regions.js';

globalThis.File ??= NodeFile; // the Excel is built as a File (browsers and recent Node have it)

const i18n = makeI18n('es', 'CL');
const company = { name: 'Aurora SpA', proName: 'Ana Ruiz', taxId: '', phone: '', email: '', city: '', logo: '' };
const T = (ms) => Date.UTC(2026, 9, 1, 12, 0) + ms;
const withLog = (logbook, name = 'Casa Norte') => ({ ...newProject({ regionCode: 'CL', name, now: 1000 }), logbook });
// the list is stored newest first
const sample = () =>
  withLog([
    { id: 'n3', at: T(2 * 86_400_000), text: 'Llegó el cemento. FINALPARRAFO', photo: true },
    { id: 'n2', at: T(86_400_000), text: 'Se vació la losa del primer piso' },
    { id: 'n1', at: T(0), text: 'Inicio de excavación' },
  ]);
const pdfText = (doc) => doc.output();

describe('logbook model', () => {
  it('lists the notes oldest first with date, full text and author; marks which have a photo', () => {
    const m = buildLogbookModel({ project: sample(), company, region: getRegion('CL'), t: i18n.t, date: i18n.date, whenOf: (at) => new Date(at).toISOString().slice(0, 10), title: 'Casa Norte' });
    expect(m.entries.map((e) => e.text)).toEqual(['Inicio de excavación', 'Se vació la losa del primer piso', 'Llegó el cemento. FINALPARRAFO']);
    expect(m.entries.map((e) => e.when)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(m.entries.map((e) => e.photo)).toEqual([false, false, true]);
    expect(m.entries.every((e) => e.author === 'Ana Ruiz')).toBe(true);
    expect(m.count).toBe(3);
    expect(m.project).toBe('Casa Norte');
  });

  it('with no professional on the profile the company is the author; with neither, a dash', () => {
    const base = { project: sample(), region: getRegion('CL'), t: i18n.t, date: i18n.date, whenOf: () => 'x', title: 'P' };
    expect(buildLogbookModel({ ...base, company: { name: 'Aurora SpA' } }).author).toBe('Aurora SpA');
    expect(buildLogbookModel({ ...base, company: {} }).author).toBe('-');
  });

  it('notes written at the same instant keep the order they were written in', () => {
    const p = withLog([{ id: 'b', at: 5, text: 'segunda' }, { id: 'a', at: 5, text: 'primera' }]);
    const m = buildLogbookModel({ project: p, company, region: getRegion('CL'), t: i18n.t, date: i18n.date, whenOf: () => 'x', title: 'P' });
    expect(m.entries.map((e) => e.text)).toEqual(['primera', 'segunda']);
  });
});

describe('logbook PDF', () => {
  it('is named Bitacora_<project>.pdf and contains every note in full, the author and a pointer to Fotos Obra (no image embedded)', async () => {
    const { doc, fileName } = await createLogbookPdf({ project: sample(), title: 'Casa Norte', company, i18n });
    expect(fileName).toBe('Bitacora_Casa-Norte.pdf');
    const text = pdfText(doc);
    expect(text.startsWith('%PDF')).toBe(true);
    for (const word of ['Inicio de excavaci', 'losa del primer piso', 'FINALPARRAFO', 'Ana Ruiz', 'Casa Norte', 'Fotos Obra']) expect(text).toContain(word);
    expect(text).not.toContain('/Subtype /Image'); // photos are separate files in Fotos Obra
    expect(text.indexOf('Inicio de excavaci')).toBeLessThan(text.indexOf('FINALPARRAFO')); // chronological
  });

  it('keeps the whole text of a very long note and flows onto more pages without losing any entry', async () => {
    const long = `${'palabra '.repeat(240)}ULTIMAFRASE`; // ~1900 chars
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, at: T(i * 1000), text: `Entrada ${i} del dia` }));
    const project = withLog([{ id: 'big', at: T(99_999_999), text: long }, ...many.reverse()]);
    const { doc } = await createLogbookPdf({ project, title: 'Obra grande', company, i18n });
    const text = pdfText(doc);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(text).toContain('ULTIMAFRASE');
    expect(text).toContain('Entrada 0 del dia');
    expect(text).toContain('Entrada 59 del dia');
  });
});

describe('the dossier documents', () => {
  const ctx = (project) => ({ project, result: { valid: false }, total: 0, company, photos: [], i18n });
  it('a project with notes also gets Bitacora_<name>.pdf, built in memory, next to the Excel', async () => {
    const docs = await buildDossierDocuments(ctx(sample()));
    const names = docs.map((d) => d.name);
    expect(names).toContain('Bitacora_Casa-Norte.pdf');
    expect(names.some((n) => n.endsWith('.xlsx'))).toBe(true);
    const pdf = docs.find((d) => d.name.startsWith('Bitacora_'));
    expect(pdf.mimeType).toBe('application/pdf');
    expect(pdf.bytes).toBeInstanceOf(Uint8Array);
    expect(String.fromCharCode(...pdf.bytes.slice(0, 4))).toBe('%PDF');
  });

  it('a project without notes gets NO logbook PDF (no empty files)', async () => {
    const docs = await buildDossierDocuments(ctx(withLog([])));
    expect(docs.some((d) => d.name.startsWith('Bitacora_'))).toBe(false);
    expect(docs.some((d) => d.name.endsWith('.xlsx'))).toBe(true);
  });
});
