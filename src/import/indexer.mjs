import fs from 'node:fs/promises';
import path from 'node:path';
import { SimulationRun } from './models.mjs?rev=literature-markers-v3';
import { diagnostic } from './diagnostics.mjs?rev=literature-markers-v3';
import { parseSimulationInput } from './parsers/simulation_input.mjs?rev=literature-markers-v3';
import { parsePseudoAtoms } from './parsers/pseudo_atoms.mjs?rev=literature-markers-v3';
import { parseMixingRules } from './parsers/mixing_rules.mjs?rev=literature-markers-v3';
import { parseMoleculeDefinition } from './parsers/molecule_definition.mjs?rev=literature-markers-v3';
import { indexRdf } from './parsers/rdf.mjs?rev=literature-markers-v3';
import { indexEndToEnd } from './parsers/end_to_end.mjs?rev=literature-markers-v3';
import { indexVtk } from './parsers/vtk.mjs?rev=literature-markers-v3';
import { resolveRunInputs } from './resolver.mjs?rev=literature-markers-v3';
import { fingerprint } from './cache.mjs?rev=literature-markers-v3';

const rel = (root, value) => value ? path.relative(root, value).split(path.sep).join('/') : null;
async function walk(root, nestedRuns, output = []) { for (const entry of await fs.readdir(root, { withFileTypes: true })) { if (entry.name === '.poreview') continue; const file = path.join(root, entry.name); if (entry.isDirectory()) { if (!nestedRuns.has(path.resolve(file))) await walk(file, nestedRuns, output); } else if (entry.isFile()) output.push(file); } return output; }
function outputKind(file) { const normalized = file.toLowerCase().replace(/[^a-z0-9.]+/g, ''); if (/rdf/.test(normalized) && /\.(?:dat|txt)$/.test(normalized)) return 'rdf'; if (/endtoend/.test(normalized) && /\.(?:dat|txt)$/.test(normalized)) return 'endToEnd'; if (/\.vtk$/.test(normalized) || /vtk/.test(normalized) && /\.vti$/.test(normalized)) return 'vtk'; return null; }

export async function indexRun(simulationPath, { datasetRoot, allRunRoots = new Set(), hashSmallFiles = false } = {}) {
  const runRoot = path.dirname(simulationPath), diagnostics = []; let parsed;
  try { parsed = parseSimulationInput(await fs.readFile(simulationPath, 'utf8'), rel(datasetRoot, simulationPath)); diagnostics.push(...parsed.diagnostics); }
  catch (error) { diagnostics.push(diagnostic('fatal', 'simulation_input_read_failed', error.message, { path: rel(datasetRoot, simulationPath) })); parsed = { settings: {}, framework: null, temperatureK: null, pressurePa: null, pressureListPa: [], components: [], diagnostics: [] }; }
  const resolved = await resolveRunInputs({ runRoot, datasetRoot, components: parsed.components }); diagnostics.push(...resolved.diagnostics);
  let pseudoAtoms = [], vdwParameters = [], moleculeDefinitions = [];
  if (resolved.pseudoAtomsPath) try { const result = parsePseudoAtoms(await fs.readFile(resolved.pseudoAtomsPath, 'utf8'), rel(datasetRoot, resolved.pseudoAtomsPath)); pseudoAtoms = result.records; diagnostics.push(...result.diagnostics); } catch (error) { diagnostics.push(diagnostic('error', 'pseudo_atoms_parse_failed', error.message)); }
  if (resolved.mixingRulesPath) try { const result = parseMixingRules(await fs.readFile(resolved.mixingRulesPath, 'utf8'), rel(datasetRoot, resolved.mixingRulesPath)); vdwParameters = result.parameters; parsed.settings.mixingRule = result.mixingRule; parsed.settings.cutoffTreatment = result.potential; diagnostics.push(...result.diagnostics); } catch (error) { diagnostics.push(diagnostic('error', 'mixing_rules_parse_failed', error.message)); }
  for (const item of resolved.moleculeDefinitionPaths) try { const definition = parseMoleculeDefinition(await fs.readFile(item.path, 'utf8'), { source: rel(datasetRoot, item.path), name: item.componentName }); moleculeDefinitions.push(definition); diagnostics.push(...definition.diagnostics); } catch (error) { diagnostics.push(diagnostic('error', 'molecule_definition_parse_failed', error.message, { path: rel(datasetRoot, item.path) })); }
  const files = await walk(runRoot, new Set([...allRunRoots].filter(value => value !== path.resolve(runRoot)))), fingerprints = {};
  fingerprints['@runRoot'] = await fingerprint(runRoot);
  for (const file of [simulationPath, resolved.pseudoAtomsPath, resolved.mixingRulesPath, ...resolved.moleculeDefinitionPaths.map(x => x.path), ...files].filter(Boolean)) fingerprints[rel(datasetRoot, file)] = await fingerprint(file, { hashSmallFiles });
  const knownNames = [...pseudoAtoms.map(x => x.name), ...moleculeDefinitions.flatMap(x => x.atoms.map(a => a.pseudoAtomType))], adsorbateNames = [...new Set(moleculeDefinitions.flatMap(x => x.atoms.map(a => a.pseudoAtomType)))], roles = {};
  for (const definition of moleculeDefinitions) for (const atom of definition.atoms) if (!roles[atom.pseudoAtomType] || roles[atom.pseudoAtomType] === atom.role) roles[atom.pseudoAtomType] = atom.role; else roles[atom.pseudoAtomType] = 'mixed';
  const context = { knownNames, adsorbateNames, frameworkNames: pseudoAtoms.filter(x => !adsorbateNames.includes(x.name)).map(x => x.name), roles, componentNames: parsed.components.map(x => x.name).filter(Boolean), pressurePa: parsed.pressurePa, temperatureK: parsed.temperatureK, endpoints: Object.fromEntries(moleculeDefinitions.map(x => [x.name, x.terminalAtomIndices])) };
  const rdfFiles = files.filter(x => outputKind(x) === 'rdf'), endFiles = files.filter(x => outputKind(x) === 'endToEnd'), vtkFiles = files.filter(x => outputKind(x) === 'vtk');
  const rdfRecords = rdfFiles.map(x => indexRdf(rel(datasetRoot, x), context)); diagnostics.push(...rdfRecords.flatMap(x => x.parseWarnings));
  const endToEndRecords = endFiles.map(x => indexEndToEnd(rel(datasetRoot, x), context));
  const vtkRecords = []; for (const file of vtkFiles) { const handle = await fs.open(file, 'r'); try { const buffer = Buffer.alloc(8192), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); vtkRecords.push(indexVtk(rel(datasetRoot, file), buffer.subarray(0, bytesRead).toString('utf8'), context)); } finally { await handle.close(); } }
  for (const [kind, count] of [['rdf', rdfRecords.length], ['end_to_end', endToEndRecords.length], ['vtk', vtkRecords.length]]) if (!count) diagnostics.push(diagnostic('warning', `missing_${kind}_output`, `No ${kind.replaceAll('_', '-')} output was discovered; that optional capability is unavailable.`));
  const relativeRoot = rel(datasetRoot, runRoot) || '.', parents = relativeRoot.split('/'), runNumber = /^\d+$/.test(parents.at(-1)) ? parents.at(-1) : null, seriesName = parents.length > 1 ? parents.at(-2) : null;
  const dirs = kind => { const item = files.find(x => outputKind(x) === kind); return item ? rel(datasetRoot, path.dirname(item)) : null; };
  return new SimulationRun({ runId: relativeRoot, root: relativeRoot, seriesName, runNumber, parentMetadata: parents, framework: parsed.framework, temperatureK: parsed.temperatureK, pressurePa: parsed.pressurePa, pressureListPa: parsed.pressureListPa, components: parsed.components, settings: parsed.settings, simulationInputPath: rel(datasetRoot, simulationPath), pseudoAtomsPath: rel(datasetRoot, resolved.pseudoAtomsPath), mixingRulesPath: rel(datasetRoot, resolved.mixingRulesPath), moleculeDefinitionPaths: resolved.moleculeDefinitionPaths.map(x => ({ ...x, path: rel(datasetRoot, x.path) })), rdfDirectory: dirs('rdf'), endToEndDirectory: dirs('endToEnd'), vtkDirectory: dirs('vtk'), rdfRecords, endToEndRecords, vtkRecords, pseudoAtoms, vdwParameters, moleculeDefinitions, diagnostics, capabilities: { rdf: !!rdfRecords.length, endToEnd: !!endToEndRecords.length, vtk: !!vtkRecords.length, topology: moleculeDefinitions.some(x => x.bonds.length), mixture: parsed.components.length > 1 }, fingerprints });
}
