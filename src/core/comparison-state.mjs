/** Scientific state and pure alignment helpers for the persistent A/B workspace. */
export const COMPARISON_SCHEMA_VERSION = 'porelens-comparison/v1';
export const COMPARISON_VIEWS = ['rdf_curves', 'rdf_heatmaps', 'end_to_end', 'lj'];

const finite = value => Number.isFinite(Number(value));
const copyInterval = value => {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(finite)) return null;
  const interval = value.map(Number).sort((a, b) => a - b);
  return interval[0] === interval[1] ? null : interval;
};

export function datasetSelection(value = {}) {
  return {
    datasetId: value.datasetId == null ? null : String(value.datasetId),
    family: value.family == null ? null : String(value.family),
    component: value.component == null ? null : String(value.component),
    chain: value.chain == null ? null : String(value.chain),
    pair: Array.isArray(value.pair) ? value.pair.map(String) : value.pair == null ? null : String(value.pair),
    run: value.run == null ? null : String(value.run),
    pressurePa: finite(value.pressurePa) ? Number(value.pressurePa) : null,
    sourcePath: value.sourcePath == null ? null : String(value.sourcePath)
  };
}

export function createComparisonState(value = {}) {
  const matching = value.pressureMatching || {};
  return {
    schemaVersion: COMPARISON_SCHEMA_VERSION,
    activeView: COMPARISON_VIEWS.includes(value.activeView) ? value.activeView : 'rdf_curves',
    A: datasetSelection(value.A), B: datasetSelection(value.B),
    pressureMatching: {
      mode: ['exact', 'nearest', 'independent', 'loading'].includes(matching.mode) ? matching.mode : 'exact',
      tolerancePa: finite(matching.tolerancePa) && Number(matching.tolerancePa) >= 0 ? Number(matching.tolerancePa) : 0
    },
    distanceIntervalA: copyInterval(value.distanceIntervalA || value.distanceInterval),
    samplingQuality: { absoluteWeightFloor: null, fractionOfPairMaximum: null, earlyJumpThreshold: null, ...(value.samplingQuality || {}) },
    normalization: value.normalization || 'native',
    visibleEvidence: Object.fromEntries(COMPARISON_VIEWS.map(view => [view, value.visibleEvidence?.[view] !== false])),
    provenance: { createdBy: 'PoreLens comparison workspace', ...(value.provenance || {}) }
  };
}

/** Exact is deliberately the default. Unmatched records are first-class output rows. */
export function matchPressures(rowsA = [], rowsB = [], { mode = 'exact', tolerancePa = 0 } = {}) {
  const A = [...rowsA].filter(row => finite(row.pressurePa)).sort((a, b) => Number(a.pressurePa) - Number(b.pressurePa));
  const B = [...rowsB].filter(row => finite(row.pressurePa)).sort((a, b) => Number(a.pressurePa) - Number(b.pressurePa));
  const unused = new Set(B.map((_, index) => index)), matches = [], unmatched = [];
  if (mode === 'independent') return { mode, tolerancePa: Number(tolerancePa), matches: [], unmatched: [...A.map(row => ({ side: 'A', row, reason: 'independently selected pressure' })), ...B.map(row => ({ side: 'B', row, reason: 'independently selected pressure' }))] };
  for (const a of A) {
    const candidates = [...unused].map(index => ({ index, row: B[index], differencePa: Number(B[index].pressurePa) - Number(a.pressurePa) }))
      .sort((x, y) => Math.abs(x.differencePa) - Math.abs(y.differencePa));
    const candidate = mode === 'exact' ? candidates.find(item => item.differencePa === 0) : candidates[0];
    const accepted = candidate && (mode === 'exact' || (mode === 'nearest' && Math.abs(candidate.differencePa) <= Number(tolerancePa)));
    if (!accepted) unmatched.push({ side: 'A', row: a, reason: mode === 'nearest' ? `no B pressure within ${Number(tolerancePa)} Pa` : 'no exact B pressure' });
    else { unused.delete(candidate.index); matches.push({ A: a, B: candidate.row, actualPressurePaA: Number(a.pressurePa), actualPressurePaB: Number(candidate.row.pressurePa), differencePa: candidate.differencePa, status: candidate.differencePa === 0 ? 'exact' : 'nearest' }); }
  }
  for (const index of unused) unmatched.push({ side: 'B', row: B[index], reason: mode === 'nearest' ? `no unused A pressure within ${Number(tolerancePa)} Pa` : 'no exact A pressure' });
  return { mode, tolerancePa: Number(tolerancePa), matches, unmatched };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function comparisonCompatibility(A = {}, B = {}) {
  const definitions = [
    ['units', A.units, B.units], ['RDF pair semantics', A.pairSemantics, B.pairSemantics],
    ['distance grids', A.distanceGrid, B.distanceGrid], ['histogram semantics', A.histogramSemantics, B.histogramSemantics],
    ['LJ normalization', A.normalization, B.normalization], ['selection/reference definitions', A.selectionReference, B.selectionReference],
    ['physics fingerprints', A.physicsFingerprint, B.physicsFingerprint]
  ];
  const checks = definitions.map(([name, left, right]) => ({ name, compatible: left != null && right != null && same(left, right), A: left ?? null, B: right ?? null, reason: left == null || right == null ? `${name} missing on ${left == null ? 'A' : ''}${left == null && right == null ? ' and ' : ''}${right == null ? 'B' : ''}` : same(left, right) ? null : `${name} differ` }));
  return { compatible: checks.every(check => check.compatible), checks, incompatibilities: checks.filter(check => !check.compatible).map(check => check.reason) };
}

export function histogramCompatibility(A = {}, B = {}) {
  const semantics = value => value.storedValueSemantics || value.histogramSemantics || 'unknown';
  const reasons = [];
  if (semantics(A) === 'unknown' || semantics(B) === 'unknown') reasons.push('histogram meaning is unknown');
  if (semantics(A) !== semantics(B)) reasons.push(`histogram meaning differs (${semantics(A)} vs ${semantics(B)})`);
  if ((A.normalizationMode || 'unknown') !== (B.normalizationMode || 'unknown')) reasons.push('histogram normalization differs');
  return { compatible: !reasons.length, reasons, semanticsA: semantics(A), semanticsB: semantics(B) };
}

const rowDistance = row => Number(row.distanceA ?? row.distance_A ?? row.distance);
const rowG = row => Number(row.g ?? row.g_r ?? row.gR);
const rowHistogram = row => Number(row.rawHistogram ?? row.unnormalizedDistanceHistogram ?? row.unnormalizedHistogram ?? row.raw_histogram);
function interpolate(records, grid) {
  let cursor = 0;
  return grid.map(distanceA => {
    while (cursor + 1 < records.length && rowDistance(records[cursor + 1]) < distanceA) cursor++;
    const left = records[cursor], right = records[Math.min(cursor + 1, records.length - 1)], span = rowDistance(right) - rowDistance(left);
    if (distanceA < rowDistance(left) || distanceA > rowDistance(right)) return null;
    const t = span ? (distanceA - rowDistance(left)) / span : 0;
    return { distanceA, g: rowG(left) + t * (rowG(right) - rowG(left)), unnormalizedHistogram: rowHistogram(left) + t * (rowHistogram(right) - rowHistogram(left)), interpolated: distanceA !== rowDistance(left) };
  });
}

/** Align only small numeric grid drift. Original grids always remain in provenance. */
export function alignRdfRecords(recordsA = [], recordsB = [], { reference = 'A', maximumShiftA = null } = {}) {
  const gridA = recordsA.map(rowDistance), gridB = recordsB.map(rowDistance), provenance = { referenceGrid: reference, originalGridA: gridA, originalGridB: gridB };
  if (gridA.length < 2 || gridB.length < 2) return { compatible: false, reason: 'each RDF grid requires at least two rows', provenance };
  const exact = same(gridA, gridB);
  if (exact) return { compatible: true, interpolated: false, A: recordsA, B: recordsB, grid: gridA, provenance };
  const spacing = grid => Math.min(...grid.slice(1).map((value, index) => value - grid[index]));
  const permitted = maximumShiftA == null ? Math.min(spacing(gridA), spacing(gridB)) / 4 : Number(maximumShiftA);
  if (gridA.length !== gridB.length || Math.max(...gridA.map((value, index) => Math.abs(value - gridB[index]))) > permitted)
    return { compatible: false, reason: `major distance-grid incompatibility (allowed shift ${permitted} Å)`, provenance };
  const grid = reference === 'B' ? gridB : gridA, A = reference === 'B' ? interpolate(recordsA, grid) : recordsA, B = reference === 'A' ? interpolate(recordsB, grid) : recordsB;
  if ([...A, ...B].some(row => row == null)) return { compatible: false, reason: 'interpolation would extrapolate beyond an original grid', provenance };
  return { compatible: true, interpolated: true, warning: `Small grid differences interpolated onto declared Dataset ${reference} reference grid.`, A, B, grid, provenance };
}

export function subtractRdf(A, B, options = {}) {
  if (!same(A.pairSemantics, B.pairSemantics)) return { enabled: false, reason: 'RDF pair semantics differ' };
  const aligned = alignRdfRecords(A.records, B.records, options);
  if (!aligned.compatible) return { enabled: false, reason: aligned.reason, provenance: aligned.provenance };
  const peakA=aligned.A.reduce((a,b)=>rowG(b)>rowG(a)?b:a),peakB=aligned.B.reduce((a,b)=>rowG(b)>rowG(a)?b:a);
  return { enabled: true, records: aligned.grid.map((distanceA, index) => ({ distanceA, gR: rowG(aligned.B[index]) - rowG(aligned.A[index]), histogramDifference: rowHistogram(aligned.B[index]) - rowHistogram(aligned.A[index]), interpolated: aligned.interpolated })), peakHeightDifference:rowG(peakB)-rowG(peakA),peakPositionDifferenceA:rowDistance(peakB)-rowDistance(peakA),warning: aligned.warning || null, provenance: aligned.provenance };
}

/** One selected-pressure comparison transaction for both browser presentation and tests. */
export function compareRdfSelections(rowsA = [], rowsB = [], {
  mode = 'exact', tolerancePa = 0, selectedPressurePaA = null,
  selectedPressurePaB = null, pairSemanticsA = null, pairSemanticsB = null,
  maximumShiftA = null
} = {}) {
  if (mode === 'nearest' && !(Number(tolerancePa) >= 0)) throw new TypeError('Nearest pressure matching requires an explicit non-negative tolerance');
  const byPressure = rows => rows.map(row => ({...row, pressurePa: Number(row.pressurePa)}));
  const A = byPressure(rowsA), B = byPressure(rowsB);
  const selectedA = A.find(row => row.pressurePa === Number(selectedPressurePaA)) || A[0] || null;
  let selectedB = B.find(row => row.pressurePa === Number(selectedPressurePaB)) || B[0] || null;
  if (selectedA && mode !== 'independent') {
    const pressure = matchPressures([selectedA], B, {mode, tolerancePa});
    if (pressure.matches[0]) selectedB = pressure.matches[0].B;
    else return {mode, tolerancePa:Number(tolerancePa), A:selectedA, B:selectedB, matched:false, unmatched:pressure.unmatched, difference:{enabled:false,reason:pressure.unmatched[0]?.reason || 'pressure unmatched'}};
  }
  if (!selectedA || !selectedB) return {mode, matched:false, unmatched:[{reason:'selected RDF evidence is unavailable'}], difference:{enabled:false,reason:'selected RDF evidence is unavailable'}};
  const difference = subtractRdf(
    {pairSemantics:pairSemanticsA, records:selectedA.records},
    {pairSemantics:pairSemanticsB, records:selectedB.records}, {maximumShiftA}
  );
  return {mode, tolerancePa:Number(tolerancePa), A:selectedA, B:selectedB, matched:mode === 'independent' || selectedA.pressurePa === selectedB.pressurePa || Math.abs(selectedB.pressurePa-selectedA.pressurePa) <= Number(tolerancePa), unmatched:[], difference};
}

export function synchronizeDistanceInterval(state, interval, { source = 'heatmap' } = {}) {
  const selected = copyInterval(interval); if (!selected) throw new TypeError('A finite, non-zero distance interval is required');
  state.distanceIntervalA = selected;
  state.provenance = { ...state.provenance, distanceSelection: { source, intervalA: [...selected] } };
  return selected;
}
