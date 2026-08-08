import { Component, Framework, SimulationSettings } from '../models.mjs?rev=mixture-directory-v2';
import { diagnostic } from '../diagnostics.mjs?rev=mixture-directory-v2';
import { cleanLines, finiteNumber } from './common.mjs?rev=mixture-directory-v2';

const canonical = key => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const bool = value => /^(?:yes|true|on|1)$/i.test(value) ? true : /^(?:no|false|off|0)$/i.test(value) ? false : null;
const globalKeys = new Set(['simulationtype','numberofcycles','numberofinitializationcycles','restartfile','restart','forcefield','cutoffvdw','usechargesfromciffile','computerdf','writerdfevery','rdfhistogramrange','numberofrdfbins','computeendtoenddistancehistogram','writeendtoenddistancehistogramevery','computedensityprofile3dvtkgrid','writedensityprofile3dvtkgridevery','densityprofile3dvtkgridpoints','movies','writemoviesevery','framework','frameworkname','unitcells','externaltemperature','externalpressure','printevery','printpropertiesevery']);

export function parseSimulationInput(text, source = 'simulation.input') {
  const diagnostics = [], raw = {}, components = []; let active = null;
  for (const { line, lineNumber, raw: rawRecord } of cleanLines(text)) {
    const tokens = line.split(/\s+/), key = canonical(tokens.shift()), value = tokens.join(' ');
    if (!key) continue;
    if (key === 'component') {
      const index = tokens.shift() ?? String(components.length); active = new Component({ index: String(index) });
      for (let i = 0; i < tokens.length; i += 2) setComponent(active, canonical(tokens[i]), tokens[i + 1], diagnostics, lineNumber);
      components.push(active); continue;
    }
    if (active && ['moleculename','moleculedefinition'].includes(key)) { setComponent(active, key, value, diagnostics, lineNumber); continue; }
    if (active && !globalKeys.has(key)) { active.settings[key] = value; continue; }
    raw[key] = raw[key] === undefined ? value : [...(Array.isArray(raw[key]) ? raw[key] : [raw[key]]), value];
    if (!value) diagnostics.push(diagnostic('warning', 'empty_setting', `Setting on line ${lineNumber} has no value.`, { source, line: lineNumber, rawRecord }));
  }
  const get = key => Array.isArray(raw[key]) ? raw[key].at(-1) : raw[key];
  const numbers = key => String(get(key) ?? '').split(/[\s,]+/).map(finiteNumber).filter(value => value !== null);
  const pressureListPa = numbers('externalpressure');
  const settings = new SimulationSettings({
    simulationType: get('simulationtype') ?? null, forceField: get('forcefield') ?? null,
    cutoffA: finiteNumber(get('cutoffvdw')), unitCells: numbers('unitcells').length ? numbers('unitcells') : null,
    initializationCycles: finiteNumber(get('numberofinitializationcycles')), productionCycles: finiteNumber(get('numberofcycles')),
    restart: get('restartfile') ?? get('restart') ?? null, useChargesFromCif: bool(get('usechargesfromciffile')),
    rdf: { enabled: bool(get('computerdf')), writeEvery: finiteNumber(get('writerdfevery')), rangeA: finiteNumber(get('rdfhistogramrange')), bins: finiteNumber(get('numberofrdfbins')) },
    endToEnd: { enabled: bool(get('computeendtoenddistancehistogram')), writeEvery: finiteNumber(get('writeendtoenddistancehistogramevery')) },
    vtk: { enabled: bool(get('computedensityprofile3dvtkgrid')), writeEvery: finiteNumber(get('writedensityprofile3dvtkgridevery')), gridPoints: numbers('densityprofile3dvtkgridpoints') },
    movie: { enabled: bool(get('movies')), writeEvery: finiteNumber(get('writemoviesevery')) }, raw
  });
  if (!components.length) diagnostics.push(diagnostic('error', 'missing_components', 'No Component block was found.', { source }));
  for (const component of components) if (!component.name) diagnostics.push(diagnostic('error', 'missing_component_name', `Component ${component.index} has no MoleculeName.`, { source }));
  if (!pressureListPa.length) diagnostics.push(diagnostic('warning', 'missing_pressure', 'ExternalPressure is missing or malformed.', { source }));
  const frameworkName = get('frameworkname') ?? null;
  return { settings, framework: new Framework({ name: frameworkName, index: get('framework') ?? null }), temperatureK: finiteNumber(get('externaltemperature')), pressurePa: pressureListPa[0] ?? null, pressureListPa, components, diagnostics };
}
function setComponent(component, key, value, diagnostics, line) {
  if (key === 'moleculename') component.name = value ?? null;
  else if (key === 'moleculedefinition') component.moleculeDefinition = value ?? null;
  else if (key) component.settings[key] = value ?? '';
  else diagnostics.push(diagnostic('warning', 'malformed_component_entry', `Malformed component entry on line ${line}.`, { line }));
}
