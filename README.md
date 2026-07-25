# PoreLens

PoreLens is a local-first workspace for pressure-dependent RASPA trajectory forensics. The current first milestone removes fabricated scientific conclusions from the prototype: the analysis workspace is hidden until the user explicitly opens a clearly labeled synthetic interface demonstration. Selecting real files does not yet parse them and never displays the demonstration as measured results.

The importer now accepts either a collection folder or an explicit `manifest.csv` plus its referenced RDF files. It validates the canonical manifest schema, resolves `collected_relative_path`, keeps runs as strings, sorts parsed RDF datasets by canonical pressure in Pa, and reports malformed or missing RDF files without discarding the rest of the collection. RDF rows retain `g(r)` and the noninteger **unnormalized distance histogram** separately.

The canonical trajectory input is a multi-model PDB such as `Movies/System_0/AllComponents.pdb`, not XYZ. Pure modules now parse the representative run settings and multi-model PDB, preserve out-of-cell coordinates, and apply orthorhombic minimum-image distances. Because the PDB labels every site `C`, role-specific analysis is enabled only when callers supply an explicitly validated sites-per-molecule topology and atom ordering. CIF symmetry expansion, RASPA final-output parsing, safe archive import, and interactive trajectory rendering remain future work; no energetic interpretation is made.

The analysis module provides pair-specific histogram-weight quality rules, centered local regression against `log10(P)`, peak detection and continuity tracking, shell excess metrics, and density-gated coordination numbers. These are pure numerical foundations: the current browser workspace exposes real manifest/RDF curves and tidy CSV export, but does not yet expose every analysis parameter or trajectory contact interactively.

## Run locally

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8000`. Selected files stay in the browser; there is no upload, telemetry, or runtime web-font download.

## Test

```bash
node --test
```
