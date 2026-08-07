import {buildChainCatalog,buildHandleCatalog,ParsedResultCache} from '../core/chain-series.mjs?rev=axis-label-black-v1';

export const evidenceCatalogs=new Map();
export const evidenceCatalogStates=new Map();
export const parsedResultCache=new ParsedResultCache();
const pending=new Map(),acceptedScanGeneration=new Map();

/** Register metadata without eagerly reading scientific result files. */
export async function registerEvidence(detail={}){
  const slot=detail.slot;if(!slot)return null;
  const scanGeneration=Number(detail.scanGeneration);
  if(Number.isFinite(scanGeneration)&&scanGeneration<(acceptedScanGeneration.get(slot)??-Infinity))return null;
  if(Number.isFinite(scanGeneration))acceptedScanGeneration.set(slot,scanGeneration);
  const request=Symbol(slot);
  const task=(async()=>{
    let catalog;
    const datasetLabel=String(detail.datasetLabel||detail.name||slot);
    if(detail.source==='files'||detail.files){if(!detail.files)return null;catalog=await buildChainCatalog(detail.files,{datasetId:slot,datasetLabel});}
    else if(detail.source==='directory_handle'||detail.catalog){if(!detail.catalog)return null;catalog=buildHandleCatalog(detail.catalog,{datasetId:slot,datasetLabel});}
    else return null;
    if(Number.isFinite(scanGeneration)&&scanGeneration!==acceptedScanGeneration.get(slot))return null;
    catalog.datasetFingerprint=detail.datasetFingerprint??null;
    for(const entry of catalog.results||[])entry.datasetFingerprint=catalog.datasetFingerprint;
    evidenceCatalogs.set(slot,catalog);
    evidenceCatalogStates.set(slot,{scanning:detail.scanning===true||detail.state==='scanning',source:detail.source});
    window.dispatchEvent(new CustomEvent('porelens:evidence-catalog-changed',{detail:{slot,catalog}}));
    return catalog;
  })().finally(()=>{if(pending.get(slot)?.request===request)pending.delete(slot)});pending.set(slot,{request,task});return task;
}
export function removeEvidence(slot){evidenceCatalogs.delete(slot);evidenceCatalogStates.delete(slot);acceptedScanGeneration.delete(slot);}
export function relabelEvidence(slot,datasetLabel){const catalog=evidenceCatalogs.get(slot);if(!catalog)return null;catalog.datasetLabel=datasetLabel;for(const entry of catalog.results||[])entry.datasetLabel=datasetLabel;window.dispatchEvent(new CustomEvent('porelens:evidence-catalog-changed',{detail:{slot,catalog}}));return catalog;}
export function evidenceFor({slot,component,run,type}){return (evidenceCatalogs.get(slot)?.results||[]).filter(x=>(!component||x.component===component)&&(!run||String(x.run)===String(run))&&(!type||x.type===type));}
