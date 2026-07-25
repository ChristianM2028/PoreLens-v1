# PoreLens repository instructions

## Purpose

PoreLens is a local-first scientific application for investigating why
pressure-dependent RASPA radial distribution functions (RDFs) change. It should
connect three kinds of evidence:

1. RDFs across pressure and chain length;
2. RASPA run metadata, loading, and sampling quality; and
3. molecular configurations from RASPA PDB movie trajectories.

The primary scientific use cases are:

- compare alkane and perfluoroalkane behavior without hard-coding either family;
- investigate narrow CF3–framework distance bands versus broader
  CH3–framework distributions;
- identify whether long-chain adsorbates repeatedly contact specific
  framework environments, such as carboxylates rather than Zn sites;
- distinguish a persistent structural motif from a large, poorly sampled
  low-loading value of `g(r)`; and
- export the numerical evidence behind visual conclusions for later analysis.

This is a scientific analysis tool, not an automated mechanism generator.
Describe what the data support and keep interpretation visibly separate from
measurement.

## Current repository state

The current `index.html`, `styles.css`, and `app.js` form a visual prototype.
They do not yet parse or analyze the selected files. The C5 data, confidence
score, distances, energy bars, trajectory-frame count, and conclusions shown
in the interface are hard-coded demonstration content.

Do not mistake the prototype UI for implemented functionality. Preserve the
useful visual identity, but replace fabricated values with real calculations
or clearly label them as synthetic demo values. Never present hard-coded
scientific claims after a real dataset has been selected.

The README currently describes XYZ movies, but the canonical RASPA trajectory
input for this project is a multi-model PDB such as
`Movies/System_0/AllComponents.pdb`.

## Non-negotiable scientific rules

- Never infer interaction energy, binding strength, causality, or a confidence
  percentage from an RDF peak alone.
- A large `g(r)` at low loading can represent very little sampled pair weight.
  Always expose loading and RASPA's unnormalized distance histogram beside
  normalized `g(r)`. Do not call column 4 an integer contact count: the supplied
  fixture contains non-integer values.
- Never silently delete, hide, or cap high-`g(r)` values. Robust color limits
  are allowed only when clipped values remain visibly marked and the true
  maximum is reported.
- Low-count rows may be excluded from derived metrics only through an explicit,
  pair-specific quality rule. The raw row must remain viewable and must be
  labeled with the exclusion reason.
- Keep framework labels such as `O1`, `O2`, and `Zn1` distinct. Equal force-field
  parameters do not make structurally different sites equivalent.
- Do not split an RDF pair filename at an arbitrary underscore. Pseudoatom names
  such as `CH3_sp3` and `CF3_sp3` contain underscores. Resolve pair names using
  known pseudoatom labels, metadata, or an explicit user mapping.
- Do not assume chain lengths, component names, pressure counts, atom labels,
  filenames, or successful runs. Discover them from the imported data.
- Do not call pressure sensitivity statistical significance. Significance
  requires block uncertainties or independent replicates.
- Do not calculate a coordination number unless the required target number
  density and pair semantics are known. State the density and formula used.
- Do not claim pairwise Lennard–Jones attribution unless coordinates,
  force-field parameters, mixing rules, exclusions, cutoff treatment, and
  periodic-boundary behavior are all available and validated. Until then,
  label the feature as contact frequency or geometric evidence.
- For the neutral IRMOF-1 model, distinguish conclusions within that
  charge-free model from claims about real electrostatic site preference.

## Canonical supplied data contracts

### Manifest

Treat `manifest.csv` as the authoritative inventory for an RDF collection. The
observed schema is:

```text
n_value
component
run
pressure_pa
pressure_bar
rdf_filename
source_relative_path
collected_relative_path
size_bytes
sha256
```

Observed datasets contain thousands of RDF rows, up to 50 pressure runs per
component, missing runs for some components, and different pair sets between
components. `collected_relative_path` is resolved relative to the manifest
directory. Preserve `run` as a string because run directories may be named
`1`, `1_otherstuff`, and similar.

Use `pressure_pa` as the canonical pressure value and derive display units from
it. Do not treat row order or run number as pressure order. Validate duplicate
`(component, run, rdf_filename)` keys. SHA-256 verification should be available
as an optional integrity check, not an unnecessary prerequisite for browsing.

The current manifest inventories RDF files and copied `simulation.input` files,
but not RASPA output files, PDB movies, CIFs, molecule definitions, or
force-field files. Extend the import model rather than overloading RDF rows
when those asset types are added.

### RASPA RDF

The canonical supplied fixture `RDF_CF3_sp3_O2.dat` documents each RDF row as:

```text
bin_index  distance_A  g_r  raw_histogram
```

Ignore blank lines and supported comment lines. Require at least two finite
numeric rows, a strictly increasing distance grid, and at least four columns.
Retain all four columns. If pressure runs use slightly different distance
grids, interpolate to a reference grid with a visible warning and test the
interpolation; do not conceal major incompatibilities.

The supplied example has 500 bin centers from 0.012 to 11.988 A at 0.024 A
spacing. Its fourth-column header is `unnormalized distance histogram`, and its
values are not integers. Preserve that name in parsed data and UI labels.
It is useful as a pair-specific sampling-weight diagnostic, but it is not a
literal number of contacts, a frame count, or a coordination number.

Commit a trimmed canonical fixture that preserves the real header and several
zero and nonzero rows, plus a malformed fixture. Keep the original production
file out of Git unless the user explicitly approves it as a test fixture.

### RASPA output

The supplied output example is from RASPA 2.0.50. It demonstrates that useful
metadata include:

- RASPA version and completion/warning status;
- number of production and initialization cycles;
- external temperature and pressure;
- RDF histogram range, bin count, and write interval;
- movie write interval;
- component identity;
- final average absolute loading and its uncertainty in molecules/unit cell,
  mol/kg, and mg/g;
- average Host–Adsorbate and Adsorbate–Adsorbate energy summaries; and
- whether Coulomb contributions are zero.

Parse the final average-properties summary rather than mistaking intermediate
cycle snapshots for the final loading. Preserve values and uncertainties.
Missing optional sections should produce diagnostics, not abort the dataset.
Do not treat a zero total Coulomb term by itself as proof of a parser error.

### RASPA PDB movie

The expected movie is a multi-model PDB such as
`Movies/System_0/AllComponents.pdb`. It is the framewise source for contact
distances, molecule orientation, clustering, and synchronized playback.

The supplied matched movie establishes important constraints:

- it contains 1,000 `MODEL`/`ENDMDL` frames and repeats `CRYST1` in each frame;
- frames contain either 250 or 260 adsorbate atoms, consistent with 25 or 26
  ten-site molecules;
- it contains no framework atoms, `TER` records, residue numbers, molecule
  identifiers, bonds, or pseudoatom names;
- every adsorbate site is written as atom name/element `C`, so `CF3_sp3` and
  `CF2_sp3` are indistinguishable from the PDB fields alone; and
- coordinates can lie outside the primary `CRYST1` box, consistent with
  whole-molecule/unwrapped output.

Therefore, never assign terminal versus internal sites from the PDB atom name.
Reconstruct molecule boundaries and pseudoatom roles only from matching
component topology plus validated RASPA atom ordering. In this matched C10
output, the embedded topology identifies sites 0 and 9 as `CF3_sp3` and sites
1 through 8 as `CF2_sp3`; that is evidence for this fixture, not a universal
rule. If topology or ordering cannot be validated, playback may remain
available but role-specific contact analysis must be disabled.

The framework must be generated separately from the matching CIF. The supplied
IRMOF-1 CIF contains an asymmetric unit and symmetry operations, not a ready
expanded Cartesian framework. Expand symmetry, deduplicate equivalent sites,
apply the requested unit-cell replication, and validate the generated atom
count before measuring framework contacts. Preserve labels such as `O1` and
`O2` through symmetry expansion. Apply minimum-image distances using the cell
matrix while keeping an explicit display choice between wrapped atoms and
whole molecules.

Create small trajectory fixtures derived from multiple real frames, including
one 25-molecule and one 26-molecule frame. Test lossy PDB labels, absent
molecule delimiters, out-of-cell coordinates, topology reconstruction, and
minimum-image contact distances before calling movie/contact support complete.

### Supporting run files

`simulation.input`, the framework CIF, and molecule/pseudoatom/force-field
definitions are optional for basic RDF browsing but required for increasingly
strong interpretations. Import them when available and report exactly which
capabilities they enable. Never invent missing metadata.

For the supplied matched example, record rather than normalize away these
actual settings: C10 at 300 K and 23299.51811 Pa, a 1x1x1 IRMOF-1 cell,
100,000 production cycles, 50,000 initialization cycles, movies every 100
cycles, RDF output every 1,000 cycles, and a 12.9 A VDW cutoff. A future lab
standard such as 12.8 A is a validation target, not permission to rewrite old
run metadata.

`UseChargesFromCIFFile yes` does not imply nonzero electrostatics. Here the CIF,
framework pseudoatoms, `CF3_sp3`, and `CF2_sp3` all have zero charge, and the
output confirms zero Coulomb terms. Report both the requested charge source
and the effective loaded charges.

The supplied force-field file uses generic framework types (`C_`, `O_`, `Zn_`,
`H_`) while the CIF and output retain numbered structural labels (`C1`-`C3`,
`O1`-`O2`, `Zn1`, `H1`). The RASPA output demonstrates the resolved mixed
interactions. Preserve the numbered structural identity for RDF/contact
analysis even when several labels map to the same LJ parameters.

## Import behavior

Support these inputs incrementally:

1. an RDF collection directory containing `manifest.csv`;
2. `manifest.csv` plus its referenced local files;
3. a safely extracted `.tar`, `.tar.gz`, `.tgz`, `.tar.bz2`, or `.tar.xz`
   collection;
4. a raw RASPA project directory containing `C<n>/<numbered-run>/...`; and
5. explicit individual files for a small diagnostic run.

Archive extraction must reject absolute paths, `..` traversal, links, devices,
and unsupported member types. Large scientific data must remain local and out
of Git. Commit only small, de-identified fixtures needed for tests.

Import should produce a dataset diagnostics report with:

- discovered components, runs, pressures, RDF pairs, trajectories, and
  supporting files;
- missing manifest targets and checksum mismatches;
- duplicate keys or pressures;
- malformed or incompatible RDF grids;
- incomplete/failed RASPA runs;
- absent loading, density, or topology data;
- capabilities enabled and disabled by the available inputs; and
- warnings that are specific enough to act on.

One failed run or pair must not crash the entire import.

## Analysis definitions

Implement scientific calculations in pure, independently tested modules. Keep
plotting and UI code separate from parsing and numerical logic.

### Pressure–distance RDF map

- Sort rows by positive `pressure_pa`.
- Use a logarithmic pressure axis when pressures span orders of magnitude.
- Show normalized `g(r, P)`, the unnormalized distance histogram, and a
  validity overlay.
- Allow the user to inspect the exact pressure, distance, `g(r)`, and
  unnormalized histogram value under the pointer.
- Provide explicit color-scale scope: per pair, same pair across components,
  or global.

### Pressure sensitivity

The reference behavior estimates

```text
d g(r) / d log10(P)
```

with centered local linear regressions over a user-visible odd pressure window.
Distance smoothing and pressure-window size must be recorded with exported
results. Edge rows without a complete regression window should be missing, not
filled with invented derivatives.

### Sampling quality

Calculate quality separately for every RDF pair because different pairs have
different amounts of sampled pair weight. The reference implementation uses:

- sum of the unnormalized distance histogram over distance for each pressure;
- an optional absolute histogram-weight floor;
- an optional fraction of that pair's maximum histogram-weight sum; and
- an optional early jump in `log10(histogram_weight)` to flag undersampled
  low-pressure rows.

Expose thresholds, the reason each row was flagged, and a toggle between all
raw data and analysis-valid data. Treat this as a sampling heuristic, not a
statistical test.

### Peak and shell metrics

For a user-selected distance interval:

- find locally prominent peaks after recorded smoothing;
- track a peak continuously across pressure by nearest position;
- leave a gap rather than switching to a distant shoulder;
- report peak position, height, local prominence, and width;
- compute fixed-shell excess area
  `A_excess = integral(max(g(r) - 1, 0) dr)`; and
- compute the excess-weighted shell centroid when `A_excess > 0`.

The distance interval and every smoothing/tracking parameter must accompany
exports. A peak maximum and a shell centroid are distinct quantities and must
not share a misleading label.

### Coordination number

When the target number density `rho_j` and pair definition are known, use:

```text
CN_ij(R) = 4 pi rho_j integral_0^R g_ij(r) r^2 dr
```

Record the source and units of `rho_j`, the cutoff `R`, and whether the RDF
contains intra- and/or intermolecular pairs. If these are unknown, disable CN
with a clear explanation. Raw histogram count is useful sampling evidence but
is not itself a coordination number.

### Trajectory/contact linkage

After the PDB parser is fixture-backed:

- selecting a pressure and distance band should load the matching movie;
- identify atom pairs whose minimum-image distance lies inside the selected
  band;
- highlight both atoms and their molecule/framework identities;
- show the frame count or contact fraction supporting the feature;
- allow playback, stepping, and jumping to representative/high-contact frames;
- expose periodic images and unwrapping choices; and
- distinguish framework–adsorbate, intermolecular adsorbate–adsorbate, and
  intramolecular contacts.

The movie supplies structural examples and contact persistence. It does not by
itself establish energetic preference.

## Product behavior

The core workspace should provide:

- dataset/import diagnostics;
- dynamic component, run/pressure, and atom-pair selectors;
- synchronized RDF heatmap, individual RDF curve, metric traces, and movie
  view;
- a draggable or brush-selected distance interval;
- side-by-side comparison across chain lengths, pressures, or pair families;
- visible loading, uncertainty, unnormalized histogram weight, and sampling
  status;
- saved analysis selections with parameters and provenance;
- CSV/JSON exports of raw/tidy RDF values, pressure-level metrics,
  pair-level summaries, diagnostics, and selected contacts; and
- PNG/SVG/PDF exports for plots where practical.

Clicking or brushing a heatmap region should update the selected pressure and
distance interval everywhere else. Comparisons such as CH3 versus CF3 must be
driven by selected atom types, not special-case code.

Generated narrative should use cautious language such as “consistent with,”
“localized near,” or “under the simulated model.” Keep observations,
calculations, and hypotheses in separate fields. If AI-readable exports are
added, export numbers and provenance; do not silently replace them with a
generated conclusion.

Preserve the current restrained visual style where it does not interfere with
scientific legibility. Accessibility, readable axes, keyboard operation, and
color maps suitable for color-vision deficiencies take priority over visual
decoration. The application must work without downloading Google Fonts or
other runtime assets from the internet.

## Architecture and performance

Keep the application local-first: user data must not leave the machine.
Do not add cloud upload, analytics, or telemetry.

The present static prototype can be refactored because no real data layer
exists. Before choosing a framework or local backend, document the concrete
need and preserve a simple launch path. Favor:

- typed data models;
- pure parsers and numerical functions;
- streaming or incremental file reads where possible;
- background workers for expensive parsing/calculation;
- cancellation and progress for long imports;
- lazy loading of trajectories; and
- caching keyed by file identity/checksum plus analysis parameters.

Benchmark against the observed scale: roughly 5,560 RDF files, seven
components, and up to 50 pressures per component. Do not load every trajectory
frame or duplicate the entire dataset in memory merely to populate selectors.

If build tooling is introduced, provide a one-command development launch and a
documented production build. Do not require the user to run a server from an
unrelated home directory. Bind local development servers to loopback by
default.

## Testing and verification

No scientific feature is complete without fixture-backed tests.

Minimum tests:

- manifest schema validation, path resolution, duplicate detection, and missing
  files;
- safe archive extraction and path-traversal rejection;
- RDF comments, numeric parsing, monotonic grid validation, interpolation, and
  malformed rows;
- RASPA output metadata, final loading, uncertainty, energy, and completion
  parsing;
- pressure sorting and unit conversion;
- unnormalized-histogram sampling flags;
- local-regression sensitivity on an analytic synthetic matrix;
- peak continuity, including a case where the correct result is a gap;
- shell excess area and centroid on a known curve;
- coordination number on a known curve with supplied density;
- preservation of labels containing underscores and numbered framework sites;
- partial datasets and failed runs remaining browsable; and
- exported values matching the values shown in the UI.

Add one regression fixture for the misleading case: a very high low-pressure
`g(r)` peak with small unnormalized histogram weight and loading. The interface
must retain the peak while warning against interpreting it as a heavily
populated structure.

Before changing a reference calculation, compare the new result against the
trusted Python behavior and explain intentional differences. Never change a
formula merely to make a plot look cleaner.

## Development order

Work in this order unless the user explicitly reprioritizes:

1. Replace fabricated demo claims with a clear synthetic-demo state.
2. Add tiny canonical fixtures and import diagnostics.
3. Implement real manifest and RDF browsing.
4. Implement heatmaps, histogram-weight quality views, metrics, and exports.
5. Parse RASPA output and synchronize loading/metadata.
6. Add fixture-backed PDB movie playback and contact highlighting.
7. Add cross-component comparisons.
8. Consider energy attribution only after all required force-field inputs and
   validation cases exist.

Do not start with automated prose conclusions, confidence scores, or
force-field attribution. The numerical evidence and provenance come first.

## Agent workflow

For each substantial change:

1. Inspect the repository and current fixtures before proposing architecture.
2. State the scientific behavior being implemented and the evidence required.
3. Make the smallest coherent change that advances the development order.
4. Add or update tests in the same change.
5. Run relevant tests and a local smoke test.
6. Report what is implemented, what remains synthetic, and which conclusions
   the available data do not support.

Ask for a representative file instead of guessing a scientific format. The
current matched example is sufficient to begin RDF, run-input, output,
force-field, CIF, and basic PDB parsing. A standalone C10 molecule definition
is still desirable for testing topology parsing from source files, but the
matching RASPA output embeds enough atom-type and connectivity information to
validate this example. Request another representative system before
generalizing topology reconstruction beyond this format.

Do not commit production archives, trajectories, credentials, personal access
tokens, or generated bulk output.
