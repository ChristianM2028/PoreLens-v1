import { MoleculeAtom, MoleculeDefinition } from '../models.mjs?rev=histogram-inset-legend';
import { diagnostic } from '../diagnostics.mjs?rev=histogram-inset-legend';

const marker = (lines, re) => lines.findIndex(line => re.test(line));
const section = (lines, start, arity) => { const out = []; if (start < 0) return out; for (let i = start + 1; i < lines.length; i++) { const p = lines[i].trim().split(/\s+/); if (p.length < arity || p.slice(0, arity).some(x => !/^\d+$/.test(x))) break; out.push({ atoms: p.slice(0, arity).map(Number), type: p[arity] ?? null, parameters: p.slice(arity + 1), rawRecord: lines[i] }); } return out; };

export function parseMoleculeDefinition(text, { source = 'molecule.def', name = null } = {}) {
  const lines = text.split(/\r?\n/), diagnostics = [], atomMarker = marker(lines, /#\s*atomic positions/i), atoms = [];
  if (atomMarker >= 0) for (let i = atomMarker + 1; i < lines.length; i++) { const p = lines[i].trim().split(/\s+/); if (!/^\d+$/.test(p[0] ?? '') || !p[1]) break; atoms.push(new MoleculeAtom({ index: Number(p[0]), pseudoAtomType: p[1], rawRecord: lines[i] })); }
  const match = text.match(/#\s*Number Of Atoms\s*\r?\n\s*(\d+)/i), atomCount = match ? Number(match[1]) : atoms.length || null;
  if (!atoms.length) diagnostics.push(diagnostic('error', 'missing_atom_order', 'Molecule definition has no recognized atomic positions.', { source }));
  if (atomCount !== atoms.length) diagnostics.push(diagnostic('error', 'atom_count_mismatch', `Declared ${atomCount} atoms but parsed ${atoms.length}.`, { source }));
  if (atoms.some((atom, i) => atom.index !== i)) diagnostics.push(diagnostic('error', 'noncontiguous_atom_order', 'Atom indices are not contiguous from zero.', { source }));
  const bonds = section(lines, marker(lines, /#\s*Bond stretch:/i), 2), bends = section(lines, marker(lines, /#\s*Bond bending:/i), 3), torsions = section(lines, marker(lines, /#\s*Torsion\b/i), 4), intraVdw = section(lines, marker(lines, /#\s*Intra VDW:/i), 2);
  const degrees = Array(atoms.length).fill(0); for (const bond of bonds) for (const index of bond.atoms) { if (index >= atoms.length) diagnostics.push(diagnostic('error', 'invalid_topology_index', `Bond references atom ${index}.`, { source })); else degrees[index]++; }
  const terminalAtomIndices = [], internalAtomIndices = [];
  atoms.forEach((atom, index) => { if (bonds.length && degrees[index] <= 1) { atom.role = 'terminal'; atom.roleEvidence.push('topology_degree'); terminalAtomIndices.push(index); } else if (bonds.length) { atom.role = 'internal'; atom.roleEvidence.push('topology_degree'); internalAtomIndices.push(index); } if (/^(?:CH3|CF3)(?:_|$)/i.test(atom.pseudoAtomType)) atom.roleEvidence.push('pseudoatom_name_support'); });
  const groupMatches = [...text.matchAll(/#\s*([^\r\n#]*group[^\r\n#]*)\r?\n\s*(rigid|flexible)/ig)];
  const groups = groupMatches.map((m, index) => ({ index, name: m[1].trim(), rigid: m[2].toLowerCase() === 'rigid' }));
  return new MoleculeDefinition({ name, path: source, atomCount, rigid: groups.length ? groups.every(g => g.rigid) : null, groups, atoms, bonds: bonds.map(x => x.atoms), bends, torsions, intramolecular: { vdwPairs: intraVdw.map(x => x.atoms) }, terminalAtomIndices, internalAtomIndices, diagnostics });
}
