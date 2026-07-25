# PoreLens

PoreLens is a local-first workspace for pressure-dependent RASPA trajectory forensics. The current first milestone removes fabricated scientific conclusions from the prototype: the analysis workspace is hidden until the user explicitly opens a clearly labeled synthetic interface demonstration. Selecting real files does not yet parse them and never displays the demonstration as measured results.

The planned canonical trajectory input is a multi-model PDB such as `Movies/System_0/AllComponents.pdb`, not XYZ. Manifest/RDF parsing and fixture-backed import diagnostics are the next milestone.

## Run locally

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8000`. Selected files stay in the browser; there is no upload, telemetry, or runtime web-font download.

## Test

```bash
node --test
```
