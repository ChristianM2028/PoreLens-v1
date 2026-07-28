#!/usr/bin/env node
import { discoverDataset } from './ingestion/discovery.mjs';

function usage() { console.error('Usage: poreview scan <dataset-root> [--report] [--json] [--no-cache] [--hash-small-files]'); }
function human(dataset) {
  const lines = [`PoreView dataset: ${dataset.root}`, `Runs: ${dataset.runs.length} · cache reused ${dataset.cache?.reusedRuns ?? 0} · reparsed ${dataset.cache?.reparsedRuns ?? 0}`];
  for (const run of dataset.runs) {
    const ok = message => lines.push(`  OK ${message}`), warn = message => lines.push(`  WARN ${message}`); lines.push(`\n${run.runId}${run.fromCache ? ' [cached]' : ''}`);
    ok('simulation.input parsed'); run.pressurePa == null ? warn('pressure unavailable') : ok(`pressure: ${run.pressurePa} Pa`); run.temperatureK == null ? warn('temperature unavailable') : ok(`temperature: ${run.temperatureK} K`);
    run.framework?.name ? ok(`framework: ${run.framework.name}`) : warn('framework unavailable'); run.components.length ? run.components.forEach(x => ok(`component: ${x.name ?? `(unnamed ${x.index})`}`)) : warn('components unavailable');
    run.pseudoAtomsPath ? ok(`${run.pseudoAtomsPath} parsed`) : warn('pseudo_atoms.def unresolved'); run.mixingRulesPath ? ok(`${run.mixingRulesPath} parsed`) : warn('force-field mixing rules unresolved'); run.moleculeDefinitionPaths.forEach(x => ok(`${x.path} parsed`));
    ok(`${run.rdfRecords.length} RDF files indexed`); run.endToEndRecords.length ? ok(`${run.endToEndRecords.length} end-to-end files indexed`) : warn('EndToEndDistanceHistograms missing'); run.vtkRecords.length ? ok(`${run.vtkRecords.length} VTK files indexed lazily`) : warn('VTKs missing');
    for (const item of run.diagnostics.filter(x => x.severity === 'error' || x.severity === 'fatal')) lines.push(`  ${item.severity.toUpperCase()} ${item.code}: ${item.message}`);
  }
  for (const item of dataset.diagnostics) lines.push(`\n${item.severity.toUpperCase()} ${item.code}: ${item.message}`); return lines.join('\n');
}
const args = process.argv.slice(2), command = args.shift(); if (command !== 'scan' || !args[0] || args.includes('--help')) { usage(); process.exitCode = command === 'scan' && args.includes('--help') ? 0 : 2; } else { const root = args.shift(), json = args.includes('--json'), dataset = await discoverDataset(root, { useCache: !args.includes('--no-cache'), hashSmallFiles: args.includes('--hash-small-files') }); console.log(json ? JSON.stringify(dataset, null, 2) : human(dataset)); if (dataset.diagnostics.some(x => x.severity === 'fatal')) process.exitCode = 1; }
