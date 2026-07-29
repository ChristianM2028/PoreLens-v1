import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisRange,indexPdbSource,selectedPdbFrames,parsePdbMovie} from './trajectory.mjs';

const model=number=>`MODEL    ${number}\nCRYST1   10.000   10.000   10.000  90.00  90.00  90.00\nATOM      1  C   MOL             1.000   2.000   3.000  1.00  0.00           C  \nENDMDL\n`;

test('nondivisible equal intervals are adjacent and cover every frame exactly once',()=>{
  const ranges=[1,2,3].map(i=>analysisRange({totalFrames:10,intervalCount:3,firstInterval:i,lastInterval:i,stride:1}));
  assert.deepEqual(ranges.map(x=>[x.startFrame,x.endFrame]),[[0,3],[3,6],[6,10]]);
  assert.deepEqual(ranges.flatMap(x=>x.frameIndices),[0,1,2,3,4,5,6,7,8,9]);
  assert.equal(new Set(ranges.flatMap(x=>x.frameIndices)).size,10);
});

test('combined intervals and stride use the selected half-open range',()=>{
  assert.deepEqual(analysisRange({totalFrames:11,intervalCount:4,firstInterval:2,lastInterval:4,stride:3}).frameIndices,[2,5,8]);
  assert.deepEqual(analysisRange({totalFrames:5}).frameIndices,[0,1,2,3,4]);
});

test('invalid interval and stride configurations are rejected',()=>{
  for(const value of [{totalFrames:0},{totalFrames:5,intervalCount:0},{totalFrames:5,intervalCount:2,firstInterval:0,lastInterval:1},{totalFrames:5,intervalCount:2,firstInterval:2,lastInterval:1},{totalFrames:5,stride:0}])assert.throws(()=>analysisRange(value));
});

test('streaming index skips incomplete trailing models and retains original identities',async()=>{
  const index=await indexPdbSource(new Blob([model(17)+model(29)+'MODEL 31\nATOM']));
  assert.deepEqual(index.frames.map(x=>x.model),[17,29]);
  assert.equal(index.diagnostics[0].code,'incomplete_trailing_model');
  const retained=[];for await(const item of selectedPdbFrames(index,analysisRange({totalFrames:2}),{},null))retained.push([item.frameIndex,item.modelNumber]);
  assert.deepEqual(retained,[[0,17],[1,29]]);
});

test('complete streaming selection decodes identically to full small-fixture parsing',async()=>{
  const text=model(4)+model(9),full=parsePdbMovie(text),index=await indexPdbSource(new Blob([text])),streamed=[];
  for await(const item of selectedPdbFrames(index,analysisRange({totalFrames:2})))streamed.push(item.frame);
  assert.deepEqual(streamed,full.frames);
});

test('cancellation stops selected-frame decoding before another read',async()=>{
  const index=await indexPdbSource(new Blob([model(1)+model(2)])),controller=new AbortController(),iterator=selectedPdbFrames(index,analysisRange({totalFrames:2}),{},controller.signal);
  assert.equal((await iterator.next()).value.frameIndex,0);controller.abort();await assert.rejects(()=>iterator.next(),error=>error.name==='AbortError');
});
