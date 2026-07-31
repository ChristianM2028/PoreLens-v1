/** @deprecated Compatibility facade. Browser discovery lives in poreview/ingestion. */
export * from './browser/directory-handle-discovery.mjs?rev=porelens-20260731-literature-axis-v3';

/** Authorized-file index shared by every workspace; values stay lazy File/handle references. */
export class AuthorizedRunCatalog {
  constructor(datasetFingerprint){this.datasetFingerprint=datasetFingerprint;this.runs=[]}
  add(run){this.runs.push({...run,datasetFingerprint:run.datasetFingerprint||this.datasetFingerprint});return this}
  files(run){return Object.values(run.files||{}).flat().filter(Boolean)}
}
