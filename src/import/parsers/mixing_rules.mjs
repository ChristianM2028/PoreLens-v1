import { VdwParameter } from '../models.mjs?rev=porelens-20260729-indexed-pdb-v1';
import { diagnostic } from '../diagnostics.mjs?rev=porelens-20260729-indexed-pdb-v1';

export function parseMixingRules(text, source = 'force_field_mixing_rules.def') {
  const parameters = [], diagnostics = [], data = text.split(/\r?\n/).map(x => x.replace(/\/\/.*$/, '').trim()).filter(x => x && !x.startsWith('#'));
  const potential = data.find(x => /^(?:shifted|truncated)$/i.test(x))?.toLowerCase() ?? null;
  const mixingRule = data.find(x => /lorentz|geometric/i.test(x)) ?? null;
  for (const rawRecord of data) {
    const p = rawRecord.split(/\s+/); if (p.length < 2 || !/^[a-z][\w-]*$/i.test(p[1])) continue;
    const interactionType = p[1].toLowerCase();
    if (interactionType !== 'lennard-jones') { if (!['yes','no','shifted','truncated'].includes(interactionType)) diagnostics.push(diagnostic('warning', 'unsupported_interaction', `Interaction ${p[1]} for ${p[0]} is indexed but not normalized.`, { source })); continue; }
    const epsilon = Number(p[2]), sigma = Number(p[3]);
    if (!Number.isFinite(epsilon) || !Number.isFinite(sigma)) { diagnostics.push(diagnostic('error', 'malformed_vdw_parameter', `Malformed Lennard-Jones parameters for ${p[0]}.`, { source })); continue; }
    parameters.push(new VdwParameter({ pseudoAtomName: p[0], interactionType, epsilon, sigma, epsilonK: epsilon, sigmaA: sigma, rawRecord }));
  }
  if (!potential) diagnostics.push(diagnostic('warning', 'missing_cutoff_treatment', 'Shifted/truncated treatment was not identified.', { source }));
  if (!mixingRule) diagnostics.push(diagnostic('warning', 'missing_mixing_rule', 'General mixing rule was not identified.', { source }));
  return { potential, mixingRule, tailCorrections: data.some(x => /^yes$/i.test(x)), parameters, diagnostics };
}
