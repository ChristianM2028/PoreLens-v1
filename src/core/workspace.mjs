export class DatasetWorkspace {
  constructor(){this.slots={A:null,B:null};this.selections={A:{},B:{}};}
  load(slot,dataset,displayName){if(!['A','B'].includes(slot))throw new Error('Unknown dataset slot');const datasetLabel=String(displayName||dataset?.name||slot).trim()||slot;this.slots[slot]={...dataset,datasetId:slot,datasetLabel,displayName:datasetLabel};return this.slots[slot];}
  label(slot,value){if(!this.slots[slot])return null;const datasetLabel=String(value??'').trim()||this.slots[slot].displayName||slot;this.slots[slot].datasetLabel=datasetLabel;this.slots[slot].displayName=datasetLabel;return datasetLabel;}
  remove(slot){this.slots[slot]=null;this.selections[slot]={};}
  select(slot,component,pair,pressurePa){this.selections[slot][`${component}\0${pair}`]=pressurePa;}
  selected(slot,component,pair){return this.selections[slot][`${component}\0${pair}`]??null;}
}
