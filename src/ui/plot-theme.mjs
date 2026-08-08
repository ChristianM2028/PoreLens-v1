/** Shared, publication-oriented visual language for every PoreLens plot. */
export const PLOT_THEME = Object.freeze({
  fontFamily: 'Arial, Helvetica, sans-serif', axisTitlePx: 20, tickPx: 16,
  legendPx: 16, legendHeadingPx: 17, textLineGapPx: 4, legendRowGapPx: 5,
  legendGroupGapPx: 9, axisColor: '#000000', gridColor: '#e1e5e3', axisWidth: 1.4,
  lineWidth: 2, markerSize: 6, errorWidth: 1.1, errorCap: 4,
  background: '#ffffff', margins: Object.freeze({ left: 112, right: 30, top: 66, bottom: 82 })
});

/** Compact, role-specific geometry for canvases in the comparison workspace. */
export const COMPARISON_LAYOUTS = Object.freeze({
  curve: Object.freeze({ top: 14, right: 16, bottom: 16, gap: 8, titleGap: 12, legendGap: 10, minDataWidth: 180, minDataHeight: 150 }),
  heatmap: Object.freeze({ top: 14, right: 12, bottom: 16, gap: 8, titleGap: 10, colorBarWidth: 14, colorBarGap: 10, minDataWidth: 140, minDataHeight: 120 })
});

const measured=(measure,text)=>Math.ceil(measure(String(text))||0);
/**
 * Lay out a measured horizontal legend. Oversized labels are visually clipped to
 * their item's text box; callers must retain `fullLabel` in title/ARIA metadata.
 */
export function measuredLegendLayout({availableWidth,labelWidths=[],swatchSize=24,fontHeight=PLOT_THEME.legendPx,horizontalGap=18,verticalGap=5}={}) {
  const width=Math.max(0,Number(availableWidth)||0), count=labelWidths.length;
  if(!count)return {width,height:0,rows:0,columns:0,items:[],policy:'clip'};
  const safeWidths=labelWidths.map(value=>Math.max(0,Number(value)||0));
  const natural=safeWidths.map(value=>swatchSize+horizontalGap+value);
  let columns=count;
  while(columns>1){
    const rows=Math.ceil(count/columns), rowSizes=Array.from({length:rows},(_,row)=>natural.slice(row*columns,Math.min(count,(row+1)*columns)).reduce((a,b)=>a+b,0));
    if(Math.max(...rowSizes)<=width)break;
    columns--;
  }
  const rows=Math.ceil(count/columns), items=[];
  for(let row=0;row<rows;row++){
    const start=row*columns,end=Math.min(count,start+columns),rowNatural=natural.slice(start,end);
    const itemWidth=Math.max(0,Math.min(Math.max(...rowNatural),width/(end-start||1)));
    const used=Math.min(width,itemWidth*(end-start)),offset=Math.max(0,(width-used)/2);
    for(let index=start;index<end;index++){
      const x=offset+(index-start)*itemWidth,y=row*(fontHeight+verticalGap);
      items.push({index,row,column:index-start,x,y,width:itemWidth,height:fontHeight,textX:x+swatchSize+horizontalGap,maxLabelWidth:Math.max(0,itemWidth-swatchSize-horizontalGap),measuredLabelWidth:safeWidths[index],clipped:safeWidths[index]>Math.max(0,itemWidth-swatchSize-horizontalGap)});
    }
  }
  return {width,height:rows*fontHeight+(rows-1)*verticalGap,rows,columns,items,policy:'clip'};
}
export function comparisonCurveLayout({width,height,measure,yTickLabels=[],legendLabels=[],insetLegend=false}) {
  const role=COMPARISON_LAYOUTS.curve, tickH=PLOT_THEME.tickPx+5, yWidth=Math.max(0,...yTickLabels.map(x=>measured(measure,x)));
  const left=role.titleGap+PLOT_THEME.axisTitlePx+role.gap+yWidth+role.gap;
  const available=Math.max(0,width-left-role.right), labelWidths=legendLabels.map(x=>measured(measure,x)), inset=Boolean(insetLegend);
  const insetPadding=7,insetOffset=8,insetAvailable=Math.max(0,available-insetOffset*2-insetPadding*2);
  const naturalLegendWidth=labelWidths.reduce((sum,value)=>sum+18+7+value,0);
  const legendAvailable=inset?Math.min(insetAvailable,naturalLegendWidth):available;
  const measuredLegend=measuredLegendLayout({availableWidth:legendAvailable,labelWidths,swatchSize:18,fontHeight:PLOT_THEME.legendPx,horizontalGap:7,verticalGap:5});
  const legendHeight=!inset&&measuredLegend.height?measuredLegend.height+role.legendGap:0;
  const top=role.top+legendHeight, bottom=role.bottom+tickH+role.gap+PLOT_THEME.axisTitlePx;
  const legendX=inset?left+insetOffset+insetPadding:left,legendY=inset?top+insetOffset+insetPadding:role.top;
  const legend={...measuredLegend,x:legendX,y:legendY,height:inset?measuredLegend.height:legendHeight,inset,background:inset?{x:legendX-insetPadding,y:legendY-insetPadding,width:measuredLegend.width+insetPadding*2,height:measuredLegend.height+insetPadding*2,padding:insetPadding}:null,items:measuredLegend.items.map(item=>({...item,x:legendX+item.x,y:legendY+item.y,textX:legendX+item.textX}))};
  return {left,right:role.right,top,bottom,plotW:Math.max(0,width-left-role.right),plotH:Math.max(0,height-top-bottom),legend,minimum:{width:role.minDataWidth,height:role.minDataHeight}};
}
export function comparisonHeatmapLayout({width,height,measure,pressureTickLabels=[],colorTickLabels=[]}) {
  const role=COMPARISON_LAYOUTS.heatmap, pressureWidth=Math.max(0,...pressureTickLabels.map(x=>measured(measure,x))), colorWidth=Math.max(0,...colorTickLabels.map(x=>measured(measure,x)));
  const left=role.titleGap+PLOT_THEME.axisTitlePx+role.gap+pressureWidth+role.gap;
  const right=role.right+role.colorBarWidth+role.colorBarGap+colorWidth+role.gap+PLOT_THEME.axisTitlePx;
  const bottom=role.bottom+PLOT_THEME.tickPx+role.gap+PLOT_THEME.axisTitlePx;
  return {left,right,top:role.top,bottom,plotW:Math.max(0,width-left-right),plotH:Math.max(0,height-role.top-bottom),colorBar:{x:width-right+role.gap,y:role.top,width:role.colorBarWidth,height:Math.max(0,height-role.top-bottom)},minimum:{width:role.minDataWidth,height:role.minDataHeight}};
}

// Okabe-Ito-derived mapping extended with high-contrast tones. It is stable by chain length.
const COLORS = ['#0072B2','#E69F00','#009E73','#D55E00','#CC79A7','#56B4E9','#7A5C00','#882255','#332288'];
const MARKERS = ['circle','square','triangle','diamond','cross','down','plus','hexagon','star'];

/** Deterministic GEMC encodings. The input order is deliberately ignored: an
 * identity always hashes to the same palette slot, while collisions are
 * resolved against the complete sorted identity set. */
export const GEMC_COLORS=Object.freeze(['#0072B2','#E69F00','#009E73','#D55E00','#CC79A7','#56B4E9','#882255','#332288']);
const hashKey=key=>[...String(key)].reduce((h,c)=>Math.imul(h^c.codePointAt(0),16777619)>>>0,2166136261);
const fallbackColor=i=>{const hue=(i*137.508+23)%360;return `hsl(${hue.toFixed(1)} 62% ${i%2?38:48}%)`};
export function allocateGemcStyles(groupKeys){
  const keys=[...new Set(groupKeys.map(String))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),free=new Set(GEMC_COLORS.keys()),out={};
  for(const key of keys){let slot=hashKey(key)%GEMC_COLORS.length;if(free.size){while(!free.has(slot))slot=(slot+1)%GEMC_COLORS.length;free.delete(slot)}const overflow=Object.keys(out).length>=GEMC_COLORS.length,index=Object.keys(out).length;out[key]=Object.freeze({groupId:key,color:overflow?fallbackColor(index):GEMC_COLORS[slot],pattern:overflow?index%3:0,vapor:Object.freeze({dash:[],marker:'circle'}),liquid:Object.freeze({dash:[7,4],marker:'triangle'})})}
  return Object.freeze(out);
}

export const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
export function canvasPointer(canvas,event){const r=canvas.getBoundingClientRect();return {x:clamp((event.clientX-r.left)*(canvas.width/(r.width||1)),0,canvas.width),y:clamp((event.clientY-r.top)*(canvas.height/(r.height||1)),0,canvas.height)}}
export function moveNormalizedLegend(position,dx,dy,geometry){const maxX=Math.max(0,geometry.canvas.width-geometry.legend.width),maxY=Math.max(0,geometry.canvas.height-geometry.legend.height);return {x:maxX?clamp((position.x*maxX)+dx,0,maxX)/maxX:0,y:maxY?clamp((position.y*maxY)+dy,0,maxY)/maxY:0}}
export function hitRect(point,rect){return point.x>=rect.x&&point.x<=rect.x+rect.width&&point.y>=rect.y&&point.y<=rect.y+rect.height}
/** Pure, measured canvas geometry used by rendering, dragging, and tests. */
export function canvasPlotLayout({width,height,measure,labels=[],position={x:1,y:0},overlay=false}={}){
 const margin={left:92,right:24,top:52,bottom:68},available=Math.max(80,width-margin.left-margin.right),labelWidths=labels.map(x=>Math.ceil(measure(String(x))||0));let flow=measuredLegendLayout({availableWidth:Math.min(available,560),labelWidths,swatchSize:42,horizontalGap:7,fontHeight:PLOT_THEME.legendPx,verticalGap:7}),pad=9,maxRows=Math.max(1,Math.floor((height-pad*2)/(PLOT_THEME.legendPx+7)));if(flow.rows>maxRows){const columns=Math.ceil(labels.length/maxRows),itemWidth=Math.max(1,Math.min(560,width-pad*2)/columns),items=labels.map((_,index)=>{const row=index%maxRows,column=Math.floor(index/maxRows),maxLabelWidth=Math.max(0,itemWidth-49);return {index,row,column,x:column*itemWidth,y:row*(PLOT_THEME.legendPx+7),width:itemWidth,height:PLOT_THEME.legendPx,textX:column*itemWidth+49,maxLabelWidth,measuredLabelWidth:labelWidths[index],clipped:labelWidths[index]>maxLabelWidth}});flow={width:itemWidth*columns,height:maxRows*PLOT_THEME.legendPx+(maxRows-1)*7,rows:maxRows,columns,items,policy:'clip'}}const lw=Math.min(width,flow.width+pad*2),lh=Math.min(height,flow.height+pad*2),maxX=Math.max(0,width-lw),maxY=Math.max(0,height-lh),legend={x:clamp(position.x??1,0,1)*maxX,y:clamp(position.y??0,0,1)*maxY,width:lw,height:lh,items:flow.items.map(item=>({...item,x:clamp(position.x??1,0,1)*maxX+pad+item.x,y:clamp(position.y??0,0,1)*maxY+pad+item.y}))};
 const top=overlay?margin.top:Math.max(margin.top,legend.y+legend.height+10),data={x:margin.left,y:top,width:Math.max(0,width-margin.left-margin.right),height:Math.max(0,height-top-margin.bottom)};
 return {canvas:{width,height},data,legend,overlay,transform:{x:n=>data.x+clamp(n,0,1)*data.width,y:n=>data.y+(1-clamp(n,0,1))*data.height}};
}

export const DATASET_STYLES=Object.freeze({
  A:Object.freeze({stroke:'solid',dash:Object.freeze([])}),
  B:Object.freeze({stroke:'dashed',dash:Object.freeze([8,5])})
});
/** Dataset slot, never its editable label, determines stroke encoding. */
export function datasetStyle(datasetId){return DATASET_STYLES[String(datasetId)]||DATASET_STYLES.A}
/** Independent legend keys for the two simulation encodings, plus literature. */
export function chainLegendModel(curves){
  const shown=curves.filter(c=>c.visible!==false),sim=shown.filter(c=>!c.literature),literature=shown.filter(c=>c.literature);
  const chains=[...new Map(sim.map(c=>[String(c.component||`C${c.chainLength}`),{kind:'chain',label:String(c.component||`C${c.chainLength}`),...chainStyle(c.chainLength)}])).values()].sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}));
  const datasets=[...new Map(sim.map(c=>[String(c.datasetId),{kind:'dataset',datasetId:String(c.datasetId),label:String(c.datasetLabel||c.legendLabel||c.datasetId),...datasetStyle(c.datasetId)}])).values()];
  return {chains,datasets,literature:literature.map(c=>({kind:'literature',label:String(c.legendLabel||'Literature'),color:c.resolvedColor||'#555',dash:[]}))};
}
/** Measured legend groups. Inside mode overlays a normalized, canvas-bounded data-area position. */
export function chainLegendGeometry({width,height,measure,model,mode='inside',position={x:1,y:0},margins=PLOT_THEME.margins}={}){
  const t=PLOT_THEME,groups=[['Chain',model.chains],['Dataset',model.datasets],['Literature',model.literature]].filter(([,items])=>items.length),pad=10,inset=8,swatch=24,textGap=8,itemGap=14;
  const headingHeight=t.legendHeadingPx+t.textLineGapPx,rowHeight=t.legendPx+t.textLineGapPx,maxBoxWidth=Math.max(1,width-margins.left-margins.right-(mode==='inside'?inset*2:0)),maxContentWidth=Math.max(1,maxBoxWidth-pad*2);
  const measuredGroups=groups.map(([title,items])=>[title,items.map(item=>({...item,measuredLabelWidth:Math.ceil(measure(String(item.label))||0)}))]);
  const maxInsideHeight=Math.max(1,height-margins.top-margins.bottom-inset*2),minimumWidth=Math.min(maxContentWidth,130);
  const widths=[];for(let candidate=maxContentWidth;candidate>=minimumWidth;candidate-=24)widths.push(candidate);if(widths.at(-1)!==minimumWidth)widths.push(minimumWidth);
  const layoutFor=contentWidth=>{let y=0,usedWidth=0;const laid=[];for(const [title,items] of measuredGroups){if(laid.length)y+=t.legendGroupGapPx;laid.push({heading:true,title,x:0,y,width:Math.min(contentWidth,Math.ceil(measure(title)||0)),height:headingHeight});y+=headingHeight+t.legendRowGapPx;let x=0,rowTop=y;for(const item of items){const natural=swatch+textGap+item.measuredLabelWidth,itemWidth=Math.min(natural,contentWidth);if(x&&x+itemWidth>contentWidth){x=0;rowTop+=rowHeight+t.legendRowGapPx}const maxLabelWidth=Math.max(0,itemWidth-swatch-textGap);laid.push({...item,x,y:rowTop,width:itemWidth,height:rowHeight,maxLabelWidth,clipped:item.measuredLabelWidth>maxLabelWidth});usedWidth=Math.max(usedWidth,x+itemWidth);x+=itemWidth+itemGap}y=rowTop+rowHeight}return {items:laid,width:Math.max(1,usedWidth),height:y}};
  let flow=layoutFor(widths[0]);if(mode==='inside')for(const candidate of widths){const next=layoutFor(candidate);flow=next;if(next.height<=maxInsideHeight)break}
  const box={width:Math.min(maxBoxWidth,flow.width+pad*2),height:Math.min(mode==='inside'?maxInsideHeight:height,flow.height+pad*2)};
  const canvas=mode==='inside'?{width:Math.max(0,width-margins.left-margins.right-inset*2),height:Math.max(0,height-margins.top-margins.bottom-inset*2)}:{width,height};
  const origin=mode==='inside'?{x:margins.left+inset,y:margins.top+inset}:{x:0,y:0},normalized={x:clamp(Number(position?.x)||0,0,1),y:clamp(Number(position?.y)||0,0,1)};
  box.x=mode==='inside'?origin.x+normalized.x*Math.max(0,canvas.width-box.width):margins.left;box.y=mode==='inside'?origin.y+normalized.y*Math.max(0,canvas.height-box.height):8;
  const reservedTop=mode==='outside-top'?Math.max(margins.top,box.y+box.height+8):margins.top;
  return {mode,canvas,legend:box,box,position:normalized,metrics:{headingHeight,rowHeight,headingPx:t.legendHeadingPx,labelPx:t.legendPx,lineGap:t.textLineGapPx,rowGap:t.legendRowGapPx,groupGap:t.legendGroupGapPx,padding:pad,swatch,textGap},items:flow.items.map(item=>({...item,x:box.x+pad+item.x,y:box.y+pad+item.y})),reservedTop,draw:mode!=='hidden'};
}
export function chainStyle(chainLength) {
  const n = Math.max(2, Number(chainLength) || 2), i = (n - 2) % COLORS.length;
  return Object.freeze({ color: COLORS[i], marker: MARKERS[i] });
}
export function conciseCurveLabel(curve, multipleDatasets = false) {
  const chain = String(curve.component || `C${curve.chainLength || ''}`);
  if (!multipleDatasets) return chain;
  const family = String(curve.legendLabel || curve.datasetLabel || curve.family || curve.datasetId || '').replace(/^[AB]:\s*/, '').split(/[·/]/)[0].trim();
  return `${family || 'Dataset'} ${chain}`;
}
export function linearTicks(min, max, target = 6) {
  if (!Number.isFinite(min + max)) return [];
  if (min === max) max = min + (Math.abs(min) || 1);
  const rough=(max-min)/(target-1), power=10**Math.floor(Math.log10(rough)), fraction=rough/power;
  const nice=(fraction<=1?1:fraction<=2?2:fraction<=2.5?2.5:fraction<=5?5:10)*power;
  const start=Math.ceil(min/nice)*nice, out=[];
  for(let v=start;v<=max+nice*1e-9;v+=nice) out.push(Math.abs(v)<nice*1e-9?0:v);
  return out;
}
export function formatTick(value, step = 0) {
  const magnitude=Math.max(Math.abs(value),Math.abs(step));
  if (magnitude && (magnitude>=1e7 || magnitude<1e-4)) return value.toExponential(1).replace('.0e','e');
  const decimals=step ? Math.max(0,Math.min(6,-Math.floor(Math.log10(Math.abs(step)))+(Math.abs(step)/10**Math.floor(Math.log10(Math.abs(step)))<2?1:0))) : 3;
  return Number(value.toFixed(decimals)).toString();
}
export function formatPressureTick(value) {
  if (!Number.isFinite(value)) return '';
  return value === 0 ? '0' : value.toExponential(1).replace('.0e','e').replace('e+','e');
}
export function logTicks(min, max) {
  const lo=Math.ceil(Math.log10(min)), hi=Math.floor(Math.log10(max)), major=[], minor=[];
  for(let p=lo;p<=hi;p++){const base=10**p;major.push({value:base,label:`10${String(p).replace(/-/g,'⁻').replace(/0/g,'⁰').replace(/1/g,'¹').replace(/2/g,'²').replace(/3/g,'³').replace(/4/g,'⁴').replace(/5/g,'⁵').replace(/6/g,'⁶').replace(/7/g,'⁷').replace(/8/g,'⁸').replace(/9/g,'⁹')}`});for(let n=2;n<10;n++){const v=n*base;if(v>min&&v<max)minor.push(v)}}
  return {major,minor};
}
export function markerIndices(length, count = 10) {
  if(length<=0)return []; if(length===1)return [0]; const n=Math.min(length,Math.max(2,count)), set=new Set();
  for(let i=0;i<n;i++)set.add(Math.round(i*(length-1)/(n-1))); return [...set];
}
export const EXPORT_PRESETS=Object.freeze({single:{width:720,height:540,scale:2},double:{width:1200,height:800,scale:2}});

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function buildLineSvg(curves,{width=1200,height=800,xLabel='Distance, r (Å)',yLabel='g(r)',logX=false,errorBars=true,markerCount=10,legendMode='inside',legendPosition={x:1,y:0}}={}) {
  const t=PLOT_THEME,shown=curves.filter(c=>c.visible!==false),model=chainLegendModel(shown),geometry=chainLegendGeometry({width,height,measure:text=>String(text).length*t.legendPx*.58,model,mode:legendMode,position:legendPosition}),m={...t.margins,top:geometry.reservedTop};
  const rows=shown.flatMap(c=>c.records.map(r=>({x:Number(r.x??r.distanceA),y:Number(r.y??r.gR??r.probabilityDensityPerA)}))).filter(p=>p.x>=(logX?Number.MIN_VALUE:-Infinity)&&Number.isFinite(p.x+p.y));
  if(!rows.length)return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`;
  let xmin=Math.min(...rows.map(p=>p.x)),xmax=Math.max(...rows.map(p=>p.x)),ymin=Math.min(0,...rows.map(p=>p.y)),ymax=Math.max(...rows.map(p=>p.y));if(logX){xmin=Math.log10(xmin);xmax=Math.log10(xmax)}
  const px=x=>m.left+((logX?Math.log10(x):x)-xmin)/(xmax-xmin||1)*(width-m.left-m.right),py=y=>height-m.bottom-(y-ymin)/(ymax-ymin||1)*(height-m.top-m.bottom),yt=linearTicks(ymin,ymax),ystep=yt[1]-yt[0]||1,logScale=logX?logTicks(10**xmin,10**xmax):null,xt=logX?logScale.major:linearTicks(xmin,xmax),description=`Color and marker identify chain (${model.chains.map(x=>x.label).join(', ')}); stroke pattern identifies dataset (${model.datasets.map(x=>`${x.label}: ${x.stroke}`).join(', ')})`;
  const body=[`<title>${esc(description)}</title><rect width="100%" height="100%" fill="${t.background}"/>`];
  yt.forEach(v=>body.push(`<line class="major-grid" x1="${m.left}" x2="${width-m.right}" y1="${py(v)}" y2="${py(v)}" stroke="${t.gridColor}"/><text class="tick y-tick" x="${m.left-12}" y="${py(v)+5}" text-anchor="end">${formatTick(v,ystep)}</text>`));
  if(logScale)logScale.minor.forEach(v=>body.push(`<line class="minor-tick" x1="${px(v)}" x2="${px(v)}" y1="${height-m.bottom}" y2="${height-m.bottom+4}"/>`));
  xt.forEach(item=>{const v=logX?item.value:item,label=logX?item.label:formatTick(item);body.push(`<line class="tick-mark" x1="${px(v)}" x2="${px(v)}" y1="${height-m.bottom}" y2="${height-m.bottom+7}"/><text class="tick x-tick" x="${px(v)}" y="${height-m.bottom+29}" text-anchor="middle">${label}</text>`)});
  shown.forEach(c=>{const style=c.literature?{color:c.resolvedColor||'#555',marker:'circle'}:chainStyle(c.chainLength),ds=c.literature?{dash:[]}:datasetStyle(c.datasetId),dash=ds.dash.length?' stroke-dasharray="8 5"':'',valid=c.records.filter(r=>Number.isFinite(Number(r.x??r.distanceA)+Number(r.y??r.gR??r.probabilityDensityPerA))&&(!logX||Number(r.x??r.distanceA)>0)),xy=r=>[Number(r.x??r.distanceA),Number(r.y??r.gR??r.probabilityDensityPerA)],path=valid.map((r,i)=>`${i?'L':'M'} ${px(xy(r)[0]).toFixed(2)} ${py(xy(r)[1]).toFixed(2)}`).join(' ');body.push(`<path class="data-line" data-dataset-style="${c.literature?'literature':ds.stroke}" d="${path}" fill="none" stroke="${style.color}"${dash}/>`);markerIndices(valid.length,markerCount).forEach(i=>{const [x,y]=xy(valid[i]);body.push(`<circle class="data-marker marker-${style.marker}" cx="${px(x)}" cy="${py(y)}" r="${t.markerSize/2}" fill="${style.color}"/>`)});if(errorBars)valid.forEach(r=>{const e=Number(r.uncertainty),[x,y]=xy(r);if(Number.isFinite(e))body.push(`<path class="error-bar" d="M ${px(x)} ${py(y-e)} V ${py(y+e)}" stroke="${style.color}"/>`)})});
  if(geometry.draw){const clips=geometry.items.map((item,index)=>item.clipped?`<clipPath id="legend-label-${index}"><rect x="${item.x+geometry.metrics.swatch+geometry.metrics.textGap}" y="${item.y}" width="${item.maxLabelWidth}" height="${item.height}"/></clipPath>`:'').join('');if(clips)body.push(`<defs>${clips}</defs>`);if(legendMode==='inside')body.push(`<rect class="legend-box" x="${geometry.box.x}" y="${geometry.box.y}" width="${geometry.box.width}" height="${geometry.box.height}" rx="3" fill="white" fill-opacity=".96" stroke="#c9d1cd"/>`);for(const [legendIndex,item] of geometry.items.entries()){if(item.heading){body.push(`<text class="legend-heading" x="${item.x}" y="${item.y+t.legendHeadingPx}">${esc(item.title)}</text>`);continue}const y=item.y+geometry.metrics.rowHeight/2,dash=item.dash?.length?' stroke-dasharray="8 5"':'',color=item.color||t.axisColor;body.push(`<g class="legend-item legend-${item.kind}"><line x1="${item.x}" x2="${item.x+24}" y1="${y}" y2="${y}" stroke="${color}"${dash}/><text class="legend" x="${item.x+geometry.metrics.swatch+geometry.metrics.textGap}" y="${y+t.legendPx*.35}"${item.clipped?` clip-path="url(#legend-label-${legendIndex})"`:''}>${esc(item.label)}</text></g>`)}}
  body.push(`<line class="axis" x1="${m.left}" x2="${m.left}" y1="${m.top}" y2="${height-m.bottom}"/><line class="axis" x1="${m.left}" x2="${width-m.right}" y1="${height-m.bottom}" y2="${height-m.bottom}"/><text class="axis-title" x="${(m.left+width-m.right)/2}" y="${height-20}" text-anchor="middle">${esc(xLabel)}</text><text class="axis-title" transform="translate(25 ${(m.top+height-m.bottom)/2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(description)}"><style>text{font-family:${t.fontFamily};fill:${t.axisColor}}.tick{font-size:${t.tickPx}px}.axis-title{font-size:${t.axisTitlePx}px}.legend{font-size:${t.legendPx}px}.legend-heading{font-size:${t.legendHeadingPx}px;font-weight:bold}.axis,.tick-mark,.minor-tick{stroke:${t.axisColor};stroke-width:${t.axisWidth}}.data-line{stroke-width:${t.lineWidth}}.error-bar{fill:none;stroke-width:${t.errorWidth}}</style>${body.join('')}</svg>`;
}
