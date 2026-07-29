import {APPLICATION_VERSION,versionedModuleUrl} from './app-version.mjs';

export {APPLICATION_VERSION};
export const STAGE_IMPORT_URLS=Object.freeze({
  navigation:versionedModuleUrl('./workspace-navigation-ui.mjs'),
  directory:versionedModuleUrl('./directory-import-ui.mjs'),
  rdf:versionedModuleUrl('./app.js'),
  chain:versionedModuleUrl('./chain-plotter-ui.mjs'),
  results:versionedModuleUrl('./result-browser-ui.mjs'),
  trajectory:versionedModuleUrl('./trajectory.mjs'),
  lj:versionedModuleUrl('./lj-ui.mjs')
});

const stageLabels={navigation:'Navigation shell',deployment:'Application revision','directory-import':'Directory management',rdf:'RDF workspace','chain-plotter':'Chain plotter','result-browser':'Result browser','trajectory-lj':'Trajectory / LJ'};
const states=new Map();
const recovery='Close stale tabs, clear this origin’s site cache or perform a cache-bypassing reload, then restart the local server from the current repository checkout.';
function statusHost(){return document.querySelector('#startupStatus')}
function renderStatus(){const host=statusHost();if(!host)return;host.replaceChildren(...[...states].map(([stage,value])=>{const item=document.createElement('li');item.dataset.stage=stage;item.dataset.status=value.status;item.innerHTML=`<strong>${stageLabels[stage]||stage}</strong><span>${value.status}${value.message?`: ${value.message}`:''}</span>`;return item}));host.dataset.applicationVersion=APPLICATION_VERSION;host.dataset.degraded=String([...states.values()].some(x=>x.status==='failed'));}
function setStatus(stage,status,message=''){states.set(stage,{status,message});renderStatus()}
function forcedFailure(stage){return globalThis.__PORELENS_FAIL_STAGE__===stage||new URLSearchParams(location.search).get('fail-stage')===stage}
function mixedVersionError(moduleName,actual='missing'){return new Error(`Mixed application versions: ${moduleName} reports ${actual}, but bootstrap.mjs requires ${APPLICATION_VERSION}. Stale or mixed JavaScript assets were loaded. ${recovery}`)}
export function verifyStageModule(moduleName,module,initializer){if(typeof module?.[initializer]!=='function')throw new Error(`Mixed application versions: ${initializer} is missing from ${moduleName}. Stale or mixed JavaScript assets were loaded. ${recovery}`);if(module?.APPLICATION_VERSION!==APPLICATION_VERSION)throw mixedVersionError(moduleName,module?.APPLICATION_VERSION);return module[initializer]}
function legacyDiagnostic(error){const message=error?.message||String(error);if(/initializeDirectoryImporter|does not provide an export named ['"]?indexPdbSource|indexPdbSource.*(?:missing|export)/i.test(message))return new Error(`Mixed application versions: stale or mixed JavaScript assets were loaded (${message}). ${recovery}`);return error}
async function runStage(stage,loader){setStatus(stage,'loading');try{if(forcedFailure(stage))throw new Error(`Deliberate ${stage} initializer rejection`);const result=await loader();setStatus(stage,'ready');return result}catch(error){error=legacyDiagnostic(error);setStatus(stage,'failed',error?.message||String(error));console.error(`[PoreLens startup] ${stage} failed`,error);return null}}
function setSelectionEnabled(enabled){for(const id of ['chooseDirectoryA','chooseDirectoryB','filesA','filesB','reopenDataset']){const control=document.querySelector(`#${id}`);if(control)control.disabled=!enabled}}
function markCatalogOnly(){const scan=document.querySelector('#scanState');if(scan)scan.textContent='Catalog only—analysis modules unavailable. No analysis-ready events will be dispatched.';for(const id of ['statusA','statusB']){const status=document.querySelector(`#${id}`);if(status&&status.textContent&&!/not loaded/i.test(status.textContent))status.textContent+=' · catalog only—analysis modules unavailable.'}}

export async function bootstrap(){
  setSelectionEnabled(false);setStatus('deployment','ready',APPLICATION_VERSION);
  let navigate=()=>{};const navigation=await runStage('navigation',async()=>{const module=await import(STAGE_IMPORT_URLS.navigation);const result=verifyStageModule('workspace-navigation-ui.mjs',module,'initializeWorkspaceNavigation')();navigate=module.navigate;return result});
  if(!navigation)document.querySelector('#adsorption-isotherms')?.removeAttribute('hidden');
  // Register every catalog/dataset consumer before installing or enabling producers.
  const rdf=await runStage('rdf',async()=>{const module=await import(STAGE_IMPORT_URLS.rdf);return verifyStageModule('app.js',module,'initializeRdfWorkspace')({navigate})});
  const chain=await runStage('chain-plotter',async()=>{const module=await import(STAGE_IMPORT_URLS.chain);return verifyStageModule('chain-plotter-ui.mjs',module,'initializeChainPlotter')()});
  await runStage('result-browser',async()=>{const module=await import(STAGE_IMPORT_URLS.results);return verifyStageModule('result-browser-ui.mjs',module,'initializeResultBrowser')()});
  const trajectory=await runStage('trajectory-lj',async()=>{const trajectoryModule=await import(STAGE_IMPORT_URLS.trajectory);if(typeof trajectoryModule.indexPdbSource!=='function')throw new Error(`indexPdbSource is missing from trajectory.mjs. Stale or mixed JavaScript assets were loaded. ${recovery}`);if(!rdf)throw new Error('RDF workspace unavailable; trajectory/LJ integration disabled');const module=await import(STAGE_IMPORT_URLS.lj);const workflow=module.setupLjWorkflow({workspace:rdf.workspace,annotationStore:rdf.annotationStore});return {status:'ready',stage:'trajectory-lj',workflow}});
  const consumersReady=!!(rdf&&chain&&trajectory);
  const directory=consumersReady?await runStage('directory-import',async()=>{const module=await import(STAGE_IMPORT_URLS.directory);return verifyStageModule('directory-import-ui.mjs',module,'initializeDirectoryImporter')()}):null;
  if(!consumersReady){setStatus('directory-import','failed','Catalog only—analysis modules unavailable; directory selection remains disabled.');markCatalogOnly()}
  setSelectionEnabled(!!directory&&consumersReady);
  const degraded=[...states.values()].some(x=>x.status==='failed');
  window.porelensStartup={applicationVersion:APPLICATION_VERSION,states,navigation,directory,rdf,chain,degraded,consumersReady};
  window.dispatchEvent(new CustomEvent('porelens:startup-complete',{detail:window.porelensStartup}));return window.porelensStartup;
}
if(typeof document!=='undefined')bootstrap();
