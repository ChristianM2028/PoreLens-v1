# Reference-script audit for the interactive chain-series plotter

The scripts in `reference_scripts/` remain unchanged and are behavioral references, not runtime dependencies.

## `collect_rdfs.py`

Reusable behavior includes the strict `C<n>` component expression, numeric chain sorting, preservation of the run-directory string, pressure extraction from active `ExternalPressure` input, content checks, checksums, and a manifest that retains source and collected paths. The browser catalog uses the same immediate-root `C<n>` rule and makes the manifest primary.

Assumptions not carried into PoreLens include recursive RDF discovery as the complete inventory, a first pressure directive as sufficient run metadata, selection by filename substring, three-column RDF acceptance, and collection as a prerequisite. PoreLens requires four RDF columns, resolves underscore-bearing pseudoatoms only with known labels, retains missing results as diagnostics, and treats output/input cross-checking as additive metadata rather than silently replacing manifest pressure.

## `plot_report.py`

Reusable behavior includes numeric component ordering, selectable linear/log axes and units, multiple-dataset overlays, provenance-bearing series, optional literature/sidecar overlays, and headless export.

Its static-report input contracts (`final_abs_pressure_up`, `final_abs_fug_up`, and `final_mix_abs_molkg`) are adsorption tables rather than RDF or end-to-end results. Its broad path inference accepts names such as `C1_alk`; the interactive catalog deliberately rejects those as chain directories. The script assumes shared table schemas and user-selected unit declarations, and its auto-discovery identifies any directory having numbered children. The interactive implementation instead uses the selected full-dataset catalog, explicit result types, actual per-curve run/pressure, explicit matching failures, and parsed-file caching.

## Interactive differences

The plotter never invents a common pressure grid: exact, nearest-with-visible-tolerance, manual-run, and loading modes return explicit unmatched groups. RDF and probability-density histogram records remain in pure parsing/catalog modules. Only visible curves enter CSV/JSON exports. Configuration state is stored separately from file content so it can be restored without rescanning, while result files are loaded on demand and the Refresh Dataset event clears parsed-file cache. End-to-end terminal labels are not inferred from histogram filenames or PDB atom names; until a validated molecule topology supplies the terminal-site mapping, the UI must treat that mapping as ambiguous.
