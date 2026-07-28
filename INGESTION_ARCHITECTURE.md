# Simulation ingestion architecture

## Audit of the replaced flow

The previous browser flow had two independent scanners. `run-discovery.mjs`
materialized a selected `FileList`, inferred runs with a fixed
`C<n>/<numeric-run>/simulation.input` regular expression, and only recognized
exact `Movies`, `RadialDistributionFunctions`, `EndToEndDistanceHistograms`,
and `VTK` paths. `directory-catalog.mjs` separately traversed browser directory
handles, but its top-level `C<n>` and child numeric checks prevented arbitrary
or nested run names from reaching its run indexer. Both scanners opened
`simulation.input`; package import then parsed definitions again.

The old path made these assumptions:

* chain identity came from `C<n>` and pressure-run identity from a number;
* one exact component definition name and fixed standard dependency basenames
  were sufficient;
* output directory spelling and depth were fixed;
* movie selection described the run using filename fields;
* mixtures were rejected by trajectory validation rather than represented in
  the catalog; and
* RDF, VTK, and histogram interpretation occurred after UI selection using raw
  file/path objects rather than normalized run records.

Consequently, the UI owned discovery decisions, two catalogs could disagree,
nonstandard or partial runs disappeared, and analysis features needed to
rescan or reinterpret raw paths. Exact output names and arbitrary underscore
splitting also risked misclassifying scientific records.

## Replacement

`poreview/ingestion` is now the only campaign discovery/indexing layer for
filesystem datasets. A run is evidence-based: every distinct directory that
contains `simulation.input` becomes a `SimulationRun`. Parsed pressure,
temperature, framework, and components remain separate from useful parent-path
metadata. Missing optional files are capabilities plus diagnostics, never a
reason to omit the run.

Responsibilities are separated as follows:

* `models.mjs` defines the normalized JSON-safe contract.
* `discovery.mjs` finds runs, deduplicates real paths, sorts by parsed pressure,
  and coordinates persistent indexing.
* `resolver.mjs` ranks explicit component evidence, exact and standard names,
  ancestor/common inputs, and unique definitions; ties stay ambiguous.
* `indexer.mjs` joins input metadata, definitions, and lazy output records.
* `cache.mjs` owns regenerable `.poreview/index.json` persistence and file
  fingerprints.
* `poreview/parsers` contains format-specific pure parsers/indexers. RDF pair
  resolution uses known complete pseudoatom names, and VTK initial scanning
  reads only a small header rather than coordinate/scalar arrays.
* `cli.mjs` exposes the same normalized ingestion operation to humans and
  automation.

The static browser cannot invoke the Node/Python filesystem indexer. For the
static application, `poreview/ingestion/browser/directory-handle-discovery.mjs`
is therefore the authoritative directory-handle discovery implementation. It
emits the same normalized run/RDF concepts while retaining authorized file
handles for lazy reads. `catalog-adapter.mjs` is the single conversion boundary
from those normalized records into the plotting workspace's manifest-shaped
records. Persisted snapshots are metadata-only: the UI does not treat them as
usable until the saved directory handle has been reauthorized and rescanned.
The compatibility `FileList` manifest importer remains a separate fallback.
