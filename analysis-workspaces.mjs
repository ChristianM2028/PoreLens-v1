/** Independent UI state containers for each scientific workspace. */
export const WORKSPACE_IDS=['isotherm','rdf','end_to_end','movie','vtk'];
export class AnalysisWorkspaces {
  constructor(){this.active='isotherm';this.states=Object.fromEntries(WORKSPACE_IDS.map(id=>[id,{selection:{},error:null,loading:false}]));}
  activate(id){if(!WORKSPACE_IDS.includes(id))throw new Error(`Unknown analysis workspace ${id}`);this.active=id;return this.state(id)}
  state(id=this.active){if(!WORKSPACE_IDS.includes(id))throw new Error(`Unknown analysis workspace ${id}`);return this.states[id]}
  patch(id,patch){Object.assign(this.state(id),patch);return this.state(id)}
  select(id,selection){this.state(id).selection={...this.state(id).selection,...selection};return this.state(id).selection}
  fail(id,error){this.patch(id,{error:String(error?.message||error),loading:false})}
  begin(id){this.patch(id,{error:null,loading:true})}
  complete(id){this.patch(id,{error:null,loading:false})}
}
export function capabilityState(results=[]){const types=new Set(results.map(x=>x.type));return {isotherm:types.has('raspa_output'),rdf:types.has('rdf'),end_to_end:types.has('end_to_end'),movie:types.has('movie'),vtk:types.has('vtk')};}
