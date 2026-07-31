/** @typedef {'isotherm'|'clausius'|'vle'|'henry'} LiteratureTarget */
/** @typedef {{x:number,y:number,sourceRow:number,rawX:string,rawY:string,rawLine:string}} LiteraturePoint */
/** @typedef {{code:string,severity:'error'|'warning',sourceRow:number,message:string,rawLine:string}} LiteratureDiagnostic */
/**
 * @typedef {Object} LiteratureSeries
 * @property {string} id Stable browser-session identity.
 * @property {LiteratureTarget} target
 * @property {string} view Plot sub-view (for example `vapor`, `liquid`, `coefficient`, or `energy`).
 * @property {string} label
 * @property {string} simulationSeriesId
 * @property {string} resolvedColor
 * @property {string} sourceFilename
 * @property {string} originalText
 * @property {LiteraturePoint[]} points
 * @property {LiteratureDiagnostic[]} diagnostics
 * @property {{xLabel:string,yLabel:string,xUnit:string,yUnit:string,statement:string}} assumedAxes
 * @property {string} axisSignature
 * @property {boolean} visible
 */

export const LITERATURE_COMMENT_SYNTAX='A trimmed line beginning with #, ;, or // is a comment.';

/** Strictly parse displayed x/y coordinates without sorting or conversion. */
export function parseLiteratureText(text){
 const points=[],diagnostics=[];
 String(text??'').split(/\r?\n/).forEach((rawLine,index)=>{
  const sourceRow=index+1,trimmed=rawLine.trim();
  if(!trimmed||/^(?:#|;|\/\/)/.test(trimmed))return;
  const columns=trimmed.includes(',')?trimmed.split(',').map(x=>x.trim()):trimmed.split(/\s+/);
  if(columns.length!==2){const missing=columns.length<2||columns.some(x=>x==='');diagnostics.push({code:missing?'missing_value':'extra_columns',severity:'error',sourceRow,message:missing?'Expected both x and y values.':`Expected exactly two columns; found ${columns.length}.`,rawLine});return}
  if(columns.some(x=>x==='')){diagnostics.push({code:'missing_value',severity:'error',sourceRow,message:'Expected both x and y values.',rawLine});return}
  const values=columns.map(Number);
  const nonnumeric=columns.findIndex((value,i)=>Number.isNaN(values[i])&&!/^[+-]?(?:inf(?:inity)?|nan)$/i.test(value));
  if(nonnumeric>=0){diagnostics.push({code:'nonnumeric_value',severity:'error',sourceRow,message:`Column ${nonnumeric+1} is not numeric: ${columns[nonnumeric]}.`,rawLine});return}
  const nonfinite=values.findIndex(value=>!Number.isFinite(value));
  if(nonfinite>=0){diagnostics.push({code:'nonfinite_value',severity:'error',sourceRow,message:`Column ${nonfinite+1} must be finite: ${columns[nonfinite]}.`,rawLine});return}
  points.push({x:values[0],y:values[1],sourceRow,rawX:columns[0],rawY:columns[1],rawLine});
 });
 if(!points.length)diagnostics.push({code:'no_valid_points',severity:'error',sourceRow:0,message:'At least one valid two-column point is required.',rawLine:''});
 return {points,diagnostics,valid:points.length>0&&diagnostics.length===0,originalText:String(text??''),commentSyntax:LITERATURE_COMMENT_SYNTAX};
}

export function axisSignature(axes){return [axes.xLabel,axes.xUnit,axes.yLabel,axes.yUnit].map(x=>String(x??'')).join('\u001f')}
export function createLiteratureSeries({id,target,view='',label,simulationSeriesId,resolvedColor,sourceFilename,text,axes,visible=true}){
 if(!['isotherm','clausius','vle','henry'].includes(target))throw new TypeError(`Unsupported literature target: ${target}`);
 const parsed=parseLiteratureText(text),assumedAxes={...axes,statement:'Units were assumed from the active displayed axes at import; no conversion was performed.'};
 return {id:id||`literature-${Date.now()}-${Math.random().toString(36).slice(2)}`,target,view,label:String(label||sourceFilename||'Literature'),simulationSeriesId:String(simulationSeriesId||''),resolvedColor:String(resolvedColor||''),sourceFilename:String(sourceFilename||''),originalText:parsed.originalText,points:parsed.points,diagnostics:parsed.diagnostics,assumedAxes,axisSignature:axisSignature(axes),visible:Boolean(visible),importProvenance:{browserLocal:true,importedAt:new Date().toISOString(),commentSyntax:parsed.commentSyntax,destructiveTransform:false}};
}
export function literatureValidity(series,axes,{logX=false}={}){const stale=series.axisSignature!==axisSignature(axes),excluded=series.points.filter(p=>logX&&p.x<=0).map(p=>({sourceRow:p.sourceRow,reason:'Nonpositive x is excluded from the displayed logarithmic axis; retained in raw exports.'}));return {enabled:!stale,reason:stale?'Active axis quantity or display unit changed; reimport or explicitly revalidate this overlay.':'',included:stale?[]:series.points.filter(p=>!logX||p.x>0),excluded}}
export function literatureExportRows(series,axes,options={}){const validity=literatureValidity(series,axes,options),excluded=new Map(validity.excluded.map(x=>[x.sourceRow,x.reason]));return series.points.map(p=>({datasetKind:'literature',userLabel:series.label,targetView:series.target,seriesRole:series.view,x:p.x,y:p.y,sourceRow:p.sourceRow,rawX:p.rawX,rawY:p.rawY,assumedXLabel:series.assumedAxes.xLabel,assumedXUnit:series.assumedAxes.xUnit,assumedYLabel:series.assumedAxes.yLabel,assumedYUnit:series.assumedAxes.yUnit,simulationSeriesId:series.simulationSeriesId,resolvedColor:series.resolvedColor,sourceFilename:series.sourceFilename,parseDiagnostics:series.diagnostics,excludedRowReason:excluded.get(p.sourceRow)||'',importProvenance:series.importProvenance}));}
