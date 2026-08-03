import path from 'node:path';
import fs from 'node:fs/promises';
import { diagnostic } from './diagnostics.mjs?rev=draggable-chain-legend-v1';

const specialDefinitions = /^(?:pseudo_atoms|force_field(?:_mixing_rules)?)\.def$/i;
async function exists(file) { try { return (await fs.stat(file)).isFile(); } catch { return false; } }
async function candidatesIn(directory, predicate) { try { return (await fs.readdir(directory, { withFileTypes: true })).filter(x => x.isFile() && predicate(x.name)).map(x => path.join(directory, x.name)); } catch { return []; } }
function ancestors(runRoot, datasetRoot, commonInputs = []) { const out = [runRoot], stop = path.resolve(datasetRoot); let cursor = path.resolve(runRoot); while (cursor !== stop && cursor.startsWith(`${stop}${path.sep}`)) { cursor = path.dirname(cursor); out.push(cursor); } return [...out, ...commonInputs.map(x => path.resolve(x))]; }

export async function resolveRunInputs({ runRoot, datasetRoot, components = [], commonInputs = [] }) {
  const diagnostics = [], scopes = ancestors(runRoot, datasetRoot, commonInputs), findRanked = async (label, tests) => {
    for (const test of tests) { const matches = []; for (const directory of scopes) matches.push(...await candidatesIn(directory, test)); const unique = [...new Set(matches.map(x => path.resolve(x)))]; if (unique.length === 1) return unique[0]; if (unique.length > 1) { diagnostics.push(diagnostic('error', `ambiguous_${label}`, `Multiple ${label} candidates have equal rank.`, { candidates: unique.map(x => path.relative(datasetRoot, x)) })); return null; } }
    diagnostics.push(diagnostic('warning', `unresolved_${label}`, `No ${label} could be resolved.`)); return null;
  };
  const pseudoAtomsPath = await findRanked('pseudo_atoms', [name => /^pseudo_atoms\.def$/i.test(name)]);
  const mixingRulesPath = await findRanked('mixing_rules', [name => /^force_field_mixing_rules\.def$/i.test(name), name => /^force_field\.def$/i.test(name)]);
  const moleculeDefinitionPaths = [];
  for (const component of components) {
    const explicit = component.moleculeDefinition && !/^(?:local|default)$/i.test(component.moleculeDefinition) ? path.basename(component.moleculeDefinition.endsWith('.def') ? component.moleculeDefinition : `${component.moleculeDefinition}.def`) : null;
    const exact = `${component.name}.def`;
    const resolved = await findRanked(`molecule_${component.name || component.index}`, [
      ...(explicit ? [name => name.toLowerCase() === explicit.toLowerCase()] : []),
      name => name.toLowerCase() === exact.toLowerCase(),
      name => name.toLowerCase() === 'molecule.def',
      name => name.endsWith('.def') && !specialDefinitions.test(name)
    ]);
    if (resolved) moleculeDefinitionPaths.push({ componentName: component.name, path: resolved });
  }
  return { pseudoAtomsPath, mixingRulesPath, moleculeDefinitionPaths, diagnostics };
}
