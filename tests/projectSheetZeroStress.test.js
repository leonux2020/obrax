// @vitest-environment happy-dom
// ProjectSheet = the same quiet "line of a notebook" fields as ProjectForm: no boxes, no grey fills, room to breathe.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { I18nProvider } from '../src/lib/i18n.jsx';
import ProjectSheet from '../src/components/ProjectSheet.jsx';
import { newProject } from '../src/lib/projects.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host;
let root;
const draw = async (props) => {
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'es', regionCode: 'CL' }, React.createElement(ProjectSheet, { onSave: () => {}, onClose: () => {}, ...props })));
  });
  await act(async () => new Promise((r) => setTimeout(r, 0)));
};
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const fields = (form) => [...form.querySelectorAll('input[type="text"], input[type="date"], input:not([type])')].filter((i) => !i.closest('[role="radiogroup"]') && i.type !== 'hidden');

describe('ProjectSheet: Zero-Stress fields', () => {
  for (const [label, props] of [
    ['new', {}],
    ['edit', { project: newProject({ regionCode: 'CL', name: 'Casa Norte', client: 'Ana', startDate: '2026-11-01', endDate: '2026-12-01' }), onDelete: () => {} }],
  ]) {
    it(`${label}: name, client, dates and city are underlined lines (no box, no grey fill, no field-input)`, async () => {
      await draw(props);
      const form = document.querySelector(`[data-testid="${label}-form"]`);
      expect(form).not.toBeNull();
      const list = fields(form);
      expect(list.length).toBeGreaterThanOrEqual(4); // name, client, start, end (+ city when there is one)
      for (const input of list) {
        expect(input.className, input.outerHTML.slice(0, 80)).toContain('border-b');
        expect(input.className).toContain('border-0');
        expect(input.className).toContain('bg-transparent');
        expect(input.className).toContain('rounded-none');
        expect(input.className).not.toContain('field-input');
      }
      expect(form.className).toContain('space-y-8'); // room to breathe
    });
  }

  it('the source has no box-style field left: no field-input, no grey fill, no extra border', () => {
    const src = readFileSync('src/components/ProjectSheet.jsx', 'utf8');
    expect(src).not.toContain('field-input');
    expect(src).not.toMatch(/\bbg-(?:neutral|gray|zinc|slate|stone)-/);
  });
});
