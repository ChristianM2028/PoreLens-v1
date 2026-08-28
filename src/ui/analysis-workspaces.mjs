/** Independent UI state containers for each scientific workspace. */
import {createComparisonState,COMPARISON_VIEWS,synchronizeDistanceInterval} from '../core/comparison-state.mjs?rev=normalized-chain-key-v1';
export const WORKSPACE_IDS=['isotherm','rdf','end_to_end','comparison','gemc','henry'];
export class AnalysisWorkspaces {
  constructor(){this.active='isotherm';this.states=Object.fromEntries(WORKSPACE_IDS.map(id=>[id,{selection:{},error:null,loading:false}]));this.comparison=createComparisonState();}
  activate(id){if(!WORKSPACE_IDS.includes(id))throw new Error(`Unknown analysis workspace ${id}`);this.active=id;return this.state(id)}
  state(id=this.active){if(!WORKSPACE_IDS.includes(id))throw new Error(`Unknown analysis workspace ${id}`);return this.states[id]}
  patch(id,patch){Object.assign(this.state(id),patch);return this.state(id)}
  select(id,selection){this.state(id).selection={...this.state(id).selection,...selection};return this.state(id).selection}
  fail(id,error){this.patch(id,{error:String(error?.message||error),loading:false})}
  begin(id){this.patch(id,{error:null,loading:true})}
  complete(id){this.patch(id,{error:null,loading:false})}
  selectComparisonSide(side,selection){if(!['A','B'].includes(side))throw new Error(`Unknown comparison side ${side}`);const next={...this.comparison[side],...selection};if(Object.hasOwn(selection,'run'))next.run=selection.run==null?null:String(selection.run);this.comparison[side]=next;return next}
  activateComparisonView(view){if(!COMPARISON_VIEWS.includes(view))throw new Error(`Unknown comparison view ${view}`);this.comparison.activeView=view;return this.comparison}
  synchronizeComparisonInterval(interval,source){return synchronizeDistanceInterval(this.comparison,interval,{source})}
}
export function capabilityState(results=[]){const types=new Set(results.map(x=>x.type));return {isotherm:types.has('isotherm_summary'),rdf:types.has('rdf')||types.has('movie')||types.has('vtk'),end_to_end:types.has('end_to_end')};}
