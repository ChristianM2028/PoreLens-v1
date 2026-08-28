import fs from 'node:fs/promises';
import path from 'node:path';
import { Dataset, Series, SimulationRun } from './models.mjs?rev=normalized-chain-key-v1';
import { diagnostic } from './diagnostics.mjs?rev=normalized-chain-key-v1';
import { indexRun } from './indexer.mjs?rev=normalized-chain-key-v1';
import { cacheEntryIsFresh, readIndex, writeIndex } from './cache.mjs?rev=normalized-chain-key-v1';

async function findInputs(root, found = [], visited = new Set()) { let real; try { real = await fs.realpath(root); } catch { return found; } if (visited.has(real)) return found; visited.add(real); for (const entry of await fs.readdir(root, { withFileTypes: true })) { if (entry.name === '.poreview') continue; const target = path.join(root, entry.name); if (entry.isDirectory()) await findInputs(target, found, visited); else if (entry.isFile() && /^simulation\.input$/i.test(entry.name)) found.push(target); } return found; }
export async function discoverRuns(root, options = {}) { return (await discoverDataset(root, { ...options, writeCache: false })).runs; }
export async function discoverDataset(root, { useCache = true, writeCache = true, hashSmallFiles = false } = {}) {
  const absolute = path.resolve(root), diagnostics = []; let stat;
  try { stat = await fs.stat(absolute); if (!stat.isDirectory()) throw new Error('Dataset root is not a directory.'); } catch (error) { return new Dataset({ root: absolute, name: path.basename(absolute), diagnostics: [diagnostic('fatal', 'dataset_unreadable', error.message)] }); }
  const inputs = [...new Set((await findInputs(absolute)).map(x => path.resolve(x)))].sort(), previous = useCache ? await readIndex(absolute) : null, allRunRoots = new Set(inputs.map(path.dirname).map(x => path.resolve(x))), runs = [];
  if (!inputs.length) diagnostics.push(diagnostic('warning', 'no_runs', 'No directory containing simulation.input was found.'));
  for (const input of inputs) { try { const relativeInput = path.relative(absolute, input).split(path.sep).join('/'), cached = previous?.runs?.find(run => run.simulationInputPath === relativeInput); if (cached && await cacheEntryIsFresh(cached, absolute)) runs.push(new SimulationRun({ ...cached, fromCache: true })); else runs.push(await indexRun(input, { datasetRoot: absolute, allRunRoots, hashSmallFiles })); } catch (error) { diagnostics.push(diagnostic('error', 'run_index_failed', error.message, { path: path.relative(absolute, input) })); } }
  runs.sort((a, b) => (a.pressurePa ?? Infinity) - (b.pressurePa ?? Infinity) || a.runId.localeCompare(b.runId));
  const grouped = new Map(); for (const run of runs) { const key = run.seriesName ?? '.'; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(run.runId); }
  const dataset = new Dataset({ root: absolute, name: path.basename(absolute), runs, series: [...grouped].map(([name, runIds]) => new Series({ name, path: name, runIds })), diagnostics, fingerprints: Object.assign({}, ...runs.map(x => x.fingerprints)), cache: { reusedRuns: runs.filter(x => x.fromCache).length, reparsedRuns: runs.filter(x => !x.fromCache).length } });
  if (writeCache) try { dataset.indexPath = await writeIndex(dataset); } catch (error) { dataset.diagnostics.push(diagnostic('warning', 'cache_write_failed', error.message)); }
  return dataset;
}
