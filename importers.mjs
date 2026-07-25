export const MANIFEST_COLUMNS = ['n_value', 'component', 'run', 'pressure_pa', 'pressure_bar', 'rdf_filename', 'source_relative_path', 'collected_relative_path', 'size_bytes', 'sha256'];

export function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); if (row.some(Boolean)) rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  row.push(field.replace(/\r$/, '')); if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseManifest(text) {
  const table = parseCsv(text);
  if (!table.length) throw new Error('Manifest is empty');
  const headers = table[0].map(value => value.trim());
  const missing = MANIFEST_COLUMNS.filter(name => !headers.includes(name));
  if (missing.length) throw new Error(`Manifest is missing required columns: ${missing.join(', ')}`);
  const diagnostics = [], keys = new Set(), pressures = new Set();
  const rows = table.slice(1).map((values, rowIndex) => {
    const row = Object.fromEntries(headers.map((name, index) => [name, values[index] ?? '']));
    row.run = String(row.run);
    row.pressure_pa = Number(row.pressure_pa);
    row.pressure_bar = row.pressure_pa / 100000;
    row.size_bytes = Number(row.size_bytes);
    if (!(row.pressure_pa > 0) || !Number.isFinite(row.size_bytes)) diagnostics.push({ severity: 'error', row: rowIndex + 2, message: 'Pressure must be positive and size_bytes finite.' });
    const key = `${row.component}\0${row.run}\0${row.rdf_filename}`;
    if (keys.has(key)) diagnostics.push({ severity: 'error', row: rowIndex + 2, message: `Duplicate manifest key for ${row.component}/${row.run}/${row.rdf_filename}.` });
    keys.add(key);
    const pressureKey = `${row.component}\0${row.run}\0${row.pressure_pa}`;
    if (pressures.has(pressureKey)) diagnostics.push({ severity: 'warning', row: rowIndex + 2, message: `Duplicate pressure within component/run: ${row.pressure_pa} Pa.` });
    pressures.add(pressureKey);
    return row;
  });
  return { rows, diagnostics };
}

export function parseRdf(text, source = 'RDF') {
  const records = [], diagnostics = [];
  for (const [index, original] of text.split(/\r?\n/).entries()) {
    const line = original.trim();
    if (!line || /^(#|;|!)/.test(line)) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 4) { diagnostics.push({ severity: 'error', row: index + 1, message: 'RDF row has fewer than four columns.' }); continue; }
    const values = fields.slice(0, 4).map(Number);
    if (!values.every(Number.isFinite)) { diagnostics.push({ severity: 'error', row: index + 1, message: 'RDF row contains a non-finite value.' }); continue; }
    records.push({ binIndex: values[0], distanceA: values[1], gR: values[2], unnormalizedDistanceHistogram: values[3] });
  }
  if (records.length < 2) diagnostics.push({ severity: 'error', message: `${source} requires at least two finite numeric rows.` });
  for (let i = 1; i < records.length; i++) if (!(records[i].distanceA > records[i - 1].distanceA)) diagnostics.push({ severity: 'error', row: i + 1, message: 'Distance grid must be strictly increasing.' });
  if (diagnostics.some(item => item.severity === 'error')) throw Object.assign(new Error(`${source} is malformed`), { diagnostics });
  return { records, histogramLabel: 'unnormalized distance histogram', diagnostics };
}

export function resolvePairName(filename, pseudoatoms) {
  const stem = filename.replace(/^RDF_/, '').replace(/\.dat$/i, '');
  const labels = [...new Set(pseudoatoms)].sort((a, b) => b.length - a.length);
  const matches = [];
  for (const left of labels) for (const right of labels) if (`${left}_${right}` === stem) matches.push([left, right]);
  return matches.length === 1 ? matches[0] : null;
}

export function interpolateRdf(records, referenceDistances) {
  return referenceDistances.map(distanceA => {
    if (distanceA < records[0].distanceA || distanceA > records.at(-1).distanceA) return null;
    let hi = records.findIndex(row => row.distanceA >= distanceA);
    if (records[hi].distanceA === distanceA) return { ...records[hi] };
    const lo = hi - 1, fraction = (distanceA - records[lo].distanceA) / (records[hi].distanceA - records[lo].distanceA);
    return { binIndex: null, distanceA, gR: records[lo].gR + fraction * (records[hi].gR - records[lo].gR), unnormalizedDistanceHistogram: records[lo].unnormalizedDistanceHistogram + fraction * (records[hi].unnormalizedDistanceHistogram - records[lo].unnormalizedDistanceHistogram) };
  });
}

export async function importBrowserFiles(files, { verifyChecksums = false } = {}) {
  const list = Array.from(files), byPath = new Map();
  for (const file of list) {
    const path = file.webkitRelativePath || file.name;
    byPath.set(path.replace(/^\.\//, ''), file);
    byPath.set(file.name, file);
  }
  const manifestFile = list.find(file => file.name === 'manifest.csv');
  if (!manifestFile) return { rows: [], datasets: [], diagnostics: [{ severity: 'error', message: 'No manifest.csv was selected. Choose a manifest and all referenced local RDF files.' }] };
  let manifest;
  try { manifest = parseManifest(await manifestFile.text()); }
  catch (error) { return { rows: [], datasets: [], diagnostics: [{ severity: 'error', message: error.message }] }; }
  const diagnostics = [...manifest.diagnostics], datasets = [];
  for (const row of manifest.rows) {
    const target = row.collected_relative_path.replaceAll('\\', '/').replace(/^\.\//, '');
    if (target.startsWith('/') || target.split('/').includes('..')) { diagnostics.push({ severity: 'error', message: `Unsafe manifest target path: ${target}`, row }); continue; }
    const file = byPath.get(target) || list.find(candidate => (candidate.webkitRelativePath || candidate.name).endsWith(target));
    if (!file) { diagnostics.push({ severity: 'error', message: `Missing manifest target: ${target}`, row }); continue; }
    if (Number.isFinite(file.size) && file.size !== row.size_bytes) diagnostics.push({ severity: 'warning', message: `Size mismatch for ${target}: manifest ${row.size_bytes}, local file ${file.size}.`, row });
    if (verifyChecksums && /^[a-f\d]{64}$/i.test(row.sha256) && file.arrayBuffer) {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (actual.toLowerCase() !== row.sha256.toLowerCase()) diagnostics.push({ severity: 'error', message: `SHA-256 mismatch for ${target}.`, row });
    }
    try { datasets.push({ manifest: row, rdf: parseRdf(await file.text(), target) }); }
    catch (error) { diagnostics.push(...(error.diagnostics || [{ severity: 'error', message: error.message }]).map(item => ({ ...item, source: target }))); }
  }
  datasets.sort((a, b) => a.manifest.pressure_pa - b.manifest.pressure_pa);
  return { rows: manifest.rows, datasets, diagnostics };
}
