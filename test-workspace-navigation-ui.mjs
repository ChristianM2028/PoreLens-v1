import test from 'node:test';
import assert from 'node:assert/strict';

test('workspace tabs create navigable history and follow back/forward hash changes',async()=>{
  const listeners=new Map(),windowListeners=new Map();
  const links=['isotherm','rdf','end_to_end','trajectory_energetics'].map(workspace=>({
    dataset:{workspace},
    href:{isotherm:'#adsorption-isotherms',rdf:'#rdf-workspace',end_to_end:'#end-to-end-histograms',trajectory_energetics:'#trajectory-energetics'}[workspace],
    attributes:new Map(),
    addEventListener(type,handler){listeners.set(`${workspace}:${type}`,handler)},
    getAttribute(name){return name==='href'?this.href:null},
    setAttribute(name,value){this.attributes.set(name,value)},
    removeAttribute(name){this.attributes.delete(name)}
  }));
  const sections=links.map(link=>({dataset:{analysisWorkspace:link.dataset.workspace},hidden:false}));
  const location={hash:'#adsorption-isotherms'};
  const history={entries:[],pushState(_state,_title,href){this.entries.push(href);location.hash=href}};
  const document={
    querySelectorAll(selector){
      if(selector==='[data-analysis-workspace]')return sections;
      if(selector==='[data-workspace]')return links;
      if(selector==='[data-rdf-subview]'||selector==='#sharedChainPlotUi select, #sharedChainPlotUi input')return [];
      return [];
    },
    querySelector(selector){
      const match=selector.match(/^\[data-analysis-workspace="(.+)"\]$/);
      return match?{scrollIntoView(){},dataset:{analysisWorkspace:match[1]}}:null;
    }
  };
  const window={
    addEventListener(type,handler){windowListeners.set(type,handler)},
    dispatchEvent(){}
  };
  Object.assign(globalThis,{document,window,location,history,requestAnimationFrame:callback=>callback(),CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail}}});
  try{
    const navigation=await import(`./workspace-navigation-ui.mjs?test=${Date.now()}`);
    let prevented=false;
    listeners.get('rdf:click')({preventDefault(){prevented=true}});
    assert.equal(prevented,true);
    assert.deepEqual(history.entries,['#rdf-workspace']);
    assert.equal(navigation.controller.active,'rdf');
    assert.equal(sections.find(x=>x.dataset.analysisWorkspace==='rdf').hidden,false);
    assert.equal(sections.find(x=>x.dataset.analysisWorkspace==='isotherm').hidden,true);
    assert.equal(links.find(x=>x.dataset.workspace==='rdf').attributes.get('aria-current'),'page');
    assert.equal(links.find(x=>x.dataset.workspace==='isotherm').attributes.has('aria-current'),false);

    location.hash='#adsorption-isotherms';
    windowListeners.get('popstate')();
    assert.equal(navigation.controller.active,'isotherm');
    assert.equal(sections.find(x=>x.dataset.analysisWorkspace==='isotherm').hidden,false);

    location.hash='#trajectory-energetics';
    windowListeners.get('hashchange')();
    assert.equal(navigation.controller.active,'trajectory_energetics');
  }finally{
    for(const key of ['document','window','location','history','requestAnimationFrame','CustomEvent'])delete globalThis[key];
  }
});
