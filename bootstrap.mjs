import {initializeWorkspaceNavigation,navigate} from './workspace-navigation-ui.mjs';

const stageLabels={navigation:'Navigation shell','directory-import':'Directory management',rdf:'RDF workspace','chain-plotter':'Chain plotter','result-browser':'Result browser','trajectory-lj':'Trajectory / LJ'};
const states=new Map();
function statusHost(){return document.querySelector('#startupStatus')}
function renderStatus(){const host=statusHost();if(!host)return;host.replaceChildren(...[...states].map(([stage,value])=>{const item=document.createElement('li');item.dataset.stage=stage;item.dataset.status=value.status;item.innerHTML=`<strong>${stageLabels[stage]||stage}</strong><span>${value.status}${value.message?`: ${value.message}`:''}</span>`;return item}));host.dataset.degraded=String([...states.values()].some(x=>x.status==='failed'));}
function setStatus(stage,status,message=''){states.set(stage,{status,message});renderStatus()}
function forcedFailure(stage){return globalThis.__PORELENS_FAIL_STAGE__===stage||new URLSearchParams(location.search).get('fail-stage')===stage}
async function runStage(stage,loader){setStatus(stage,'loading');try{if(forcedFailure(stage))throw new Error(`Deliberate ${stage} initializer rejection`);const result=await loader();setStatus(stage,'ready');return result}catch(error){setStatus(stage,'failed',error?.message||String(error));console.error(`[PoreLens startup] ${stage} failed`,error);return null}}
export async function bootstrap(){
  const navigation=await runStage('navigation',()=>initializeWorkspaceNavigation());
  if(!navigation){document.querySelector('#adsorption-isotherms')?.removeAttribute('hidden')}
  const directory=await runStage('directory-import',async()=>(await import('./directory-import-ui.mjs')).initializeDirectoryImporter());
  const rdf=await runStage('rdf',async()=>(await import('./app.js')).initializeRdfWorkspace({navigate}));
  const chain=await runStage('chain-plotter',async()=>(await import('./chain-plotter-ui.mjs')).initializeChainPlotter());
  await runStage('result-browser',async()=>(await import('./result-browser-ui.mjs')).initializeResultBrowser());
  await runStage('trajectory-lj',async()=>{if(!rdf)throw new Error('RDF workspace unavailable; trajectory/LJ integration disabled');const {setupLjWorkflow}=await import('./lj-ui.mjs');const workflow=setupLjWorkflow({workspace:rdf.workspace,annotationStore:rdf.annotationStore});return {status:'ready',stage:'trajectory-lj',workflow}});
  const degraded=[...states.values()].some(x=>x.status==='failed');
  if(directory&&degraded){directory.degraded=true;document.querySelector('#scanState').textContent='Ready in degraded mode — directory scans do not imply analysis initialization succeeded.'}
  window.porelensStartup={states,navigation,directory,rdf,chain,degraded};
  window.dispatchEvent(new CustomEvent('porelens:startup-complete',{detail:window.porelensStartup}));
  return window.porelensStartup;
}
bootstrap();
