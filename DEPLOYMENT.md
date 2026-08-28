# Static asset revision and deployment

`asset-revision.mjs` is the release-time source of truth for the HTML revision
marker, every browser module specifier, the stylesheet URL, and the local
server. Before publishing any changed browser asset or changed module exports,
run `npm run assets:revision -- <new-unique-revision>` and commit all generated
URL updates together. The command refuses to reuse the current revision.

`npm start` serves from the repository root, marks HTML and unversioned paths
for revalidation, and gives immutable caching only to URLs carrying the current
revision. It also returns that value as `X-PoreLens-Revision` on every successful
response.

Deploy a release into a new directory, verify the complete module graph there,
and switch the server root (or a symlink to it) atomically. Never copy
unversioned ES modules over a live release one file at a time. A reverse proxy
must retain the origin `Cache-Control` policy and be purged when the HTML pointer
is switched. Old revision-addressed assets may be removed only after old HTML
can no longer be served.

If a deployment has already mixed an importing module with an older immutable
dependency that lacks one of its exports, **publish the corrected complete graph
under a new revision immediately**. Merely refreshing the page cannot reliably
replace an immutable cached module, and publishing different bytes at its old
URL violates the cache contract. Keep the old graph intact while the new HTML
pointer and all new-revision assets are deployed atomically.

For incident verification, disable the browser cache, clear site data and any
service-worker registration, then open a new tab. In Network, preserve the log
and record the full URL, status, response headers, initiator, and body revision
for `index.html`, `src/ui/app.js`, `src/core/raspa-package.mjs`, and `src/core/trajectory.mjs`. All four
must report the same `X-PoreLens-Revision`; `src/core/raspa-package.mjs` must import
`indexPdbSource`, and `src/core/trajectory.mjs` must declare
`export async function indexPdbSource`.

## Required renderer deployment verification

A successful `git pull` is not evidence that the running renderer changed. After
updating the release checkout, run `npm install` when dependencies changed and
**restart the PoreLens server process** (or atomically switch the release and
restart its service). Then verify the origin before opening the application:

```sh
npm run deploy:smoke -- https://your-porelens-origin.example <expected-revision>
```

The check fetches `index.html` without cache, requires its revision meta value
and `X-PoreLens-Revision` header to match, then fetches the revisioned
`chain-plotter-ui.mjs` and verifies its module graph and immutable cache policy.
Do not begin visual assertions unless this command passes.

Finally, close old application tabs and perform a hard refresh in a new tab
(with DevTools cache disabled during incident verification). Confirm the footer
shows the expected **Renderer revision** and, when deployment injects a
`porelens-commit` meta tag, the expected Git commit. If either differs, stop:
the new source checkout is not the renderer being served.
