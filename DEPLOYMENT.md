# Static asset revision and deployment

The HTML revision marker, every browser module specifier, and stylesheet URL use
`porelens-20260729-indexed-pdb-v1`. `npm start` serves from the repository root,
marks HTML and unversioned paths for revalidation, and gives immutable caching
only to URLs carrying the current `rev` value. It also returns the revision as
`X-PoreLens-Revision` on every successful response.

Deploy a release into a new directory, verify the complete module graph there,
and switch the server root (or a symlink to it) atomically. Never copy
unversioned ES modules over a live release one file at a time. A reverse proxy
must retain the origin `Cache-Control` policy and be purged when the HTML pointer
is switched. Old revision-addressed assets may be removed only after old HTML
can no longer be served.

For incident verification, disable the browser cache, clear site data and any
service-worker registration, then open a new tab. In Network, preserve the log
and record the full URL, status, response headers, initiator, and body revision
for `index.html`, `app.js`, `raspa-package.mjs`, and `trajectory.mjs`. All four
must report the same `X-PoreLens-Revision`; `raspa-package.mjs` must import
`indexPdbSource`, and `trajectory.mjs` must declare
`export async function indexPdbSource`.
