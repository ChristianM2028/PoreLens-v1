import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_MODES, summarizeSelectedFiles, viewForMode, collapseDiagnostics } from './ui-state.mjs';

test('empty state never exposes demonstration analysis', () => {
  const view = viewForMode(APP_MODES.EMPTY);
  assert.equal(view.workspaceHidden, true);
  assert.match(view.status, /No dataset has been parsed/);
});

test('selected real files hide all synthetic scientific values', () => {
  const summary = summarizeSelectedFiles([{ name: 'manifest.csv' }, { name: 'RDF_CF3_sp3_O2.dat' }]);
  const view = viewForMode(APP_MODES.FILES_SELECTED, summary);
  assert.equal(view.workspaceHidden, true);
  assert.equal(summary.typeSummary, '1 CSV · 1 DAT');
  assert.match(view.status, /selected/);
});

test('synthetic content is only visible in an explicitly labeled mode', () => {
  const view = viewForMode(APP_MODES.SYNTHETIC);
  assert.equal(view.workspaceHidden, false);
  assert.match(`${view.badge} ${view.status}`, /Synthetic.*not calculated from RASPA data/i);
});

test('repeated diagnostics are stacked with a count without losing distinct messages', () => {
  const rows = collapseDiagnostics([
    { severity: 'warning', message: 'Duplicate pressure within component/run: 10 Pa.' },
    { severity: 'warning', message: 'Duplicate pressure within component/run: 10 Pa.' },
    { severity: 'error', message: 'Missing target.' },
  ]);
  assert.deepEqual(rows.map(row => row.count), [2, 1]);
  assert.match(rows[0].message, /Duplicate pressure/);
});

test('instrument workspace exposes context, plots, color meaning, and persistent dataset actions', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  for (const id of ['filesA', 'filesB', 'contextPressure', 'heatmap', 'realRdfCanvas', 'showAnnotations', 'comparison']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /Low-sampling masked/);
  assert.match(html, /Above color limit/);
  assert.doesNotMatch(html, /without guesswork|<section class="hero"/i);
});
