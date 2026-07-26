import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_MODES, summarizeSelectedFiles, viewForMode } from './ui-state.mjs';

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
