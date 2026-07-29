export const OUTPUT_TYPES=['raspa_output','rdf','end_to_end','vtk','movie'];
export function outputViewState(type){
  if(!OUTPUT_TYPES.includes(type))throw new Error(`Unknown output type ${type}`);
  return {summary:type==='raspa_output',raw:type==='raspa_output',curve:type==='rdf'||type==='end_to_end',vtk:type==='vtk',movie:type==='movie'};
}
