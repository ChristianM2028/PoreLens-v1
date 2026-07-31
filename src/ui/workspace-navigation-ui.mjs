import {AnalysisWorkspaces} from './analysis-workspaces.mjs?rev=porelens-20260731-phase-loaders-v1';
const WORKSPACE_IDS=['isotherm','rdf','end_to_end','comparison','gemc','henry'];
const controller=new AnalysisWorkspaces();
const sections=()=>document.querySelectorAll('[data-analysis-workspace]');
const chainSelections=new Map();
let activationGeneration=0;
const navigationPaths={
  isotherm:{hash:'#adsorption-isotherms',workspace:'isotherm',rdfEvidence:false},
  rdf:{hash:'#rdf-workspace',workspace:'rdf',rdfEvidence:false},
  end_to_end:{hash:'#end-to-end-histograms',workspace:'end_to_end',rdfEvidence:false},
  comparison:{hash:'#comparison',workspace:'comparison',rdfEvidence:false},
  gemc:{hash:'#gemc-workspace',workspace:'gemc',rdfEvidence:false},
  henry:{hash:'#henry-workspace',workspace:'henry',rdfEvidence:false},
  rdfEvidence:{hash:'#trajectory-energetics',workspace:'rdf',rdfEvidence:true}
};
const pathByHash=Object.fromEntries(Object.entries(navigationPaths).map(([name,path])=>[path.hash,{name,...path}]));
let activeLocationHash=null;
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
function activate(id,{scroll=false,rdfEvidence=false}={}){
  const generation=++activationGeneration;
  controller.activate(id);
  sections().forEach(section=>section.hidden=section.dataset.analysisWorkspace!==id);
  const evidencePanel=document.querySelector('#trajectory-energetics');
  if(evidencePanel){evidencePanel.hidden=!rdfEvidence;evidencePanel.setAttribute?.('aria-expanded',String(rdfEvidence))}
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
function applyNavigationPath(path,{scroll=false}={}){
  activate(path.workspace,{scroll:scroll&&!path.rdfEvidence,rdfEvidence:path.rdfEvidence});
  if(path.rdfEvidence){
    const panel=document.querySelector('#trajectory-energetics');
    if(scroll)panel?.scrollIntoView?.({behavior:'smooth',block:'start'});
    window.dispatchEvent(new CustomEvent('porelens:rdf-evidence-opened',{detail:{state:controller.state('rdf')}}));
  }
  return path.workspace;
}
function activateLocation({scroll=false}={}){
  const path=pathByHash[location.hash];
  if(!path||activeLocationHash===location.hash)return path?.workspace||null;
  activeLocationHash=location.hash;
  return applyNavigationPath(path,{scroll});
}
function openRdfEvidence({scroll=true,replace=false}={}){navigate('rdfEvidence',{scroll,replace});return document.querySelector('#trajectory-energetics')}
/** Update history and delegate all workspace visibility to the controller. */
function navigate(pathName,{scroll=false,replace=false}={}){
  const path=navigationPaths[pathName];
  if(!path)throw new Error(`Unknown analysis navigation path: ${pathName}`);
  if(location.hash!==path.hash)history[replace?'replaceState':'pushState'](null,'',path.hash);
  activeLocationHash=path.hash;
  return applyNavigationPath(path,{scroll});
}
document.querySelectorAll('[data-workspace]').forEach(link=>link.addEventListener('click',event=>{
  event.preventDefault();
  navigate(link.dataset.workspace,{scroll:true});
}));
document.querySelectorAll('[data-rdf-subview]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-rdf-subview]').forEach(x=>x.setAttribute('aria-selected',String(x===button)));const target=button.dataset.rdfSubview==='heatmaps'?'#heatmap':'#realRdfCanvas';document.querySelector(target)?.scrollIntoView({behavior:'smooth',block:'center'})}));
const comparisonTabs=()=>[...document.querySelectorAll('[data-comparison-view]')];
function activateComparisonTab(view,{focus=false}={}){
  controller.activateComparisonView(view);
  comparisonTabs().forEach(tab=>{const selected=tab.dataset.comparisonView===controller.comparison.activeView;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;if(selected&&focus)tab.focus()});
  document.querySelectorAll('[data-comparison-panel]').forEach(panel=>panel.hidden=panel.dataset.comparisonPanel!==controller.comparison.activeView);
  window.dispatchEvent(new CustomEvent('porelens:comparison-view-changed',{detail:{view:controller.comparison.activeView,state:controller.comparison}}));
}
comparisonTabs().forEach(tab=>{
  tab.addEventListener('click',()=>activateComparisonTab(tab.dataset.comparisonView));
  tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=comparisonTabs(),index=tabs.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;activateComparisonTab(tabs[next].dataset.comparisonView,{focus:true})});
});
activateComparisonTab(controller.comparison.activeView);
document.querySelector('#openLjAnalysis')?.addEventListener('click',()=>openRdfEvidence());
window.addEventListener('popstate',()=>activateLocation({scroll:true}));
window.addEventListener('hashchange',()=>activateLocation({scroll:true}));
if(!activateLocation())navigate('isotherm',{replace:true});

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
  void loadFeature('rdf','./app.js?rev=porelens-20260731-phase-loaders-v1');
  void loadFeature('isotherms','./chain-plotter-ui.mjs?rev=porelens-20260731-phase-loaders-v1');
  void loadFeature('result-browser','./result-browser-ui.mjs?rev=porelens-20260731-phase-loaders-v1');
  void loadFeature('catalog','./directory-import-ui.mjs?rev=porelens-20260731-phase-loaders-v1');
  void loadFeature('phase-workspaces','./phase-workspaces.mjs?rev=porelens-20260731-phase-loaders-v1');
}

export {controller,activate,activateComparisonTab,activateLocation,attachChainRenderer,loadFeature,navigate,openRdfEvidence,reportFeatureUnavailable};
