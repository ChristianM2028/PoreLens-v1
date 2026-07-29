# Local directory ingestion profile

The compatibility path previously used `Array.from(files)` in `src/import/importers.mjs`,
then built path maps, searched the materialized list repeatedly, read and parsed
every manifest RDF, sorted all parsed datasets, and dispatched another
`Array.from(files)` from `src/ui/app.js`. The chain and LJ catalogs separately spread
the same `FileList`; LJ import also used an unbounded `Promise.all` while reading
every chosen file. That path remains only as the explicitly labelled fallback.

The primary picker now walks only immediate `C<n>/<numeric-run>` handles. It
reads the root manifest and `simulation.input`, catalogs relevant output names
and handles, skips `Output` and `Restart`, yields in bounded batches, and parses
simulation metadata in a worker where supported. Scientific output content is
loaded by the existing selected-file views, behind a size-aware LRU.

Run `node scripts/benchmark-catalog.mjs` for the reproducible 69,999-entry synthetic
benchmark. The benchmark uses 2 GB movie/VTK placeholder metadata so any eager
content read is conspicuous, reports event-loop ticks/yields as a responsiveness
proxy, and reports Node heap delta because browser `measureUserAgentSpecificMemory`
is permission- and cross-origin-isolation-dependent. Browser DevTools remains
the authoritative peak-memory measurement for a real directory.
