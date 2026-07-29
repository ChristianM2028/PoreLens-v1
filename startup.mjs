import {initializeWorkspaceNavigation} from './workspace-navigation-ui.mjs';
import {initializeRdfWorkspace} from './app.js';
import {initializeChainPlotter} from './chain-plotter-ui.mjs';
import {initializeResultBrowser} from './result-browser-ui.mjs';
import {initializeDirectoryImporter} from './directory-import-ui.mjs';

export const STARTUP_CONTROL_SELECTOR='input[type="file"], #chooseDirectoryA, #chooseDirectoryB, #reopenDataset';
export const startupState={status:'loading',stage:'document',error:null};

function setImportControls(documentRef,disabled){
  documentRef.querySelectorAll(STARTUP_CONTROL_SELECTOR).forEach(control=>{control.disabled=disabled});
}
function documentReady(documentRef){
  if(documentRef.readyState!=='loading')return Promise.resolve();
  return new Promise(resolve=>documentRef.addEventListener('DOMContentLoaded',resolve,{once:true}));
}
function successful(result){return result===true||result?.ok===true}

export async function runStartup({
  documentRef=document,
  stages=[
    ['rdf-workspace',initializeRdfWorkspace],
    ['chain-plotter',initializeChainPlotter],
    ['result-browser',initializeResultBrowser],
    ['workspace-navigation',initializeWorkspaceNavigation],
    ['directory-importer',initializeDirectoryImporter]
  ],
  state=startupState
}={}){
  state.status='loading';state.stage='document';state.error=null;
  setImportControls(documentRef,true);
  try{
    await documentReady(documentRef);
    setImportControls(documentRef,true);
    for(const [stage,initialize] of stages){
      state.stage=stage;
      const result=await initialize();
      if(!successful(result))throw new Error(`Initializer did not report explicit success: ${stage}`);
    }
    state.status='ready';state.stage='ready';
    setImportControls(documentRef,false);
    return state;
  }catch(error){
    state.status='failed';state.error=error;
    setImportControls(documentRef,true);
    console.error(`PoreLens startup failed during ${state.stage}.`,error);
    throw error;
  }
}

export const startup=typeof document==='undefined'?null:runStartup();
startup?.catch(()=>{});
