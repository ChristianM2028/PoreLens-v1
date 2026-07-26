export class DatasetWorkspace {
  constructor(){this.slots={A:null,B:null};this.selections={A:{},B:{}};}
  load(slot,dataset,displayName){if(!['A','B'].includes(slot))throw new Error('Unknown dataset slot');this.slots[slot]={...dataset,displayName};return this.slots[slot];}
  remove(slot){this.slots[slot]=null;this.selections[slot]={};}
  select(slot,component,pair,pressurePa){this.selections[slot][`${component}\0${pair}`]=pressurePa;}
  selected(slot,component,pair){return this.selections[slot][`${component}\0${pair}`]??null;}
}
