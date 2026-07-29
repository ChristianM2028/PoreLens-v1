import test from 'node:test';
import assert from 'node:assert/strict';

async function navigationHarness(initialHash='#adsorption-isotherms'){
  const listeners=new Map(),windowListeners=new Map();
  const links=['isotherm','rdf','end_to_end'].map(workspace=>({
    dataset:{workspace},
    href:{isotherm:'#adsorption-isotherms',rdf:'#rdf-workspace',end_to_end:'#end-to-end-histograms'}[workspace],
    attributes:new Map(),
    addEventListener(type,handler){listeners.set(`${workspace}:${type}`,handler)},
    getAttribute(name){return name==='href'?this.href:null},
    setAttribute(name,value){this.attributes.set(name,value)},
    removeAttribute(name){this.attributes.delete(name)}
  }));
  const sections=links.map(link=>({dataset:{analysisWorkspace:link.dataset.workspace},hidden:false}));
  const evidencePanel={hidden:true,attributes:new Map([['aria-expanded','false']]),setAttribute(name,value){this.attributes.set(name,value)},getAttribute(name){return this.attributes.get(name)},scrollIntoView(){}};
  const openButton={addEventListener(type,handler){listeners.set(`open:${type}`,handler)}};
  const location={hash:initialHash};
  const history={entries:[],pushState(_state,_title,href){this.entries.push(href);location.hash=href},replaceState(_state,_title,href){this.entries.push(href);location.hash=href}};
  const document={
    querySelectorAll(selector){
      if(selector==='[data-analysis-workspace]')return sections;
      if(selector==='[data-workspace]')return links;
      if(selector==='[data-rdf-subview]'||selector==='#sharedChainPlotUi select, #sharedChainPlotUi input')return [];
      return [];
    },
    querySelector(selector){
      if(selector==='#trajectory-energetics')return evidencePanel;
      if(selector==='#openLjAnalysis')return openButton;
      const match=selector.match(/^\[data-analysis-workspace="(.+)"\]$/);
      return match?{scrollIntoView(){},dataset:{analysisWorkspace:match[1]}}:null;
    }
  };
  const window={
    addEventListener(type,handler){windowListeners.set(type,handler)},
    dispatchEvent(){}
  };
  Object.assign(globalThis,{document,window,location,history,requestAnimationFrame:callback=>callback(),CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail}}});
  const navigation=await import(`../src/ui/workspace-navigation-ui.mjs?test=${Date.now()}-${Math.random()}`);
  return {listeners,windowListeners,links,sections,evidencePanel,location,history,navigation};
}
function cleanupNavigationHarness(){for(const key of ['document','window','location','history','requestAnimationFrame','CustomEvent'])delete globalThis[key]}

test('initial trajectory evidence deep link activates RDF and expands its panel',async()=>{
  try{
    const {navigation,sections,evidencePanel,history}=await navigationHarness('#trajectory-energetics');
    assert.equal(navigation.controller.active,'rdf');
    assert.equal(sections.find(x=>x.dataset.analysisWorkspace==='rdf').hidden,false);
    assert.equal(evidencePanel.hidden,false);
    assert.equal(evidencePanel.getAttribute('aria-expanded'),'true');
    assert.deepEqual(history.entries,[]);
  }finally{cleanupNavigationHarness()}
});

test('button navigation is reproducible through Back/Forward and leaving RDF hides evidence',async()=>{
  try{
    const {listeners,windowListeners,links,sections,evidencePanel,location,history,navigation}=await navigationHarness();
    let prevented=false;
    listeners.get('rdf:click')({preventDefault(){prevented=true}});
    assert.equal(prevented,true);
    assert.deepEqual(history.entries,['#rdf-workspace']);
    assert.equal(navigation.controller.active,'rdf');
    assert.equal(sections.find(x=>x.dataset.analysisWorkspace==='rdf').hidden,false);
    assert.equal(sections.find(x=>x.dataset.analysisWorkspace==='isotherm').hidden,true);
    assert.equal(links.find(x=>x.dataset.workspace==='rdf').attributes.get('aria-current'),'page');
    assert.equal(links.find(x=>x.dataset.workspace==='isotherm').attributes.has('aria-current'),false);

    listeners.get('open:click')();
    assert.equal(location.hash,'#trajectory-energetics');
    assert.equal(evidencePanel.hidden,false);
    assert.equal(evidencePanel.getAttribute('aria-expanded'),'true');

    location.hash='#rdf-workspace';
    windowListeners.get('popstate')();
    assert.equal(navigation.controller.active,'rdf');
    assert.equal(evidencePanel.hidden,true);

    location.hash='#trajectory-energetics';
    windowListeners.get('popstate')();
    assert.equal(navigation.controller.active,'rdf');
    assert.equal(evidencePanel.hidden,false);

    location.hash='#adsorption-isotherms';
    windowListeners.get('popstate')();
    assert.equal(navigation.controller.active,'isotherm');
    assert.equal(sections.find(x=>x.dataset.analysisWorkspace==='isotherm').hidden,false);
    assert.equal(evidencePanel.hidden,true);
    assert.equal(evidencePanel.getAttribute('aria-expanded'),'false');
  }finally{cleanupNavigationHarness()}
});

test('application has no stale #analysis visibility mechanism and documents file launch recovery',async()=>{
  const [{readFile}]=await Promise.all([import('node:fs/promises')]);
  const [app,html]=await Promise.all([readFile('src/ui/app.js','utf8'),readFile('index.html','utf8')]);
  assert.doesNotMatch(app,/querySelector\(['"`]#analysis|\$\(['"`]#analysis/);
  assert.match(html,/location\.protocol\s*===\s*['"]file:['"]/);
  assert.match(html,/npm start/);
  assert.match(html,/http:\/\/127\.0\.0\.1:4173/);
});

test('HTML exposes Isotherms before enhancement and delegates optional features to the navigation bootstrap',async()=>{
  const {readFile}=await import('node:fs/promises');
  const [html,navigation,app]=await Promise.all([
    readFile('index.html','utf8'),
    readFile('src/ui/workspace-navigation-ui.mjs','utf8'),
    readFile('src/ui/app.js','utf8')
  ]);
  assert.match(html,/data-workspace="isotherm" aria-current="page"/);
  assert.match(html,/id="adsorption-isotherms" data-analysis-workspace="isotherm" aria-labelledby=/);
  assert.doesNotMatch(html,/id="adsorption-isotherms"[^>]*\shidden(?:\s|>)/);
  for(const id of ['rdf-workspace','end-to-end-histograms','trajectory-energetics'])assert.match(html,new RegExp(`id="${id}"[^>]*\\shidden(?:\\s|>)`));
  assert.match(html,/import\('\.\/src\/ui\/workspace-navigation-ui\.mjs\?rev=porelens-20260729-simulation-shape-v2'\)/);
  for(const legacy of ['src="app.js"','src="chain-plotter-ui.mjs"','src="result-browser-ui.mjs"','src="directory-import-ui.mjs"'])assert.doesNotMatch(html,new RegExp(legacy));
  assert.doesNotMatch(navigation,/^import\s/m);
  assert.ok(navigation.indexOf('if(!activateLocation())')<navigation.indexOf("loadFeature('rdf','./app.js?rev=porelens-20260729-simulation-shape-v2')"));
  assert.match(navigation,/rdfEvidence:\{hash:'#trajectory-energetics',workspace:'rdf',rdfEvidence:true\}/);
  assert.match(navigation,/reportFeatureUnavailable/);
  assert.doesNotMatch(app,/^import \{ setupLjWorkflow \}/m);
  assert.match(app,/import\('\.\/lj-ui\.mjs\?rev=porelens-20260729-simulation-shape-v2'\)/);
  assert.match(html,/<script nomodule>/);
});
