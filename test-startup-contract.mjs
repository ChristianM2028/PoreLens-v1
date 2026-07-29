import test from 'node:test';
import assert from 'node:assert/strict';
import {APPLICATION_VERSION,STAGE_IMPORT_URLS} from './bootstrap.mjs';
import {indexPdbSource} from './trajectory.mjs';

const stages=[['workspace-navigation-ui.mjs','initializeWorkspaceNavigation'],['directory-import-ui.mjs','initializeDirectoryImporter'],['app.js','initializeRdfWorkspace'],['chain-plotter-ui.mjs','initializeChainPlotter'],['result-browser-ui.mjs','initializeResultBrowser']];
test('all bootstrap stages expose one revision and explicit initializers without import side effects',async()=>{let registrations=0;const oldWindow=globalThis.window,oldDocument=globalThis.document;globalThis.window={addEventListener(){registrations++}};globalThis.document={querySelector(){registrations++;return null},querySelectorAll(){registrations++;return []}};try{for(const [path,initializer] of stages){const module=await import(`./${path}?contract=${Date.now()}-${path}`);assert.equal(module.APPLICATION_VERSION,APPLICATION_VERSION,path);assert.equal(typeof module[initializer],'function',initializer)}assert.equal(registrations,0,'stage imports must not inspect the DOM or register listeners')}finally{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument}});
test('trajectory contract and RASPA package link cleanly',async()=>{assert.equal(typeof indexPdbSource,'function');const packageModule=await import('./raspa-package.mjs');assert.equal(typeof packageModule.importRunPackage,'function')});
test('dynamic startup URLs carry the shared revision',()=>{for(const url of Object.values(STAGE_IMPORT_URLS))assert.equal(new URL(url,'http://local/').searchParams.get('v'),APPLICATION_VERSION)});
