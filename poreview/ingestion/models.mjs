/** Normalized, JSON-safe ingestion models. Paths are dataset-relative unless named root. */
export class Dataset {
  constructor({ root, name, series = [], runs = [], diagnostics = [], fingerprints = {}, scannedAt = new Date().toISOString(), schemaVersion = 1, cache = null }) {
    Object.assign(this, { schemaVersion, root, name, series, runs, diagnostics, fingerprints, scannedAt, cache });
  }
  runsByPressure() { return [...this.runs].sort((a, b) => (a.pressurePa ?? Infinity) - (b.pressurePa ?? Infinity)); }
}
export class Series { constructor(fields = {}) { Object.assign(this, { name: null, path: null, metadata: {}, runIds: [], ...fields }); } }
export class SimulationRun {
  constructor(fields = {}) { Object.assign(this, { runId: '', root: '', seriesName: null, runNumber: null, parentMetadata: [], framework: null, temperatureK: null, pressurePa: null, pressureListPa: [], components: [], settings: new SimulationSettings(), simulationInputPath: null, pseudoAtomsPath: null, mixingRulesPath: null, moleculeDefinitionPaths: [], rdfDirectory: null, endToEndDirectory: null, vtkDirectory: null, rdfRecords: [], endToEndRecords: [], vtkRecords: [], pseudoAtoms: [], vdwParameters: [], moleculeDefinitions: [], diagnostics: [], capabilities: {}, fingerprints: {}, fromCache: false, ...fields }); }
}
export class SimulationSettings { constructor(fields = {}) { Object.assign(this, { simulationType: null, forceField: null, cutoffA: null, unitCells: null, initializationCycles: null, productionCycles: null, restart: null, useChargesFromCif: null, rdf: {}, endToEnd: {}, vtk: {}, movie: {}, raw: {}, ...fields }); } }
export class Framework { constructor(fields = {}) { Object.assign(this, { name: null, index: null, ...fields }); } }
export class Component { constructor(fields = {}) { Object.assign(this, { index: null, name: null, moleculeDefinition: null, settings: {}, ...fields }); } }
export class MoleculeDefinition { constructor(fields = {}) { Object.assign(this, { name: null, path: null, atomCount: null, rigid: null, groups: [], atoms: [], bonds: [], bends: [], torsions: [], intramolecular: {}, terminalAtomIndices: [], internalAtomIndices: [], diagnostics: [], ...fields }); } }
export class MoleculeAtom { constructor(fields = {}) { Object.assign(this, { index: null, pseudoAtomType: null, role: 'unknown', roleEvidence: [], rawRecord: null, ...fields }); } }
export class PseudoAtom { constructor(fields = {}) { Object.assign(this, { name: null, classification: 'unknown', element: null, mass: null, charge: null, oxidationState: null, connectivity: null, anisotropic: null, rawRecord: null, sourceLine: null, attributes: [], ...fields }); } }
export class VdwParameter { constructor(fields = {}) { Object.assign(this, { pseudoAtomName: null, interactionType: null, epsilon: null, sigma: null, epsilonUnit: 'K', sigmaUnit: 'angstrom', epsilonK: null, sigmaA: null, rawRecord: null, ...fields }); } }
export class RDFRecord { constructor(fields = {}) { Object.assign(this, { path: null, pair: [null, null], sideClassifications: ['unknown', 'unknown'], componentNames: [], roles: ['unknown', 'unknown'], pairKind: 'unknown', columns: [], parseWarnings: [], lazy: true, ...fields }); } }
export class EndToEndRecord { constructor(fields = {}) { Object.assign(this, { path: null, componentName: null, endpoints: [], columns: [], units: null, pressurePa: null, temperatureK: null, parseWarnings: [], lazy: true, ...fields }); } }
export class VTKRecord { constructor(fields = {}) { Object.assign(this, { path: null, frame: null, cycle: null, componentName: null, content: 'unknown', fields: [], format: null, parseable: null, parseWarnings: [], lazy: true, ...fields }); } }
export class Diagnostic { constructor(fields = {}) { Object.assign(this, { severity: 'info', code: 'unspecified', message: '', ...fields }); } }
