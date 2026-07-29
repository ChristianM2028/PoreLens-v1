# PoreLens

PoreLens is a local-first workspace for pressure-dependent RASPA trajectory forensics. The current first milestone removes fabricated scientific conclusions from the prototype: the analysis workspace is hidden until the user explicitly opens a clearly labeled synthetic interface demonstration. Selecting real files does not yet parse them and never displays the demonstration as measured results.

The importer now accepts either a collection folder or an explicit `manifest.csv` plus its referenced RDF files. It validates the canonical manifest schema, resolves `collected_relative_path`, keeps runs as strings, sorts parsed RDF datasets by canonical pressure in Pa, and reports malformed or missing RDF files without discarding the rest of the collection. RDF rows retain `g(r)` and the noninteger **unnormalized distance histogram** separately.

The canonical trajectory input is a multi-model PDB such as `Movies/System_0/AllComponents.pdb`, not XYZ. Pure modules now parse the representative run settings and multi-model PDB, preserve out-of-cell coordinates, and apply orthorhombic minimum-image distances. Because the PDB labels every site `C`, role-specific analysis is enabled only when callers supply an explicitly validated sites-per-molecule topology and atom ordering. CIF symmetry expansion, RASPA final-output parsing, safe archive import, and interactive trajectory rendering remain future work; no energetic interpretation is made.

The analysis module provides pair-specific histogram-weight quality rules, centered local regression against `log10(P)`, peak detection and continuity tracking, shell excess metrics, and density-gated coordination numbers. These are pure numerical foundations: the current browser workspace exposes real manifest/RDF curves and tidy CSV export, but does not yet expose every analysis parameter or trajectory contact interactively.

## Run locally

```bash
npm start
```

Then open `http://127.0.0.1:8000`. The supported server binds to loopback by
default and sends `Cache-Control: no-cache` for HTML and the complete unbundled
JavaScript module graph. Startup-stage URLs also carry the shared application
revision. Long-lived immutable caching is only safe for assets whose URL changes
with their contents. Selected files stay in the browser; there is no upload,
telemetry, or runtime web-font download.

### Recover after an application update

If startup reports **mixed application versions**, stop the local server and
confirm that your terminal is in the intended repository checkout. Restart it
with `npm start`, then close stale tabs and perform a cache-bypassing reload
(`Ctrl+Shift+R` / `Cmd+Shift+R`) or clear this origin's cached site data. A normal
reload can retain incompatible ES modules from an older application revision;
do not interpret this deployment diagnostic as a dataset or extractor failure.

## Test

```bash
node --test
```

## Campaign ingestion and audit CLI

The standalone `poreview/ingestion` package discovers runs by recursively
finding `simulation.input`, not by requiring `C<n>/<number>` names. It parses
run settings and component blocks, resolves definitions with explicit and
content-adjacent evidence, indexes RDF/end-to-end/VTK outputs semantically,
and writes a regenerable metadata-only `.poreview/index.json`. VTK records are
header-indexed and their large arrays remain lazy.

```bash
npm run scan -- /path/to/dataset --report
# machine-readable audit
node poreview/cli.mjs scan /path/to/dataset --json
```

Missing definitions and optional output folders produce per-run diagnostics;
they do not remove a partially completed run from the dataset. Repeated scans
compare file size and modification-time fingerprints (with optional hashes for
small files) and mark unchanged normalized run metadata as cache-reused. See
`INGESTION_ARCHITECTURE.md` for the pre-change scanner audit, responsibility
boundaries, and current browser-adapter status.

## Annotation-driven movie LJ milestone

The first movie-analysis layer is implemented as pure ES modules rather than
copying the reference scripts' system-specific workflow:

- `raspa-package.mjs` audits run-package inputs and refuses quantitative LJ
  attribution when the movie, cutoff, force field, topology, CIF mapping, or
  other essential input is absent or contradictory. A missing trajectory is a
  capability warning, not a reason to discard RDFs or annotations.
- `raspa-physics.mjs` parses pseudoatoms, mixing rules, pair overrides,
  molecule site order/intramolecular VDW pairs, CIF cells and framework sites;
  implements triclinic minimum images, shifted/truncated LJ, and deterministic
  physics fingerprints.
- `movie-analysis.mjs` compiles annotations only with explicit scope
  (`pair_only`, `anchor_site`, `whole_molecule`), pair criterion (`any`,
  `nearest`, `all`), and reference selection. Pressure annotations select exact
  simulated run/pressure identities. Results are versioned and explicitly
  labeled as reconstructed coordinate-based pairwise LJ, with JSON-ready data
  and a pair contribution CSV export.
- `lj-workflow.mjs` executes validated framewise selections and reference
  populations, normalization, guest–framework/guest–guest separation, block
  uncertainty, and pressure grouping. `lj-ui.mjs` exposes that workflow in the
  browser with progress, unavailable/error/success states, sortable results,
  progressive diagnostics, and JSON/CSV downloads.

### Browser workflow

Load an RDF manifest collection, create or import annotations, and choose
**Movie / LJ analysis**. Select one chain-series dataset directory (the fixed
layout is `C<n>/<numeric-run>/`) or one run directory. PoreLens parses each
`simulation.input`, matches numerically parsed all-components movie names below
`Movies/`, and builds a cached dataset → family → chain → pressure/run → movie
catalog. **Refresh Dataset** rescans the authorized selection; changing a
dropdown does not. Browsers preserve relative paths during folder selection,
and the interface explicitly asks for reselection when a prior directory grant
is unavailable. Manual multi-file selection remains available only as a
fallback for unusual layouts.

Supporting CIF, molecule definitions, pseudoatoms, mixing rules, and overrides
may remain in the run, dataset ancestors, `common_inputs`, or manifest-referenced
paths. Candidates are content-parsed and fingerprinted; content-distinct
ambiguities are reported instead of resolved by basename. The manifest remains
authoritative for chain/run pressure mapping, while contradictions with
`simulation.input` or movie metadata remain visible on the original numbered
run. Review the
parsed cutoff, potential mode, mixing rule, mapping count, diagnostics, and
physics fingerprint, then select one or more annotations. Radial annotations
require an explicit scope, pair criterion, reference population, and
normalization; pressure-only annotations require an explicit reference and
normalization. The Run button stays disabled until the package and choices are
valid. Results show selected/reference populations, normalized energies,
guest–framework and guest–guest counts, block standard errors, pressure rows,
filterable/sortable pair contributions, provenance, mappings, limitations, and
download controls.

Run packages may be selected separately from the RDF collection so a missing
large trajectory does not prevent annotation browsing. The imported
`simulation.input` pressure must exactly match the annotated simulated
pressure. A package without a movie, an unresolved RDF pair, ambiguous mapping,
or incomplete force field produces an unavailable or failure state instead of
a numerical result.

### Reference-script audit

`custom_movie_analysis.py` hard-codes C10, sites 0/9 as terminal, chemistry
names, LJ parameters, a 4.5–5.5 Å nearest-Zn condition, Lorentz–Berthelot
mixing, orthorhombic boxes, unshifted/truncated behavior, and per-terminal or
backbone normalizations. It does not read the run force field, cutoff behavior,
or topology. Its useful symmetry expansion, minimum-image geometry, frame
iteration, pair accumulation, and block grouping were separated and made
input-driven; its constants and implicit selection semantics were replaced.

`c10_pocket_decomposition.py` inherits those assumptions and additionally fixes
framework labels, Zn/O coordination cutoffs, radial bins, nearest-Zn inside vs
outside control, terminal-only attribution, and PFA-specific local axes. Its
pair/type accumulation and selected-minus-reference concept informed the
structured result, but the fixed pocket geometry and silent outside control
were not reused. `rdf_pressure_heatmaps.py` provides useful manifest/RDF parsing
ideas but is not a physical movie-energy implementation.

### Required inputs and current limits

Quantitative movie LJ reconstruction requires an exact `simulation.input`, PDB
movie, matching adsorbate molecule `.def`, framework CIF, `pseudo_atoms.def`,
`force_field_mixing_rules.def`, and any applicable `force_field.def` overrides.
The cutoff, shifted/truncated mode, mixing rule, every interacting type,
movie/topology ordering, molecule boundaries, periodic cell, framework mapping,
and relevant exclusions must resolve without ambiguity. Output `.data`, RDF
manifest/files, and the annotation sidecar are required for source validation
and aggregate comparison when those capabilities are requested.

The workflow does not claim a RASPA total potential: tail corrections are not
localized, rounded PDB coordinates can perturb steep repulsions, and compatible
RASPA output totals can also differ due to sampling, electrostatics, framework
treatment, and excluded intramolecular terms. CIF symmetry operations used by
the representative fixture are expanded and deduplicated; arbitrary CIF
expression dialects, Ewald/electrostatic reconstruction, flexible frameworks, changing cells,
The milestone does not claim a RASPA total potential: tail corrections are not
localized, rounded PDB coordinates can perturb steep repulsions, and compatible
RASPA output totals can also differ due to sampling, electrostatics, framework
treatment, and excluded intramolecular terms. General CIF symmetry expansion,
Ewald/electrostatic reconstruction, flexible frameworks, changing cells,
anisotropic or non-LJ potentials, and tail-correction attribution remain
unsupported. The included two-frame trimmed PDB preserves one 25-molecule and
one 26-molecule frame, lossy all-C labels, absent molecule delimiters, and
out-of-cell coordinates for routine parser tests; the complete movie remains
an optional integration fixture.

## End-to-end and VTK run outputs

The full-dataset browser catalogs RDFs, recursively discovered
`EndToEndDistanceHistograms/` files, legacy `.vtk` grids, and PDB movies as
independent run capabilities. A run with no RDF can still open its histogram,
VTK, or movie catalog. Files are parsed only when selected; **Refresh Dataset
cache** invalidates successful result parses.

End-to-end files currently use the common ASCII two-column distance/value
form. Header text determines whether values are identified as probability
density or raw weights; otherwise the UI says stored values. Probability views
are available only for positive finite integrals. Statistics use the continuous
piecewise-linear curve and report no uncertainty when the source supplies none.
The matching component definition supplies ordered terminal pseudoatoms;
missing/invalid definitions and C1/C2 interpretation are warned rather than
inferred. Movie-derived conformations are not substituted for the online RASPA
observable.

VTK support is intentionally strict: ASCII legacy `STRUCTURED_POINTS` and
`IMAGE_DATA`, scalar arrays, dimensions, origin, spacing, and stored values are
preserved. The browser supplies orthogonal slices, thresholded 3D voxel
projection, opacity, linear/log color mapping, explicitly display-only maximum
normalization, screenshots, and visualization-state JSON. Difference utilities
require identical geometry and scalar names and never regrid. Scalar values
remain labeled **stored scalar value** because generic legacy VTK headers do not
establish physical units or normalization. Binary/XML VTK, true polygonal
marching-cubes geometry, arbitrary framework/grid registration, synchronized
side-by-side rendering, and production-scale worker geometry are remaining
limitations; parsing yields to the browser before large VTK work but is not yet
implemented in a dedicated Web Worker.
