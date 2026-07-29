/** Shared, publication-oriented visual language for every PoreLens plot. */
export const PLOT_THEME = Object.freeze({
  fontFamily: 'Arial, Helvetica, sans-serif', axisTitlePx: 17, tickPx: 14,
  legendPx: 14, axisColor: '#26332e', gridColor: '#e1e5e3', axisWidth: 1.4,
  lineWidth: 2, markerSize: 6, errorWidth: 1.1, errorCap: 4,
  background: '#ffffff', margins: Object.freeze({ left: 112, right: 30, top: 66, bottom: 82 })
});

// Okabe-Ito-derived mapping extended with high-contrast tones. It is stable by chain length.
const COLORS = ['#0072B2','#E69F00','#009E73','#D55E00','#CC79A7','#56B4E9','#7A5C00','#882255','#332288'];
const MARKERS = ['circle','square','triangle','diamond','cross','down','plus','hexagon','star'];
export function chainStyle(chainLength) {
  const n = Math.max(2, Number(chainLength) || 2), i = (n - 2) % COLORS.length;
  return Object.freeze({ color: COLORS[i], marker: MARKERS[i] });
}
export function conciseCurveLabel(curve, multipleDatasets = false) {
  const chain = String(curve.component || `C${curve.chainLength || ''}`).replace(/^C(\d+)$/,(_,n)=>`C${'₀₁₂₃₄₅₆₇₈₉'[n] || [...n].map(x=>'₀₁₂₃₄₅₆₇₈₉'[x]).join('')}`);
  if (!multipleDatasets) return chain;
  const family = String(curve.family || curve.datasetId || '').replace(/^[AB]:\s*/, '').split(/[·/]/)[0].trim();
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
export function buildLineSvg(curves,{width=1200,height=800,xLabel='Distance, r (Å)',yLabel='g(r)',logX=false,errorBars=true,markerCount=10}={}) {
  const t=PLOT_THEME,m=t.margins, shown=curves.filter(c=>c.visible!==false), rows=shown.flatMap(c=>c.records.map(r=>({x:Number(r.x??r.distanceA),y:Number(r.y??r.gR??r.probabilityDensityPerA)}))).filter(p=>p.x>=(logX?Number.MIN_VALUE:-Infinity)&&Number.isFinite(p.x+p.y));
  if(!rows.length)return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`;
  let xmin=Math.min(...rows.map(p=>p.x)),xmax=Math.max(...rows.map(p=>p.x)),ymin=Math.min(0,...rows.map(p=>p.y)),ymax=Math.max(...rows.map(p=>p.y)); if(logX){xmin=Math.log10(xmin);xmax=Math.log10(xmax)}
  const px=x=>m.left+((logX?Math.log10(x):x)-xmin)/(xmax-xmin||1)*(width-m.left-m.right),py=y=>height-m.bottom-(y-ymin)/(ymax-ymin||1)*(height-m.top-m.bottom),yt=linearTicks(ymin,ymax),ystep=yt[1]-yt[0]||1;
  const logScale=logX?logTicks(10**xmin,10**xmax):null,xt=logX?logScale.major:linearTicks(xmin,xmax);
  const familyCount=new Set(shown.map(c=>c.family||c.datasetId)).size>1;
  const body=[`<rect width="100%" height="100%" fill="${t.background}"/>`];
  yt.forEach(v=>body.push(`<line class="major-grid" x1="${m.left}" x2="${width-m.right}" y1="${py(v)}" y2="${py(v)}" stroke="${t.gridColor}"/><text class="tick y-tick" x="${m.left-12}" y="${py(v)+5}" text-anchor="end">${formatTick(v,ystep)}</text>`));
  if(logScale)logScale.minor.forEach(v=>body.push(`<line class="minor-tick" x1="${px(v)}" x2="${px(v)}" y1="${height-m.bottom}" y2="${height-m.bottom+4}"/>`));
  xt.forEach(item=>{const v=logX?item.value:item,label=logX?item.label:formatTick(item);body.push(`<line class="tick-mark" x1="${px(v)}" x2="${px(v)}" y1="${height-m.bottom}" y2="${height-m.bottom+7}"/><text class="tick x-tick" x="${px(v)}" y="${height-m.bottom+29}" text-anchor="middle">${label}</text>`)});
  shown.forEach((c,index)=>{const style=chainStyle(c.chainLength),valid=c.records.filter(r=>Number.isFinite(Number(r.x??r.distanceA)+Number(r.y??r.gR??r.probabilityDensityPerA))&&(!logX||Number(r.x??r.distanceA)>0)),xy=r=>[Number(r.x??r.distanceA),Number(r.y??r.gR??r.probabilityDensityPerA)],path=valid.map((r,i)=>`${i?'L':'M'} ${px(xy(r)[0]).toFixed(2)} ${py(xy(r)[1]).toFixed(2)}`).join(' ');body.push(`<path class="data-line" d="${path}" fill="none" stroke="${style.color}"/>`);markerIndices(valid.length,markerCount).forEach(i=>{const [x,y]=xy(valid[i]);body.push(`<circle class="data-marker marker-${style.marker}" cx="${px(x)}" cy="${py(y)}" r="${t.markerSize/2}" fill="${style.color}"/>`)});if(errorBars)valid.forEach(r=>{const e=Number(r.uncertainty),[x,y]=xy(r);if(Number.isFinite(e))body.push(`<path class="error-bar" d="M ${px(x)} ${py(y-e)} V ${py(y+e)} M ${px(x)-t.errorCap} ${py(y-e)} H ${px(x)+t.errorCap} M ${px(x)-t.errorCap} ${py(y+e)} H ${px(x)+t.errorCap}" stroke="${style.color}"/>`)});const lx=m.left+index*100;body.push(`<line x1="${lx}" x2="${lx+24}" y1="28" y2="28" stroke="${style.color}" class="data-line"/><text class="legend" x="${lx+31}" y="33">${esc(conciseCurveLabel(c,familyCount))}</text>`)});
  body.push(`<line class="axis" x1="${m.left}" x2="${m.left}" y1="${m.top}" y2="${height-m.bottom}"/><line class="axis" x1="${m.left}" x2="${width-m.right}" y1="${height-m.bottom}" y2="${height-m.bottom}"/><text class="axis-title" x="${(m.left+width-m.right)/2}" y="${height-20}" text-anchor="middle">${esc(xLabel)}</text><text class="axis-title" transform="translate(25 ${(m.top+height-m.bottom)/2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>text{font-family:${t.fontFamily};fill:${t.axisColor};font-weight:400}.tick{font-size:${t.tickPx}px}.axis-title{font-size:${t.axisTitlePx}px}.legend{font-size:${t.legendPx}px}.axis,.tick-mark,.minor-tick{stroke:${t.axisColor};stroke-width:${t.axisWidth}}.minor-tick{stroke-width:1}.data-line{stroke-width:${t.lineWidth}}.error-bar{fill:none;stroke-width:${t.errorWidth}}</style>${body.join('')}</svg>`;
}
