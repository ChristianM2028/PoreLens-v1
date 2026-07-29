const WORKSPACE_IDS=['isotherm','rdf','end_to_end'];
const controller={active:'isotherm',states:Object.fromEntries(WORKSPACE_IDS.map(id=>[id,{selection:{},error:null,loading:false}])),activate(id){if(!WORKSPACE_IDS.includes(id))throw new Error(`Unknown analysis workspace ${id}`);this.active=id;return this.state(id)},state(id=this.active){return this.states[id]}};
const sections=()=>document.querySelectorAll('[data-analysis-workspace]');
const chainSelections=new Map();
let activationGeneration=0;
const hashMap={'#adsorption-isotherms':'isotherm','#rdf-workspace':'rdf','#end-to-end-histograms':'end_to_end'};
const legacyEvidenceHash='#trajectory-energetics';
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
  if(location.hash===legacyEvidenceHash){navigate('rdf',{scroll,replace:true});openRdfEvidence({scroll});return 'rdf'}
  const id=hashMap[location.hash];
  if(id&&controller.active!==id)activate(id,{scroll});
  return id||null;
}
function openRdfEvidence({scroll=true}={}){if(controller.active!=='rdf')navigate('rdf');const panel=document.querySelector('#trajectory-energetics');if(panel){panel.hidden=false;panel.setAttribute?.('aria-expanded','true');if(scroll)panel.scrollIntoView?.({behavior:'smooth',block:'start'})}window.dispatchEvent(new CustomEvent('porelens:rdf-evidence-opened',{detail:{state:controller.state('rdf')}}));return panel}
/** Update history and delegate all workspace visibility to the controller. */
function navigate(id,{scroll=false,replace=false}={}){
  const hash=Object.entries(hashMap).find(([,workspace])=>workspace===id)?.[0];
  if(!hash)throw new Error(`Unknown analysis workspace: ${id}`);
  if(location.hash!==hash)history[replace?'replaceState':'pushState'](null,'',hash);
  activate(id,{scroll});
}
document.querySelectorAll('[data-workspace]').forEach(link=>link.addEventListener('click',event=>{
  event.preventDefault();
  navigate(link.dataset.workspace,{scroll:true});
}));
document.querySelectorAll('[data-rdf-subview]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-rdf-subview]').forEach(x=>x.setAttribute('aria-selected',String(x===button)));const target=button.dataset.rdfSubview==='heatmaps'?'#heatmap':'#realRdfCanvas';document.querySelector(target)?.scrollIntoView({behavior:'smooth',block:'center'})}));
document.querySelector('#openLjAnalysis')?.addEventListener('click',()=>openRdfEvidence());
window.addEventListener('hashchange',()=>activateLocation({scroll:true}));
window.addEventListener('popstate',()=>activateLocation({scroll:true}));
if(location.hash===legacyEvidenceHash)activate('rdf');else activate(hashMap[location.hash]||'isotherm');

const featureTargets={rdf:'#rdf-workspace',trajectory:'#trajectory-energetics','result-browser':'#runProvenanceDrawer',catalog:'#datasets',isotherms:'#adsorption-isotherms'};
function reportFeatureUnavailable(feature,error){
  const host=document.querySelector(featureTargets[feature]);
  if(!host)return;
  let status=host.querySelector?.(`[data-feature-unavailable="${feature}"]`);
  if(!status){status=document.createElement('div');status.className='notice feature-unavailable';status.dataset.featureUnavailable=feature;status.setAttribute('role','status');host.prepend(status)}
  status.textContent=`${feature} feature unavailable. The application shell and other workspaces remain usable. ${error?.message||error}`;
  window.dispatchEvent(new CustomEvent('porelens:feature-unavailable',{detail:{feature,error:String(error?.message||error)}}));
}
function loadFeature(feature,source){return import(source).catch(error=>{reportFeatureUnavailable(feature,error);return null})}

// Visibility and aria-current are reconciled above before any feature graph is evaluated.
// Each optional entry point is imported independently so one parser or renderer cannot
// prevent the progressively enhanced shell from remaining usable.
if(document.documentElement){
  void loadFeature('rdf','./app.js?rev=porelens-20260729-indexed-pdb-v1');
  void loadFeature('isotherms','./chain-plotter-ui.mjs?rev=porelens-20260729-indexed-pdb-v1');
  void loadFeature('result-browser','./result-browser-ui.mjs?rev=porelens-20260729-indexed-pdb-v1');
  void loadFeature('catalog','./directory-import-ui.mjs?rev=porelens-20260729-indexed-pdb-v1');
}

export {controller,activate,activateLocation,attachChainRenderer,loadFeature,navigate,openRdfEvidence,reportFeatureUnavailable};
