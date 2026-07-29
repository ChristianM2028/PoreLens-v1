import test from 'node:test';import assert from 'node:assert/strict';import {analysisAvailability,configurationValid,contributionRows,decodeEvidenceFrame,EvidenceFrameDecoder,renderStructureCanvas,selectEvidenceFrame} from '../src/ui/lj-ui.mjs';
import {indexPdbSource} from '../src/core/trajectory.mjs';
test('UI availability reports missing trajectory without losing annotation configuration',()=>{const audit={capabilities:{quantitativeLJ:false},diagnostics:[{severity:'warning',message:'Missing .pdb; trajectory-dependent analysis is unavailable.'}]};assert.equal(analysisAvailability(audit).ready,false);assert.match(analysisAvailability(audit).message,/trajectory-dependent/i);});
test('Run gating requires explicit shell semantics, control, and normalization',()=>{const audit={capabilities:{quantitativeLJ:true},diagnostics:[],parsed:{movie:{frames:[{}]}},physicsFingerprint:'abc'},span={type:'span'};assert.equal(configurationValid({annotations:[span],scope:'',criterion:'',reference:'outside_roi',normalization:'per_pair'},audit),false);assert.equal(configurationValid({annotations:[span],scope:'anchor_site',criterion:'nearest',reference:'outside_roi',normalization:'per_pair'},audit),true);assert.equal(configurationValid({annotations:[{type:'pressure_point'}],scope:'',criterion:'',reference:'none',normalization:'per_frame'},audit),true);});
test('contribution table filtering and sorting retain annotation provenance',()=>{const results=[{selection:{annotationId:'ann-1'},contributions:{selected:[{pair:'CH3_sp3 × O2',pairCount:4,energyKJMol:{mean:-2}},{pair:'CH3_sp3 × Zn1',pairCount:2,energyKJMol:{mean:1}}]}}];assert.equal(contributionRows(results,'O2','energy')[0].annotationId,'ann-1');assert.equal(contributionRows(results,'','count')[0].pairCount,4);});
test('fixture evidence renders object-shaped minimum-image partner and identity',async()=>{
  const {readFile}=await import('node:fs/promises');
  const fixture=JSON.parse(await readFile(new URL('./fixtures/lj-ui/evidence-frame.json',import.meta.url),'utf8'));
  const result={frames:[{frameIndex:fixture.frameIndex}],pairRows:{selected:[fixture.pair]}};
  const evidence=selectEvidenceFrame(result,fixture.frameIndex),calls=[];
  const context={clearRect(){},beginPath(){},arc(){},fill(){},moveTo(x,y){calls.push(['moveTo',x,y])},lineTo(x,y){calls.push(['lineTo',x,y])},stroke(){},fillText(...args){calls.push(['fillText',...args])}};
  const canvas={width:320,height:180,dataset:{},getContext:()=>context};
  assert.match(evidence.identityText,/Minimum-image partner \(10\.250, 1\.2500, 2\.2500\) Å; image \[1, 0, 0\]/);
  assert.equal(renderStructureCanvas(canvas,evidence,[fixture]),true);
  assert.equal(calls.some(([name])=>name==='lineTo'),true);
  assert.equal(canvas.dataset.state,undefined);
});
test('malformed or absent evidence geometry renders a visible unavailable state',()=>{
  const frame={frameIndex:0,atoms:[{x:1,y:2,z:3,moleculeIndex:0}]};
  for(const periodicPartner of [undefined,{x:4,y:'bad',z:6}]){
    const result={pairRows:{selected:[{frameIndex:0,guestAtomIndex:0,moleculeIndex:0,energyKJMol:-1,periodicPartner}]}};
    const evidence=selectEvidenceFrame(result,0),labels=[];
    const context={clearRect(){},fillText(text){labels.push(text)}};
    const canvas={width:320,height:180,dataset:{},getContext:()=>context};
    assert.match(evidence.identityText,/unavailable \(missing or malformed minimum-image geometry\)/);
    assert.equal(renderStructureCanvas(canvas,evidence,[frame]),false);
    assert.equal(canvas.dataset.state,'unavailable');
    assert.match(labels[0],/Structure unavailable/);
  }
});
test('indexed frame metadata is diagnosed rather than treated as coordinates',()=>{
  const evidence=selectEvidenceFrame({pairRows:{selected:[{frameIndex:0,guestAtomIndex:0,moleculeIndex:0,energyKJMol:-1,periodicPartner:{x:2,y:3,z:4}}]}},0),labels=[];
  const canvas={width:320,height:180,dataset:{},getContext:()=>({clearRect(){},fillText(text){labels.push(text)}})};
  assert.doesNotThrow(()=>assert.equal(renderStructureCanvas(canvas,evidence,[{frameIndex:0,model:1,start:0,end:99,atomCount:250,atoms:{length:250}}]),false));
  assert.match(canvas.dataset.message,/indexed metadata, not decoded coordinates/);
  assert.match(labels[0],/Structure unavailable/);
});
test('indexed fixture evidence decodes topology roles and renders atom coordinates',async()=>{
  const {readFile}=await import('node:fs/promises'),text=await readFile(new URL('./fixtures/trimmed-movie-25-26.pdb',import.meta.url),'utf8'),movie=await indexPdbSource(new Blob([text]));
  const topology={sites:[{type:'CF3_sp3'},...Array.from({length:8},()=>({type:'CF2_sp3'})),{type:'CF3_sp3'}]},frame=await decodeEvidenceFrame(movie,topology,1),calls=[];
  const evidence=selectEvidenceFrame({pairRows:{selected:[{frameIndex:1,guestAtomIndex:0,moleculeIndex:0,energyKJMol:-1,periodicPartner:{x:2,y:3,z:4},periodicImage:[0,0,0]}]}},1);
  const canvas={width:320,height:180,dataset:{},getContext:()=>({clearRect(){},beginPath(){},arc(x,y){calls.push([x,y])},fill(){},moveTo(){},lineTo(){},stroke(){},fillText(){}})};
  assert.equal(frame.atoms.length,260);assert.equal(frame.atoms[0].siteType,'CF3_sp3');assert.equal(renderStructureCanvas(canvas,evidence,[frame]),true);assert.ok(calls.length>0);assert.ok(calls.every(point=>point.every(Number.isFinite)));
});
test('evidence decoding reports current failures and rejects stale consecutive selections',async()=>{
  const events=[],pending=[];
  const decoder=new EvidenceFrameDecoder({decode:(_movie,_topology,index)=>new Promise((resolve,reject)=>pending[index]={resolve,reject}),onPending:e=>events.push(['pending',e.frameIndex]),onFrame:(f,e)=>events.push(['frame',e.frameIndex,f]),onError:(error,e)=>events.push(['error',e.frameIndex,error.message])});
  const first=decoder.select({}, {}, {frameIndex:0}),second=decoder.select({}, {}, {frameIndex:1});pending[1].resolve({atoms:[{x:1,y:2,z:3}]});await second;pending[0].resolve({atoms:[{x:9,y:9,z:9}]});await first;
  assert.deepEqual(events.filter(([kind])=>kind==='frame').map(([,index])=>index),[1]);
  const failed=decoder.select({}, {}, {frameIndex:2});pending[2].reject(new Error('fixture decode failed'));assert.equal(await failed,false);assert.deepEqual(events.at(-1),['error',2,'fixture decode failed']);
});
test('workflow markup is annotation-first and reuses importer authorization',async()=>{const {readFile}=await import('node:fs/promises'),html=await readFile(new URL('../index.html',import.meta.url),'utf8');for(const id of ['trajectory-energetics','ljAnnotationList','ljScope','ljCriterion','ljReference','ljNormalization','runLjAnalysis','cancelLjAnalysis','ljProgress','ljSummary','ljContributionRows','ljPressureResults','ljDiagnostics','downloadLjJson','downloadLjCsv'])assert.match(html,new RegExp(`id="${id}"`));assert.doesNotMatch(html,/id="ljDatasetFolder"|id="ljRunFiles"|moviePlay|movieSpeed/);assert.match(html,/reconstructed coordinate-based pairwise LJ contributions under the validated simulated model/);});
test('workspace uses its requested identity and has no legacy generic-output links',async()=>{const {readFile}=await import('node:fs/promises'),html=await readFile(new URL('../index.html',import.meta.url),'utf8'),chain=await readFile(new URL('../src/ui/chain-plotter-ui.mjs',import.meta.url),'utf8');assert.match(html,/Trajectory Energetics &amp; Spatial Evidence/);assert.doesNotMatch(chain,/#movies-lj|#ljAnalysis/);});
import {exactAuthorizedCatalogRun} from '../src/import/browser/file-list-discovery.mjs';
test('authorized run resolution rejects dataset, string-run, pressure, and missing-file mismatches',()=>{const file={name:'simulation.input',text:'x'},catalog={runs:[{chain:'C5',run:'1_otherstuff',pressurePa:23299.51811,simulationFile:file,outputs:{},dependencies:{}}]},identity={datasetFingerprint:'a',currentDatasetFingerprint:'a',chain:5};assert.equal(exactAuthorizedCatalogRun(catalog,{...identity,currentDatasetFingerprint:'b',run:'1_otherstuff',pressurePa:23299.51811}).diagnostics[0].code,'dataset_identity_mismatch');assert.equal(exactAuthorizedCatalogRun(catalog,{...identity,run:1,pressurePa:23299.51811}).diagnostics[0].code,'run_identity_not_string');assert.equal(exactAuthorizedCatalogRun(catalog,{...identity,run:'1_otherstuff',pressurePa:10}).diagnostics[0].code,'exact_pressure_mismatch');const exact=exactAuthorizedCatalogRun(catalog,{...identity,run:'1_otherstuff',pressurePa:23299.51811});assert.equal(exact.run.run,'1_otherstuff');assert.deepEqual(exact.files,[file])});
test('authorized run full identity selects the annotated chain before run and pressure',()=>{const runs=[{id:'C5/1',rootRelativePath:'root/C5/1',chain:'C5',run:'1',pressurePa:100,simulationFile:{name:'c5'},outputs:{},dependencies:{}},{id:'C6/1',rootRelativePath:'root/C6/1',chain:'C6',run:'1',pressurePa:100,simulationFile:{name:'c6'},outputs:{},dependencies:{}}],result=exactAuthorizedCatalogRun({runs},{datasetFingerprint:'fp',currentDatasetFingerprint:'fp',chain:5,run:'1',pressurePa:100});assert.equal(result.run.id,'C5/1')});
test('authorized run full-identity duplicates remain ambiguous with distinguishing candidates',()=>{const runs=['copy-a','copy-b'].map((rootRelativePath,index)=>({id:`duplicate-${index}`,rootRelativePath,chain:'C5',run:'1',pressurePa:100,outputs:{},dependencies:{}})),result=exactAuthorizedCatalogRun({runs},{datasetFingerprint:'fp',currentDatasetFingerprint:'fp',chain:'C5',run:'1',pressurePa:100});assert.equal(result.run,null);assert.equal(result.diagnostics[0].code,'ambiguous_exact_run');assert.deepEqual(result.diagnostics[0].candidates,runs.map(({id,rootRelativePath,chain,run,pressurePa})=>({id,rootRelativePath,chain,run,pressurePa}))) });
test('authorized run does not substitute another chain when the annotated chain is missing',()=>{const catalog={runs:[{chain:'C6',run:'1',pressurePa:100}]},result=exactAuthorizedCatalogRun(catalog,{datasetFingerprint:'fp',currentDatasetFingerprint:'fp',chain:5,run:'1',pressurePa:100});assert.equal(result.run,null);assert.equal(result.diagnostics[0].code,'exact_chain_missing')});
test('LJ source produces authorization request and completed evidence panels',async()=>{const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../src/ui/lj-ui.mjs',import.meta.url),'utf8');assert.match(source,/porelens:authorized-run-request/);for(const evidence of ['normalization','blockUncertainty','pressureResolved','molecules','periodicPartner','whole_molecule','context_only'])assert.match(source,new RegExp(evidence));assert.match(source,/replaceChildren\(result,disclaimer\)/);assert.match(source,/lj-capability-disclaimer/);assert.doesNotMatch(source,/importRunPackage|discoverChainSeries|parseManifest/)});
