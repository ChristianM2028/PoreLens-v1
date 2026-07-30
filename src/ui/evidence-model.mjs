import {buildChainCatalog,buildHandleCatalog,ParsedResultCache} from '../core/chain-series.mjs?rev=porelens-20260729-simulation-shape-v2';

export const evidenceCatalogs=new Map();
export const evidenceCatalogStates=new Map();
export const parsedResultCache=new ParsedResultCache();
const pending=new Map();

/** Register metadata without eagerly reading scientific result files. */
export async function registerEvidence(detail={}){
  const slot=detail.slot;if(!slot)return null;
  if(pending.has(slot))return pending.get(slot);
  const task=(async()=>{
    let catalog;
    if(detail.source==='files'||detail.files){if(!detail.files)return null;catalog=await buildChainCatalog(detail.files,{datasetId:slot});}
    else if(detail.source==='directory_handle'||detail.catalog){if(!detail.catalog)return null;catalog=buildHandleCatalog(detail.catalog,{datasetId:slot});}
    else return null;
    evidenceCatalogs.set(slot,catalog);
    evidenceCatalogStates.set(slot,{scanning:detail.scanning===true||detail.state==='scanning',source:detail.source});
    window.dispatchEvent(new CustomEvent('porelens:evidence-catalog-changed',{detail:{slot,catalog}}));
    return catalog;
  })().finally(()=>pending.delete(slot));pending.set(slot,task);return task;
}
export function removeEvidence(slot){evidenceCatalogs.delete(slot);evidenceCatalogStates.delete(slot);}
export function evidenceFor({slot,component,run,type}){return (evidenceCatalogs.get(slot)?.results||[]).filter(x=>(!component||x.component===component)&&(!run||String(x.run)===String(run))&&(!type||x.type===type));}
