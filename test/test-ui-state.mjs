import test from 'node:test';
import assert from 'node:assert/strict';
import {groupDiagnostics} from '../src/core/ui-state.mjs';

test('repeated diagnostics are stacked without losing distinct details', () => {
  const grouped = groupDiagnostics([
    { severity: 'warning', message: 'Duplicate pressure', code: 'duplicate' },
    { severity: 'warning', message: 'Duplicate pressure', code: 'duplicate' },
    { severity: 'error', message: 'Missing RDF', path: 'C5/1/rdf.dat' },
  ]);
  assert.deepEqual(grouped, [
    { severity: 'warning', message: 'Duplicate pressure', code: 'duplicate', count: 2 },
    { severity: 'error', message: 'Missing RDF', path: 'C5/1/rdf.dat', count: 1 },
  ]);
});
