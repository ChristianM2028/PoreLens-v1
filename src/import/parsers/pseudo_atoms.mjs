import { PseudoAtom } from '../models.mjs?rev=chain-label-plain-v1';
import { diagnostic } from '../diagnostics.mjs?rev=chain-label-plain-v1';

export function parsePseudoAtoms(text, source = 'pseudo_atoms.def') {
  const records = [], diagnostics = [];
  for (const [index, rawRecord] of text.split(/\r?\n/).entries()) {
    const line = rawRecord.replace(/\/\/.*$/, '').trim(); if (!line || line.startsWith('#') || /^\d+$/.test(line)) continue;
    const p = line.split(/\s+/); if (!/^(yes|no)$/i.test(p[1] ?? '')) continue;
    const mass = Number(p[5]), charge = Number(p[6]);
    if (!Number.isFinite(mass) || !Number.isFinite(charge)) { diagnostics.push(diagnostic('error', 'malformed_pseudoatom', `Invalid mass or charge for ${p[0]} on line ${index + 1}.`, { source, line: index + 1 })); continue; }
    records.push(new PseudoAtom({ name: p[0], classification: /^(?:yes|framework)$/i.test(p[2]) ? 'framework' : 'unknown', element: p[3] ?? p[2] ?? null, oxidationState: Number.isFinite(Number(p[4])) ? Number(p[4]) : p[4] ?? null, mass, charge, connectivity: p[10] ?? null, anisotropic: p[11] ?? null, rawRecord, sourceLine: index + 1, attributes: p.slice(7) }));
  }
  const names = new Set(); for (const record of records) { if (names.has(record.name)) diagnostics.push(diagnostic('error', 'duplicate_pseudoatom', `Duplicate pseudoatom ${record.name}.`, { source })); names.add(record.name); }
  if (!records.length) diagnostics.push(diagnostic('error', 'no_pseudoatoms', 'No pseudoatom records were recognized.', { source }));
  return { records, diagnostics };
}
