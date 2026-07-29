import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverDataset } from '../src/import/discovery.mjs';
import { parseSimulationInput } from '../src/import/parsers/simulation_input.mjs';
import { resolveRdfPair } from '../src/import/parsers/rdf.mjs';

const roots = []; test.after(async () => Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))));
async function root() { const value = await mkdtemp(path.join(tmpdir(), 'poreview-ingestion-')); roots.push(value); return value; }
const input = ({ name = 'C6_alk', pressure = 20, components = [name], comments = false } = {}) => `${comments ? '# spacing and capitalization\n' : ''} simulationTYPE MonteCarlo
NumberOfCycles 1000
NumberOfInitializationCycles 100
RestartFile yes
ForceField local
CutOffVDW 12.8
ComputeRDF yes
ComputeEndToEndDistanceHistogram yes
ComputeDensityProfile3DVTKGrid yes
Framework 0
FrameworkName IRMOF-1
UnitCells 1 2 1
ExternalTemperature 300
ExternalPressure ${pressure}
${components.map((component, index) => `Component ${index} MoleculeName ${component}\n  MoleculeDefinition local`).join('\n')}
`;
const pseudo = `# number\n3\n# header\nO1 yes O O 0 15.999 0 0 1 1 0 0 relative 0\nCF3_sp3 yes C C 0 69 0 0 1 1 0 0 relative 0\nCF2_sp3 yes C C 0 50 0 0 1 1 0 0 relative 0\n`;
const mixing = `truncated\nyes\n3\nO1 lennard-jones 30 3.1\nCF3_sp3 lennard-jones 87 4.36\nCF2_sp3 lennard-jones 27.5 4.73\nLorentz-Berthelot\n`;
const molecule = types => `# Number Of Atoms\n${types.length}\n# Number Of Groups\n1\n# group\nflexible\n# number of atoms\n${types.length}\n# atomic positions\n${types.map((type, i) => `${i} ${type}`).join('\n')}\n# Bond stretch: atom n1-n2, type, parameters\n${types.slice(1).map((_, i) => `${i} ${i + 1} FIXED_BOND 1.5`).join('\n')}\n# Intra VDW: atom n1-n2\n`;
async function run(base, relative, options = {}) { const dir = path.join(base, relative); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'simulation.input'), options.text ?? input(options)); await writeFile(path.join(dir, 'pseudo_atoms.def'), pseudo); await writeFile(path.join(dir, 'force_field_mixing_rules.def'), mixing); for (const component of options.components ?? [options.name ?? 'C6_alk']) await writeFile(path.join(dir, `${component}.def`), molecule(['CF3_sp3', 'CF2_sp3', 'CF3_sp3'])); return dir; }

test('simulation.input parser tolerates comments/case and represents mixtures and restart settings', () => { const parsed = parseSimulationInput(input({ components: ['R134a', 'SF6'], pressure: '10 20', comments: true })); assert.deepEqual(parsed.pressureListPa, [10, 20]); assert.deepEqual(parsed.components.map(x => x.name), ['R134a', 'SF6']); assert.equal(parsed.settings.restart, 'yes'); assert.equal(parsed.settings.cutoffA, 12.8); });

test('campaign discovery supports alkane, PFA, arbitrary, mixture, nested and non-numbered runs sorted by parsed pressure', async () => {
  const base = await root(); await run(base, 'campaign/C6/restart-low', { name: 'C6_alk', pressure: 2 }); await run(base, 'campaign/C6/1', { name: 'C6_pfa', pressure: 200 }); await run(base, 'odd/nested/production-final', { name: 'R134a', pressure: 20 }); await run(base, 'mixture/run-x', { components: ['R134a', 'SF6'], pressure: 100 });
  const dataset = await discoverDataset(base); assert.deepEqual(dataset.runs.map(x => x.pressurePa), [2, 20, 100, 200]); assert.equal(dataset.runs.find(x => x.runId.endsWith('run-x')).components.length, 2); assert.equal(dataset.runs.find(x => x.runId.endsWith('production-final')).runNumber, null); assert.equal(dataset.runs.find(x => x.pressurePa === 2).moleculeDefinitions[0].terminalAtomIndices.length, 2);
});

test('partial outputs remain browsable and RDF underscore pairs resolve semantically while VTK stays lazy', async () => {
  const base = await root(), dir = await run(base, 'series/not-numbered', { name: 'C6_pfa' }); await mkdir(path.join(dir, 'results', 'radial_distribution'), { recursive: true }); await writeFile(path.join(dir, 'results', 'radial_distribution', 'RDF_O1_CF3_sp3.dat'), '# bin distance g raw\n0 0.1 0 0\n1 0.2 2 0.5\n'); await mkdir(path.join(dir, 'strange_vtk_outputs'), { recursive: true }); await writeFile(path.join(dir, 'strange_vtk_outputs', 'C6_pfa_500.vtk'), '# vtk DataFile Version 2.0\nfixture\nASCII\nDATASET STRUCTURED_POINTS\nSCALARS density float\n');
  const dataset = await discoverDataset(base), found = dataset.runs[0]; assert.deepEqual(found.rdfRecords[0].pair, ['O1', 'CF3_sp3']); assert.equal(found.rdfRecords[0].pairKind, 'framework-adsorbate'); assert.equal(found.vtkRecords[0].lazy, true); assert.deepEqual(found.vtkRecords[0].fields, ['density']); assert.ok(found.diagnostics.some(x => x.code === 'missing_end_to_end_output'));
});

test('missing outputs, malformed input, and ambiguous definitions produce diagnostics without dropping runs', async () => {
  const base = await root(); await run(base, 'good', { name: 'R134a' }); const malformed = path.join(base, 'bad'); await mkdir(malformed); await writeFile(path.join(malformed, 'simulation.input'), 'ExternalPressure nope\nComponent 0\n'); await writeFile(path.join(malformed, 'one.def'), molecule(['CF3_sp3'])); await writeFile(path.join(malformed, 'two.def'), molecule(['CF3_sp3']));
  const dataset = await discoverDataset(base); assert.equal(dataset.runs.length, 2); const bad = dataset.runs.find(x => x.runId === 'bad'); assert.ok(bad.diagnostics.some(x => x.code === 'missing_pressure')); assert.ok(bad.diagnostics.some(x => x.code === 'missing_component_name')); assert.ok(bad.diagnostics.some(x => x.code.startsWith('unresolved_molecule') || x.code.startsWith('ambiguous_molecule'))); assert.ok(dataset.runs.every(x => x.diagnostics.some(d => d.code === 'missing_rdf_output')));
});

test('duplicate-looking nested runs are indexed once each and cache invalidates after input changes', async () => {
  const base = await root(); await run(base, 'C6/1', { pressure: 100 }); await run(base, 'archive/C6/1', { pressure: 10 }); let dataset = await discoverDataset(base); assert.equal(dataset.runs.length, 2); dataset = await discoverDataset(base); assert.equal(dataset.cache.reusedRuns, 2); const target = path.join(base, 'C6/1/simulation.input'); await new Promise(resolve => setTimeout(resolve, 5)); await writeFile(target, input({ pressure: 300 })); dataset = await discoverDataset(base); assert.equal(dataset.cache.reusedRuns, 1); assert.deepEqual(dataset.runs.map(x => x.pressurePa), [10, 300]); assert.ok(await readFile(path.join(base, '.poreview/index.json'), 'utf8'));
});

test('RDF resolver never splits underscore-bearing pseudoatoms arbitrarily', () => { assert.deepEqual(resolveRdfPair('RDF_CF3_sp3_CF2_sp3.dat', ['CF3_sp3', 'CF2_sp3']).pair, ['CF3_sp3', 'CF2_sp3']); assert.deepEqual(resolveRdfPair('RDF_Framework_CH3_sp3.dat', ['CH3_sp3']).pair, ['Framework', 'CH3_sp3']); });
