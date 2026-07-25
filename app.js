import { APP_MODES, summarizeSelectedFiles, viewForMode } from './ui-state.mjs';
import { importBrowserFiles } from './importers.mjs';
import { samplingQuality } from './analysis.mjs';

const rdfCanvas = document.querySelector('#rdfCanvas');
const poreCanvas = document.querySelector('#poreCanvas');
const fileInput = document.querySelector('#fileInput');
const directoryInput = document.querySelector('#directoryInput');
const status = document.querySelector('#fileStatus');
const workspace = document.querySelector('#demoWorkspace');
const modeBanner = document.querySelector('#modeBanner');
const realWorkspace = document.querySelector('#realWorkspace');
const componentSelect = document.querySelector('#componentSelect');
const pairSelect = document.querySelector('#pairSelect');
const pressureSelect = document.querySelector('#pressureSelect');
let imported = null;

function setMode(mode, files = []) {
  const view = viewForMode(mode, summarizeSelectedFiles(files));
  workspace.hidden = view.workspaceHidden;
  realWorkspace.hidden = true;
  modeBanner.textContent = view.badge;
  modeBanner.classList.toggle('synthetic', mode === APP_MODES.SYNTHETIC);
  status.textContent = view.status;
  if (!view.workspaceHidden) requestAnimationFrame(() => { drawRdf(); drawPore(); });
}

function fitCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const box = canvas.getBoundingClientRect();
  canvas.width = box.width * ratio;
  canvas.height = box.height * ratio;
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  return { context, width: box.width, height: box.height };
}

function drawRdf() {
  const { context: c, width: w, height: h } = fitCanvas(rdfCanvas);
  const pad = { left: 48, right: 12, top: 12, bottom: 33 };
  const pw = w - pad.left - pad.right, ph = h - pad.top - pad.bottom;
  c.font = '9px ui-monospace'; c.strokeStyle = '#dcddd7'; c.fillStyle = '#747a74'; c.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + ph * i / 5; c.beginPath(); c.moveTo(pad.left, y); c.lineTo(w-pad.right, y); c.stroke();
    c.fillText((3-i*.6).toFixed(1), 12, y+3);
  }
  for (let i = 0; i <= 7; i++) {
    const x = pad.left + pw * i / 7; c.beginPath(); c.moveTo(x, pad.top); c.lineTo(x, h-pad.bottom); c.stroke();
    c.fillText((2.5+i*.7).toFixed(1), x-8, h-12);
  }
  c.save(); c.translate(9,h/2+20); c.rotate(-Math.PI/2); c.fillText('g(r)',0,0); c.restore(); c.fillText('distance / Å', w/2-28,h-1);
  const colors = ['#98bca9','#78a88e','#4c896d','#28664e','#ff9878','#ff7247'];
  colors.forEach((color,j) => {
    c.beginPath(); c.strokeStyle=color; c.lineWidth=j===5?2.5:1.3; c.globalAlpha=.78;
    for(let i=0;i<=180;i++){
      const r=2.5+4.9*i/180;
      const peak=5.55-.045*j;
      const g=.17+(.35+j*.31)*Math.exp(-Math.pow((r-peak)/(.52-.055*j),2))+.22*Math.exp(-Math.pow((r-6.45)/.7,2));
      const x=pad.left+pw*i/180, y=pad.top+ph*(1-g/3);
      i?c.lineTo(x,y):c.moveTo(x,y);
    } c.stroke();
  }); c.globalAlpha=1;
  const x1=pad.left+pw*(5.31-2.5)/4.9, x2=pad.left+pw*(5.48-2.5)/4.9;
  c.fillStyle='#ff724719';c.fillRect(x1,pad.top,x2-x1,ph);c.strokeStyle='#ff7247';c.setLineDash([3,3]);c.strokeRect(x1,pad.top,x2-x1,ph);c.setLineDash([]);
}

function drawPore() {
  const { context:c,width:w,height:h }=fitCanvas(poreCanvas); c.clearRect(0,0,w,h);
  c.strokeStyle='#cbd0ca';c.lineWidth=1;
  for(let x=10;x<w;x+=30) for(let y=14;y<h;y+=27){c.beginPath();c.arc(x+(y%2)*.5,y,3,0,7);c.stroke();}
  c.fillStyle='#fbfaf6';c.beginPath();c.ellipse(w/2,h/2,w*.34,h*.43,0,0,7);c.fill();c.strokeStyle='#9eb3a8';c.stroke();
  const atoms=[[-.25,.12],[-.12,.05],[0,0],[.13,-.06],[.26,-.13]];
  c.lineWidth=4;c.strokeStyle='#44564d';c.beginPath();atoms.forEach(([x,y],i)=>{const px=w/2+x*w,py=h/2+y*h;i?c.lineTo(px,py):c.moveTo(px,py)});c.stroke();
  atoms.forEach(([x,y],i)=>{c.beginPath();c.fillStyle=(i===0||i===4)?'#ff7247':'#2b7055';c.arc(w/2+x*w,h/2+y*h,(i===0||i===4)?11:8,0,7);c.fill();});
  c.strokeStyle='#ff7247';c.lineWidth=1;c.setLineDash([4,4]);[atoms[0],atoms[4]].forEach(([x,y])=>{c.beginPath();c.arc(w/2+x*w,h/2+y*h,26,0,7);c.stroke()});c.setLineDash([]);
}

function pairKey(dataset) { return dataset.manifest.rdf_filename; }

function options(select, values) {
  select.replaceChildren(...values.map(value => Object.assign(document.createElement('option'), { value, textContent: value })));
}

function drawRealRdf(records) {
  const canvas = document.querySelector('#realRdfCanvas');
  const { context: c, width: w, height: h } = fitCanvas(canvas);
  const pad = { left: 52, right: 16, top: 16, bottom: 36 }, pw = w-pad.left-pad.right, ph=h-pad.top-pad.bottom;
  const xMin=records[0].distanceA, xMax=records.at(-1).distanceA, yMax=Math.max(1, ...records.map(row=>row.gR));
  c.strokeStyle='#d8d8cf'; c.fillStyle='#17251f'; c.font='10px ui-monospace'; c.strokeRect(pad.left,pad.top,pw,ph);
  c.beginPath(); c.strokeStyle='#2b7055'; c.lineWidth=2;
  records.forEach((row,index)=>{ const x=pad.left+(row.distanceA-xMin)/(xMax-xMin)*pw, y=pad.top+ph-row.gR/yMax*ph; index?c.lineTo(x,y):c.moveTo(x,y); }); c.stroke();
  c.fillText(`${xMin} Å`,pad.left,h-12); c.fillText(`${xMax} Å`,w-pad.right-55,h-12); c.fillText(`true max g(r): ${yMax}`,pad.left+8,pad.top+16);
}

function renderImported() {
  const components=[...new Set(imported.datasets.map(item=>item.manifest.component))];
  if (!components.includes(componentSelect.value)) options(componentSelect, components);
  const component=componentSelect.value, pairs=[...new Set(imported.datasets.filter(item=>item.manifest.component===component).map(pairKey))];
  if (!pairs.includes(pairSelect.value)) options(pairSelect,pairs);
  const rows=imported.datasets.filter(item=>item.manifest.component===component&&pairKey(item)===pairSelect.value);
  options(pressureSelect,rows.map((item,index)=>String(index))); const selected=rows[Number(pressureSelect.dataset.selected || 0)] || rows[0];
  if (!selected) return;
  document.querySelector('#datasetTitle').textContent=`${component} · ${selected.manifest.rdf_filename}`;
  document.querySelector('#pressureValue').textContent=`${selected.manifest.pressure_pa} Pa (${selected.manifest.pressure_bar} bar)`;
  document.querySelector('#weightValue').textContent=`${samplingQuality(selected.rdf.records).weight} · unnormalized distance histogram sum`;
  [...pressureSelect.options].forEach((option,index)=>option.textContent=`${rows[index].manifest.pressure_pa} Pa · run ${rows[index].manifest.run}`);
  document.querySelector('#diagnostics').replaceChildren(...(imported.diagnostics.length?imported.diagnostics:[{severity:'ok',message:'Manifest targets and parsed RDF rows are valid.'}]).map(item=>{const li=document.createElement('li');li.className=item.severity;li.textContent=`${item.severity.toUpperCase()}: ${item.message}`;return li;}));
  realWorkspace.hidden=false; workspace.hidden=true; drawRealRdf(selected.rdf.records);
}

async function handleFiles(files){
  if(!files.length)return;
  setMode(APP_MODES.FILES_SELECTED, files);
  status.textContent=`Reading ${files.length} local files…`;
  imported=await importBrowserFiles(files,{verifyChecksums:document.querySelector('#verifyChecksums').checked});
  if(imported.datasets.length){ status.textContent=`Parsed ${imported.datasets.length} RDF files from ${imported.rows.length} manifest rows · ${imported.diagnostics.length} diagnostics`; renderImported(); }
  else { status.textContent=`Import produced no browsable RDF data · ${imported.diagnostics.map(item=>item.message).join(' ')}`; }
}
fileInput.addEventListener('change',e=>handleFiles(e.target.files));
directoryInput.addEventListener('change',e=>handleFiles(e.target.files));
document.querySelector('#demoButton').addEventListener('click',()=>setMode(APP_MODES.SYNTHETIC));
[componentSelect,pairSelect].forEach(select=>select.addEventListener('change',()=>{pressureSelect.dataset.selected='0';renderImported();}));
pressureSelect.addEventListener('change',()=>{pressureSelect.dataset.selected=pressureSelect.value;renderImported();});
document.querySelector('#exportButton').addEventListener('click',()=>{const component=componentSelect.value,pair=pairSelect.value;const items=imported.datasets.filter(item=>item.manifest.component===component&&pairKey(item)===pair);const csv=['component,run,pressure_pa,rdf_filename,bin_index,distance_A,g_r,unnormalized_distance_histogram',...items.flatMap(item=>item.rdf.records.map(row=>[component,item.manifest.run,item.manifest.pressure_pa,pair,row.binIndex,row.distanceA,row.gR,row.unnormalizedDistanceHistogram].join(',')))].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='porelens-rdf-export.csv';a.click();URL.revokeObjectURL(a.href);});
document.querySelector('#inspectButton').addEventListener('click',()=>document.querySelector('#details').scrollIntoView({behavior:'smooth'}));
document.querySelectorAll('.segmented button').forEach(button=>button.addEventListener('click',e=>{e.currentTarget.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('active'));e.currentTarget.classList.add('active')}));
const drop=document.querySelector('#dropzone');
['dragenter','dragover'].forEach(name=>drop.addEventListener(name,e=>{e.preventDefault();drop.style.outline='2px solid #ff7247'}));
['dragleave','drop'].forEach(name=>drop.addEventListener(name,e=>{e.preventDefault();drop.style.outline='none';if(e.dataTransfer)handleFiles(e.dataTransfer.files)}));
window.addEventListener('resize',()=>{if (!workspace.hidden) { drawRdf(); drawPore(); }});
setMode(APP_MODES.EMPTY);
