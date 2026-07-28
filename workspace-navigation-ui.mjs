import {AnalysisWorkspaces} from './analysis-workspaces.mjs';
const controller=new AnalysisWorkspaces();
const sections=()=>document.querySelectorAll('[data-analysis-workspace]');
const chainSelections=new Map();
function selectionSnapshot(){const values={};document.querySelectorAll('#sharedChainPlotUi select, #sharedChainPlotUi input').forEach(el=>{if(el.id==='chainResult')return;values[el.id]=el.type==='checkbox'?el.checked:el.multiple?[...el.selectedOptions].map(x=>x.value):el.value});return values}
function restoreSelection(id){const values=chainSelections.get(id);if(!values)return;for(const [key,value] of Object.entries(values)){const el=document.getElementById(key);if(!el)continue;if(el.type==='checkbox')el.checked=value;else if(el.multiple)[...el.options].forEach(option=>option.selected=value.includes(option.value));else el.value=value}}
function attachChainRenderer(id){if(id!=='isotherm'&&id!=='end_to_end')return;const renderer=document.querySelector('#sharedChainPlotUi'),current=renderer?.parentElement?.closest('[data-analysis-workspace]')?.dataset.analysisWorkspace;if(current&&current!==id)chainSelections.set(current,selectionSnapshot());const host=document.querySelector(id==='isotherm'?'#isothermChainUiHost':'#histogramControlsHost');if(renderer&&host&&!host.contains(renderer))host.append(renderer);restoreSelection(id)}
function activate(id,{scroll=false}={}){
  controller.activate(id);
  sections().forEach(section=>section.hidden=section.dataset.analysisWorkspace!==id);
  attachChainRenderer(id);
  document.querySelectorAll('[data-workspace]').forEach(link=>link.setAttribute('aria-current',link.dataset.workspace===id?'page':'false'));
  // Existing proven renderers are entered explicitly; no result-type selector is exposed.
  const chainResult=document.querySelector('#chainResult'),outputType=document.querySelector('#outputType');
  if(chainResult&&(id==='isotherm'||id==='end_to_end')&&document.querySelector(`[data-analysis-workspace="${id}"]`)?.contains(chainResult)){chainResult.value=id;chainResult.dispatchEvent(new Event('change'))}
  if(outputType&&(id==='movie'||id==='vtk')){outputType.value=id;outputType.dispatchEvent(new Event('change'))}
  if(scroll)document.querySelector(`[data-analysis-workspace="${id}"]`)?.scrollIntoView({behavior:'smooth',block:'start'});
  window.dispatchEvent(new CustomEvent('porelens:workspace-changed',{detail:{id,state:controller.state(id)}}));
}
document.querySelectorAll('[data-workspace]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();activate(link.dataset.workspace,{scroll:true});history.replaceState(null,'',link.getAttribute('href'))}));
document.querySelectorAll('[data-rdf-subview]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-rdf-subview]').forEach(x=>x.setAttribute('aria-selected',String(x===button)));const target=button.dataset.rdfSubview==='heatmaps'?'#heatmap':'#realRdfCanvas';document.querySelector(target)?.scrollIntoView({behavior:'smooth',block:'center'});}));
const hashMap={'#adsorption-isotherms':'isotherm','#rdf-workspace':'rdf','#end-to-end-histograms':'end_to_end','#movies-lj':'movie','#spatial-density':'vtk'};
activate(hashMap[location.hash]||'isotherm');
export {controller,activate};
for(const eventName of ['porelens:dataset-loaded','porelens:catalog-updated','porelens:dataset-removed'])window.addEventListener(eventName,()=>queueMicrotask(()=>activate(controller.active)));
