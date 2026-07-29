import { RDFRecord } from '../models.mjs?rev=porelens-20260729-simulation-shape-v2';
import { diagnostic } from '../diagnostics.mjs?rev=porelens-20260729-simulation-shape-v2';

export function resolveRdfPair(filename, knownNames = []) {
  const stem = filename.split(/[\\/]/).at(-1).replace(/^RDF_/i, '').replace(/\.[^.]+$/, ''), names = [...new Set(['Framework', ...knownNames])].sort((a, b) => b.length - a.length);
  const matches = [];
  for (const left of names) if (stem.startsWith(`${left}_`)) for (const right of names) if (`${left}_${right}` === stem) matches.push([left, right]);
  return matches.length === 1 ? { pair: matches[0], ambiguous: false } : { pair: [null, null], ambiguous: matches.length > 1, candidates: matches };
}
export function indexRdf(path, context = {}) {
  const resolved = resolveRdfPair(path, context.knownNames), warnings = [];
  if (!resolved.pair[0]) warnings.push(diagnostic('warning', resolved.ambiguous ? 'ambiguous_rdf_pair' : 'unresolved_rdf_pair', `Could not uniquely resolve the RDF pair from ${path}.`, { path, candidates: resolved.candidates ?? [] }));
  const classify = name => name === 'Framework' || context.frameworkNames?.includes(name) ? 'framework' : context.adsorbateNames?.includes(name) ? 'adsorbate' : 'unknown';
  const sideClassifications = resolved.pair.map(classify), pairKind = sideClassifications.every(x => x === 'framework') ? 'framework-framework' : sideClassifications.every(x => x === 'adsorbate') ? 'adsorbate-adsorbate' : sideClassifications.includes('framework') && sideClassifications.includes('adsorbate') ? 'framework-adsorbate' : 'unknown';
  const roles = resolved.pair.map(name => context.roles?.[name] ?? (classify(name) === 'framework' ? 'framework' : 'unknown'));
  return new RDFRecord({ path, pair: resolved.pair, sideClassifications, roles, pairKind, componentNames: context.componentNames ?? [], columns: ['bin_index', 'distance_A', 'g_r', 'unnormalized distance histogram'], parseWarnings: warnings });
}
