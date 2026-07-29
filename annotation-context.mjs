/** Build annotation provenance from one normalized RDF catalog row. */
export function rdfAnnotationContext({slot,datasetFingerprint,item}){
  if(!Array.isArray(item?.pair)||item.pair.length!==2)throw new Error('The selected RDF has no resolved structured pair identity');
  return {datasetSlot:slot,datasetFingerprint,chainLength:item.manifest.component,atomPair:[...item.pair],run:item.manifest.run,pressurePa:item.manifest.pressure_pa,rdfFilename:item.manifest.rdf_filename,rdfRelativePath:item.manifest.collected_relative_path,rdfFingerprint:item.manifest.sha256||null};
}
