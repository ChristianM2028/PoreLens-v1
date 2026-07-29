import {AnalysisWorkspaces} from './analysis-workspaces.mjs';
const controller=new AnalysisWorkspaces();
const sections=()=>document.querySelectorAll('[data-analysis-workspace]');
const chainSelections=new Map();
let activationGeneration=0;
const hashMap={'#adsorption-isotherms':'isotherm','#rdf-workspace':'rdf','#end-to-end-histograms':'end_to_end','#trajectory-energetics':'trajectory_energetics'};
function selectionSnapshot(){const values={};document.querySelectorAll('#sharedChainPlotUi select, #sharedChainPlotUi input').forEach(el=>{if(el.id==='chainResult')return;values[el.id]=el.type==='checkbox'?el.checked:el.multiple?[...el.selectedOptions].map(x=>x.value):el.value});return values}
/** The only function permitted to move the shared renderer. */
function attachChainRenderer(id){
  if(id!=='isotherm'&&id!=='end_to_end')return null;
  const renderer=document.querySelector('#sharedChainPlotUi');
  const current=renderer?.parentElement?.closest('[data-analysis-workspace]')?.dataset.analysisWorkspace;
  if(current&&current!==id)chainSelections.set(current,selectionSnapshot());
  const host=document.querySelector(id==='isotherm'?'#isothermChainUiHost':'#histogramControlsHost');
  if(!renderer||!host)return null;
  if(!host.contains(renderer))host.append(renderer);
  if(!host.contains(renderer))throw new Error(`Unable to attach chain renderer to ${id}`);
  return {renderer,host,savedSelection:chainSelections.get(id)||null};
}
function activate(id,{scroll=false}={}){
  const generation=++activationGeneration;
  controller.activate(id);
  sections().forEach(section=>section.hidden=section.dataset.analysisWorkspace!==id);
  const attachment=attachChainRenderer(id);
  document.querySelectorAll('[data-workspace]').forEach(link=>{
    if(link.dataset.workspace===id)link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  const outputType=document.querySelector('#outputType');
  if(scroll)document.querySelector(`[data-analysis-workspace="${id}"]`)?.scrollIntoView({behavior:'smooth',block:'start'});
  window.dispatchEvent(new CustomEvent('porelens:workspace-changed',{detail:{id,state:controller.state(id),generation}}));
  if(attachment)requestAnimationFrame(()=>{
    if(generation!==activationGeneration||controller.active!==id||!attachment.host.contains(attachment.renderer))return;
    window.dispatchEvent(new CustomEvent('porelens:chain-renderer-attached',{detail:{id,generation,savedSelection:attachment.savedSelection}}));
  });
}
function activateLocation({scroll=false}={}){
  const id=hashMap[location.hash];
  if(id&&controller.active!==id)activate(id,{scroll});
  return id||null;
}
document.querySelectorAll('[data-workspace]').forEach(link=>link.addEventListener('click',event=>{
  event.preventDefault();
  const href=link.getAttribute('href');
  if(location.hash!==href)history.pushState(null,'',href);
  activate(link.dataset.workspace,{scroll:true});
}));
document.querySelectorAll('[data-rdf-subview]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-rdf-subview]').forEach(x=>x.setAttribute('aria-selected',String(x===button)));const target=button.dataset.rdfSubview==='heatmaps'?'#heatmap':'#realRdfCanvas';document.querySelector(target)?.scrollIntoView({behavior:'smooth',block:'center'})}));
window.addEventListener('hashchange',()=>activateLocation({scroll:true}));
window.addEventListener('popstate',()=>activateLocation({scroll:true}));
activate(hashMap[location.hash]||'isotherm');
export {controller,activate,activateLocation,attachChainRenderer};
