# PoreLens

## Three independent local workflows

PoreLens has three deliberately isolated dataset lifecycles. **GCMC adsorption/RDF**
accepts the existing manifest or raw-project inputs and supports adsorption isotherms,
RDFs, sampling-weight diagnostics, and trajectory evidence. **GEMC** analyzes two-box
vapor–liquid coexistence. **Henry** analyzes final Widom/Henry summaries. Importing or
resetting one workflow cannot replace, merge with, or supply metadata to another. All
file reads and calculations occur locally in the browser; PoreLens has no upload or
telemetry endpoint.

### GEMC input and calculations

Choose a directory containing one or more discovered run roots with paired files such
as `run/Output/System_0/output_*.data` and
`run/Output/System_1/output_*.data`. A nearby `simulation.input` may supply
`ExternalTemperature` when the output does not. Folder names, system order, chain
lengths, and temperature-directory conventions are not assumed. Explicit `.data`
outputs can also be selected through the browser file control where directory upload
is supported.

For every box, PoreLens retains complete periodic cycle observations, density,
average pressure (or a visibly labelled instantaneous stress-trace fallback), cycle
number, original system identity, completion status, and source path. The lower-density
box is classified as vapor. The displayed coexistence pressure is the arithmetic mean
of the two box pressures; both inputs and their percent mismatch remain visible.
Replicates are grouped by parsed temperature and by `(framework, component)`. Densities
are arithmetic means of finite replicate values. Coexistence pressure is the arithmetic
mean of the finite replicate coexistence pressures; missing and nonfinite pressures are
excluded from that average, with included/excluded counts and every source run retained.
Selecting “All” never joins components or frameworks: every discovered group has an
independent result, including a card explaining why an incomplete group was skipped.

The accessible Clausius–Clapeyron view uses the same framework, component, and
temperature selectors. For each group independently it plots `x = 1/T` in `K^-1` and
`y = ln(P/P_ref)`, where `P` is the arithmetic mean of the paired vapor- and liquid-box
pressures in kPa and the displayed, user-set `P_ref` is also in kPa. Only finite
temperatures above 0 K and finite coexistence pressures above 0 kPa are eligible for
these derived coordinates. Excluded records remain in the raw table and CSV/JSON
exports with actionable reasons, along with both box pressures and their mismatch
diagnostic. Exports record every group, interval, formula, units, reference pressure,
exclusions, active view, and provenance.

Critical-property calculations use the six highest-temperature eligible, distinct
coexistence points by default and fix `beta = 0.325`, matching
`reference_scripts/gemc_vle(2).py`. At least three distinct temperatures with finite
densities and `rho_l > rho_v >= 0` are required. The density model is the rectilinear
diameter plus fixed-exponent scaling

```text
(rho_l + rho_v)/2 = a + b T
(rho_l - rho_v)/2 = B (Tc - T)^beta
rhoc = a + b Tc
```

The pressure fit independently requires at least two distinct temperatures with finite,
positive arithmetic coexistence pressures and uses

```text
ln(P/P_ref) = intercept + slope/T
Pc = P_ref exp(intercept + slope/Tc)
Psat(0.7 Tc) = P_ref exp(intercept + slope/(0.7 Tc))
acentric factor = -log10(Psat(0.7 Tc)/Pc) - 1
```

kPa is the canonical pressure unit and kg/m³ the canonical density unit. Fit inputs,
coefficients, residuals, assumptions, replicate provenance, and interpolation or
extrapolation flags are exported. `Tc` and `rhoc` remain available if the independent
pressure fit fails, while `Pc`, `Psat(0.7 Tc)`, and acentric factor do not. A prominent
warning marks `0.7 Tc` outside the observed pressure-fit interval: extrapolation,
especially a long extrapolation, is not a reliable measured property. All outputs are
**model-derived estimates**, not measurements or uncertainty-qualified reference values.
Fitted coexistence branches and critical points are hidden unless the derived-results
view is explicitly enabled, and browser-local literature overlays never enter a fit.

### Henry input and calculations

Choose a project directory containing discovered RASPA `output*.data` (or explicit
`.out`/`.log`) files. Frameworks, components, and temperatures are parsed from each
output rather than inferred from a fixed directory hierarchy. PoreLens reads the final
`Average Henry coefficient` summary, uncertainty and unit, and the optional final Widom
adsorption-energy summary with uncertainty. Intermediate cycle snapshots are not used
as final values. Incomplete runs remain browsable and missing energy produces a
diagnostic rather than removing an otherwise valid Henry result.

The Henry plot uses logarithmic scaling only when all coefficients are positive and
keeps Henry coefficients distinct from adsorption energies. Original units are stored;
tested conversions currently cover `mol/kg/Pa` and `mol/kg/kPa`. No affinity,
causality, binding-strength, or confidence claim is inferred from either quantity.

### Diagnostics and exports

Each workflow reports explicit empty, importing, partial-success, error, cancelled,
and ready states. Diagnostics identify discovered and usable sources, malformed final
summaries, missing partners, duplicate outputs, missing pressures, incomplete runs,
and optional missing energy. A bad run does not prevent usable runs from being shown.
Selectors and numerical tables are dynamic and preserve source paths.

CSV exports are tidy records using the field names shown by each table. JSON exports
include raw parsed/derived records, diagnostics, analysis settings, source provenance,
and unit definitions. Canvas plots can be exported as view-specific PNG files. SVG export and optional
user-controlled Clausius–Clapeyron regression controls are current limitations.

### Launch

Run `npm start` from this repository and open `http://127.0.0.1:4173`. Run the pure
parser and state tests with `npm test`. Opening `index.html` directly with `file://`
is unsupported because browser ES modules require the local loopback server.

PoreLens is a local-first browser workspace for organizing, validating, visualizing, and comparing pressure-dependent RASPA simulation campaigns.

It is designed for researchers who need to move from a directory tree full of RASPA runs to a defensible scientific interpretation without manually matching pressures, components, trajectories, RDFs, histograms, VTK grids, and force-field inputs one file at a time.

PoreLens keeps selected files in the browser. It does not upload simulation data, require a backend service, or depend on runtime web-font downloads.

> **Project status:** functional prototype. Core ingestion, RDF, histogram, trajectory, Lennard-Jones, and spatial-analysis workflows are available, but some advanced comparison and visualization features are still being stabilized.

---

## What PoreLens does

PoreLens connects multiple RASPA outputs through one shared run model:

- campaign and run discovery;
- isotherm and pressure metadata;
- radial distribution functions;
- RDF pressure heatmaps;
- end-to-end distance histograms;
- PDB trajectory inspection;
- annotation-driven trajectory analysis;
- reconstructed adsorbate–framework Lennard-Jones contributions;
- framework-atom-type decomposition;
- native and reconstructed VTK spatial-density data;
- site-resolved guest occupancy maps;
- cross-run and cross-series comparison;
- provenance, validation, diagnostics, and exports.

The goal is not merely to draw plots. PoreLens is intended to make it clear:

1. which run produced a result;
2. which files and parameters were used;
3. whether the inputs are mutually consistent;
4. which comparisons are scientifically valid;
5. which conclusions are directly supported by the data.

---

## Why use it

A typical RASPA campaign may contain hundreds of run directories and thousands of related files. Important outputs are often separated across:

- `simulation.input`;
- output `.data` files;
- RDF directories;
- end-to-end histograms;
- movie PDBs;
- VTK grids;
- molecule definitions;
- pseudoatom definitions;
- mixing rules;
- framework CIFs;
- annotations and derived results.

PoreLens reduces the need to manually reconstruct those relationships. It also refuses or warns on quantitative analyses when essential topology, force-field, cell, mapping, or provenance information is missing or contradictory.

---

## Main capabilities

### Campaign ingestion

The standalone importer recursively discovers runs by locating `simulation.input`; it does not require a specific `C<n>/<number>` directory layout.

It can:

- parse run settings and component blocks;
- resolve definitions from run, ancestor, `common_inputs`, or manifest-referenced locations;
- index RDF, histogram, VTK, output, and movie capabilities independently;
- preserve partially completed runs;
- report missing or ambiguous inputs without discarding unrelated usable data;
- write a regenerable metadata-only `.poreview/index.json`;
- reuse unchanged normalized run metadata across repeated scans.

Large VTK arrays and trajectories are indexed lazily and parsed only when selected.

### RDF analysis

PoreLens supports manifest-backed and campaign-discovered RDF collections.

Available analysis includes:

- pair-specific RDF curves;
- pressure sorting in canonical units;
- pressure heatmaps;
- peak detection and continuity tracking;
- local regression against `log10(P)`;
- shell-excess metrics;
- density-gated coordination numbers;
- preservation of `g(r)` and unnormalized distance histograms as distinct quantities;
- tidy CSV export.

Malformed or missing RDF files are reported without invalidating the rest of the collection.

### End-to-end distance histograms

End-to-end files are discovered per run and parsed only when opened.

PoreLens can:

- distinguish probability-density, raw-weight, and unknown stored-value semantics from headers;
- normalize positive finite distributions when appropriate;
- compute continuous piecewise-linear summary statistics;
- resolve terminal pseudoatoms from the matching component definition;
- warn rather than guess when topology or terminal interpretation is missing.

Movie-derived conformations are not silently substituted for the online RASPA observable.

### Trajectory and annotation workflow

The canonical trajectory input is a multi-model PDB such as:

```text
Movies/System_0/AllComponents.pdb
```

PoreLens parses multi-model trajectories, periodic cells, and run topology while preserving out-of-cell coordinates for correct periodic handling.

Annotations can be scoped explicitly to:

- a selected atom pair;
- an anchor site;
- a whole molecule;
- an exact simulated pressure;
- selected and reference populations.

The UI requires explicit selection semantics rather than relying on hidden system-specific assumptions.

### Adsorbate–framework Lennard-Jones analysis

PoreLens reconstructs coordinate-based pairwise Lennard-Jones interactions from validated run inputs.

It can report:

- selected and reference populations;
- total reconstructed pairwise LJ energy;
- guest–framework and guest–guest separation;
- normalization per frame, selected site, molecule, or other supported population;
- block uncertainty;
- pressure-grouped results;
- pair contributions;
- decomposition by framework atom type such as `C1`, `C2`, `O1`, `O2`, or `Zn1`;
- physics fingerprints and provenance;
- JSON and CSV exports.

Quantitative analysis requires the exact run package:

- `simulation.input`;
- PDB movie;
- matching molecule definition;
- framework CIF;
- `pseudo_atoms.def`;
- `force_field_mixing_rules.def`;
- applicable pair overrides;
- validated cutoff and shifted/truncated behavior;
- unambiguous movie/topology ordering;
- periodic cell and framework mapping.

PoreLens does **not** claim to reproduce the full RASPA potential energy. Tail corrections are not localized, rounded PDB coordinates can perturb steep repulsions, and RASPA totals may also include electrostatics, framework terms, exclusions, and sampling differences not represented in the reconstructed pairwise LJ result.

### Spatial-density and occupancy analysis

PoreLens supports two related spatial workflows.

#### Native RASPA VTK handoff

Existing RASPA VTK files are indexed as exact-run capabilities. Supported ASCII legacy scalar grids can be validated for:

- dimensions;
- scalar metadata;
- cell registration;
- coordinate bounds;
- stored-value range.

The original VTK bytes can be handed off to tools such as ParaView for full 3D analysis.

#### Trajectory-derived occupancy maps

PoreLens can reconstruct occupancy fields from validated PDB trajectories while preserving pseudoatom identity.

Populations can be restricted to:

- all guest sites;
- molecular centers of mass;
- terminal sites;
- internal sites;
- selected pseudoatom types such as `CF3` or `CF2`;
- other validated topology-based selections.

This makes it possible to compare chemically distinct site preferences rather than treating every atom with the same elemental label as equivalent.

Supported normalization metadata includes:

- observations per sampled frame per voxel;
- physical voxel volume;
- sampled frame range and stride;
- grid dimensions;
- cell origin, matrix, spacing, and wrapping convention.

For comparisons between site types with different multiplicities, use a conditional or per-selected-site normalization rather than raw counts alone.

### Comparison

The comparison workspace is intended to reuse the same run, series, pressure, component, and atom-type metadata as the primary workspaces.

Comparison targets include:

- isotherms;
- RDF curves;
- RDF heatmaps;
- end-to-end distributions;
- compatible histograms;
- adsorbate–framework LJ contributions;
- site-resolved occupancy maps.

Scientifically invalid comparisons should be warned about or blocked when units, grids, cells, force fields, cutoffs, atom mappings, normalization, or reconstruction methods are incompatible.

---

## Quick start

PoreLens is currently served as a static local application.

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8000
```

Selected files remain local to the browser.

---

## Scan a campaign

```bash
npm run scan -- /path/to/dataset --report
```

For machine-readable output:

```bash
node src/import/cli.mjs scan /path/to/dataset --json
```

The scanner writes normalized metadata and diagnostics without copying the simulation dataset.

---

## Typical workflow

1. **Select or scan a dataset.**
2. **Review ingestion diagnostics.**
3. **Choose a family, chain, pressure, run, and component.**
4. **Open the relevant observable**: isotherm, RDF, heatmap, histogram, movie, LJ analysis, or spatial map.
5. **Inspect provenance and validation status.**
6. **Choose normalization and reference populations explicitly.**
7. **Compare only compatible runs or series.**
8. **Export tidy CSV, JSON, figures, or original VTK data.**

A missing trajectory should not prevent RDF analysis. A missing RDF should not prevent histogram or VTK inspection. Capabilities are tracked independently for each run.

---

## Scientific guardrails

PoreLens favors unavailable states and explicit warnings over fabricated precision.

It will not silently infer quantitative results when essential information is absent or contradictory, including:

- unresolved pseudoatom or molecule definitions;
- ambiguous run-package files;
- missing or inconsistent periodic cells;
- invalid molecule boundaries;
- uncertain atom ordering;
- incompatible pressure mappings;
- unsupported potentials;
- incomplete force-field parameters;
- ambiguous framework atom mappings;
- incompatible comparison grids or normalizations.

Diagnostic warnings are part of the result, not implementation noise.

---

## Current limitations

The prototype does not yet provide complete support for:

- electrostatic or Ewald reconstruction;
- flexible frameworks;
- changing simulation cells;
- anisotropic or non-LJ pair potentials;
- localized tail-correction attribution;
- arbitrary CIF symmetry-expression dialects;
- every binary or XML VTK format;
- guaranteed semantic equivalence of atom labels across different frameworks;
- fully stabilized comparison behavior across every workspace.

A framework label such as `O1` is meaningful within its own validated framework mapping. It should not automatically be treated as chemically equivalent to `O1` in an unrelated framework.

---

## Tests

Run the test suite with:

```bash
node --test
```

Tests cover pure parsing, validation, periodic geometry, RDF analysis, topology handling, package resolution, physics fingerprints, and representative trajectory workflows.

---

## Documentation

More detailed implementation and architecture notes belong in focused documents rather than in this README.

Recommended locations:

- `INGESTION_ARCHITECTURE.md` — scanner design and responsibility boundaries;
- `docs/LJ_ANALYSIS.md` — physics model, required inputs, normalization, and limitations;
- `docs/SPATIAL_ANALYSIS.md` — native VTK and reconstructed occupancy semantics;
- `docs/COMPARISON.md` — compatibility rules and comparison data contract;
- `CHANGELOG.md` — chronological milestones and pull-request history.

---

## Design principles

- **Local first:** simulation data stays on the user's machine.
- **Exact-run provenance:** derived results remain tied to their source run.
- **No silent guessing:** ambiguity is reported.
- **Lazy loading:** large outputs are parsed only when needed.
- **Reusable analysis:** one campaign model powers multiple workspaces.
- **Scientific comparability:** normalization and compatibility are explicit.
- **Exportable results:** derived data can leave the UI in documented formats.

---

## Name

This draft preserves the current repository title, **PoreLens**. If the project has officially been renamed **PoreView**, update the title and product-name references consistently before release.

### Browser-local literature overlays

Literature files remain browser-local and are observational plot overlays, not simulation inputs. Each series is scoped to exactly one plot/view (including separate VLE vapor/liquid branches and separate Henry coefficient/energy views), and its two columns are interpreted in the plot's current displayed coordinates and user-assumed units without implicit conversion. Changing an axis quantity or display unit invalidates the overlay until it is revalidated or reimported. Raw source order, malformed-row diagnostics, provenance, and log-axis exclusions remain exportable. Literature values are deliberately excluded from simulation diagnostics, regressions, critical-property calculations, and every other derived analysis; combining them with those calculations requires a future explicit feature.
