import {parseRdf} from '../../../importers.mjs';

const KNOWN_SITES=['CH3_sp3','CH2_sp3','CF3_sp3','CF2_sp3','Zn1','O1','O2','C1','C2','C3','H1'];

/** Resolve only complete known labels; never split each underscore. */
export function resolveCatalogPair(filename,knownSites=KNOWN_SITES){
  const stem=filename.replace(/^RDF[_-]?/i,'').replace(/\.(?:dat|txt|data)$/i,'');
  const matches=[];
  for(const left of knownSites)for(const right of knownSites)if(`${left}_${right}`===stem)matches.push([left,right]);
  return matches.length===1?matches[0]:[stem,null];
}

export function normalizedCatalogToBrowserResult(catalog,{datasetId=catalog.name}={}){
  const diagnostics=[...(catalog.diagnostics||[])],datasets=[];
  for(const run of catalog.runs||[])for(const output of run.outputs?.rdf||[]){
    const pair=resolveCatalogPair(output.name),pairIdentity=pair[1]?pair.join(' ↔ '):pair[0];
    const manifest={n_value:Number(run.chain.replace(/^C/i,'')),component:run.chain,run:String(run.run),pressure_pa:Number(run.simulation?.pressurePa),pressure_bar:Number(run.simulation?.pressurePa)/100000,rdf_filename:pairIdentity,source_relative_path:output.path,collected_relative_path:output.path,size_bytes:null,sha256:''};
    const entry={datasetId,chain:run.chain,series:run.simulation?.component?.MoleculeName||run.chain,runId:String(run.run),pressurePa:manifest.pressure_pa,temperatureK:run.simulation?.temperatureK??null,framework:run.simulation?.framework??null,pair,path:output.path,lookup:{rootRelativePath:output.path,fileHandle:output.handle??null},manifest,rdf:null};
    entry.loadRdf=async()=>{if(entry.rdf)return entry.rdf;if(!output.file?.text)throw new Error(`Directory authorization is unavailable for ${output.path}`);entry.rdf=parseRdf(await output.file.text(),output.path);return entry.rdf};datasets.push(entry);
  }
  datasets.sort((a,b)=>(a.manifest.pressure_pa-b.manifest.pressure_pa)||a.path.localeCompare(b.path));
  if(catalog.stats?.rdfs&&!datasets.length)diagnostics.push({severity:'error',code:'rdf_conversion_empty',message:`${catalog.stats.rdfs} RDF files were indexed but none reached the selector model.`});
  return {rows:datasets.map(x=>x.manifest),datasets,diagnostics,catalog};
}

export async function hydrateRdfSeries(result,component,pair){
  const selected=result.datasets.filter(x=>x.manifest.component===component&&x.manifest.rdf_filename===pair);
  const settled=await Promise.allSettled(selected.map(x=>x.loadRdf()));
  settled.forEach((state,index)=>{if(state.status==='rejected')result.diagnostics.push({severity:'error',source:selected[index].path,message:state.reason.message})});
  return selected.filter(x=>x.rdf);
}
