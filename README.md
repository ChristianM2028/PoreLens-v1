# PoreLens

PoreLens is a local-first workspace for pressure-dependent RASPA trajectory forensics. The current first milestone removes fabricated scientific conclusions from the prototype: the analysis workspace is hidden until the user explicitly opens a clearly labeled synthetic interface demonstration. Selecting real files does not yet parse them and never displays the demonstration as measured results.

The importer now accepts either a collection folder or an explicit `manifest.csv` plus its referenced RDF files. It validates the canonical manifest schema, resolves `collected_relative_path`, keeps runs as strings, sorts parsed RDF datasets by canonical pressure in Pa, and reports malformed or missing RDF files without discarding the rest of the collection. RDF rows retain `g(r)` and the noninteger **unnormalized distance histogram** separately.

The canonical trajectory input is a multi-model PDB such as `Movies/System_0/AllComponents.pdb`, not XYZ. RASPA output, topology, CIF expansion, trajectory reconstruction, and safe archive import require representative source fixtures before their parsers can be implemented without guessing their exact formats.

## Run locally

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8000`. Selected files stay in the browser; there is no upload, telemetry, or runtime web-font download.

## Test

```bash
node --test
```
