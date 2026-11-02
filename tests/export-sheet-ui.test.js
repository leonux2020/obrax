// @vitest-environment happy-dom
// Export sheet "Zero Stress": clean grey line icons (no emoji), one-line hints, and ONLY the client PDF is highlighted.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ExportSheet from '../src/components/workspace/ExportSheet.jsx';
import { DICT } from '../src/lib/dict.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
let host;
let root;
const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const mount = async (lang = 'it', props = {}) => {
  await act(async () => {
    root.render(h(I18nProvider, { lang, regionCode: 'IT' }, h(ExportSheet, { onExport: async () => 'shared', onClose: () => {}, canPdf: true, onSync: () => {}, ...props })));
  });
};
const EMOJI = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF\uFE0F]/u;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Esporta sheet', () => {
  it('every option has a clean SVG line icon in neutral grey; no emoji anywhere', async () => {
    await mount();
    for (const id of ['export-client', 'export-tech', 'export-xlsx', 'export-drive']) {
      const btn = q(id);
      const svg = btn.querySelector('svg[data-outline-icon="true"]');
      expect(svg, id).not.toBeNull();
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('fill')).toBe('none');
      expect(svg.getAttribute('class')).toContain('text-neutral-400');
      expect(btn.textContent, id).not.toMatch(EMOJI);
    }
    // four different drawings
    const shapes = ['export-client', 'export-tech', 'export-xlsx', 'export-drive'].map((id) => q(id).querySelector('svg').innerHTML);
    expect(new Set(shapes).size).toBe(4);
  });

  it('short hints, exactly as designed (Italian) and one short sentence pair at most in every language', async () => {
    await mount('it');
    expect(q('export-client').textContent).toContain('Nasconde utile e imprevisti. Richiede firma e blocca il preventivo.');
    expect(q('export-tech').textContent).toContain('Mostra il dettaglio completo di utile e imprevisti.');
    expect(q('export-xlsx').textContent).toContain('Esporta pagamenti, spese e saldo.');
    expect(q('export-drive').textContent).toContain('Salva tutti i file e le foto su Google Drive.');
    for (const l of ['es', 'en', 'pt', 'fr', 'it', 'de'])
      for (const k of ['clientHint', 'techHint', 'xlsxHint', 'driveHint']) {
        const s = DICT[l][`ws.export.${k}`];
        expect(s.length, `${l}:${k}`).toBeLessThanOrEqual(80);
        expect(s).not.toContain('›'); // the old breadcrumb is gone
      }
  });

  it('hierarchy: only the client PDF card is highlighted (brand border + green title); Drive is neutral, no green text', async () => {
    await mount();
    expect(q('export-client').className).toContain('border-brand');
    expect(q('export-client').querySelector('span span').className).toContain('text-brand');
    for (const id of ['export-tech', 'export-xlsx', 'export-drive']) {
      const b = q(id);
      expect(b.className, id).toContain('border-white/10');
      expect(b.className, id).not.toMatch(/border-brand/);
      expect(b.innerHTML, id).not.toMatch(/text-brand|text-green|text-emerald/);
      expect(b.dataset.primary).toBeUndefined();
    }
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
    expect(q('export-client').dataset.primary).toBe('true');
  });

  it('all four stay real touch targets and the cloud button only exists when sync is available', async () => {
    await mount();
    for (const id of ['export-client', 'export-tech', 'export-xlsx', 'export-drive']) expect(q(id).className).toContain('min-h-[72px]');
    await mount('it', { onSync: null });
    expect(q('export-drive')).toBeNull();
  });
});
