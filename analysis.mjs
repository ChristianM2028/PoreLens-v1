export function samplingQuality(records, { absoluteFloor = 0, fractionOfMaximum = 0 } = {}, maximum = null) {
  const weight = records.reduce((sum, row) => sum + row.unnormalizedDistanceHistogram, 0);
  const reasons = [];
  if (weight < absoluteFloor) reasons.push(`histogram weight ${weight} is below absolute floor ${absoluteFloor}`);
  if (maximum !== null && weight < maximum * fractionOfMaximum) reasons.push(`histogram weight is below ${fractionOfMaximum} of this pair's maximum`);
  return { weight, valid: reasons.length === 0, reasons };
}

export function assessSamplingSeries(series, { absoluteFloor = 0, fractionOfMaximum = 0, earlyJumpLog10 = null } = {}) {
  const weights = series.map(records => records.reduce((sum, row) => sum + row.unnormalizedDistanceHistogram, 0));
  const maximum = Math.max(0, ...weights);
  return series.map((records, index) => {
    const result = samplingQuality(records, { absoluteFloor, fractionOfMaximum }, maximum);
    if (earlyJumpLog10 !== null && index < weights.length - 1 && weights[index] > 0 &&
        Math.log10(weights[index + 1]) - Math.log10(weights[index]) >= earlyJumpLog10) {
      result.reasons.push(`next pressure histogram weight jumps by at least ${earlyJumpLog10} log10 units`);
      result.valid = false;
    }
    return result;
  });
}

export function pressureSensitivity(pressuresPa, matrix, window = 3) {
  if (window < 3 || window % 2 !== 1) throw new Error('Pressure window must be an odd integer of at least 3');
  if (pressuresPa.length !== matrix.length || pressuresPa.some(value => !(value > 0))) throw new Error('Positive pressure rows must match the matrix');
  const half = (window - 1) / 2;
  return matrix.map((row, index) => {
    if (index < half || index + half >= matrix.length) return row.map(() => null);
    const xs = pressuresPa.slice(index-half, index+half+1).map(Math.log10), meanX = xs.reduce((a,b)=>a+b,0)/window;
    const denom = xs.reduce((sum,x)=>sum+(x-meanX)**2,0);
    return row.map((_, column) => {
      const ys = matrix.slice(index-half,index+half+1).map(values=>values[column]);
      if (!ys.every(Number.isFinite) || denom === 0) return null;
      const meanY=ys.reduce((a,b)=>a+b,0)/window;
      return xs.reduce((sum,x,j)=>sum+(x-meanX)*(ys[j]-meanY),0)/denom;
    });
  });
}

export function findPeaks(records, minA, maxA, minimumProminence = 0) {
  const rows=records.filter(row=>row.distanceA>=minA&&row.distanceA<=maxA), peaks=[];
  for(let i=1;i<rows.length-1;i++) if(rows[i].gR>rows[i-1].gR&&rows[i].gR>=rows[i+1].gR){
    const base=Math.max(Math.min(...rows.slice(0,i+1).map(r=>r.gR)),Math.min(...rows.slice(i).map(r=>r.gR)));
    const prominence=rows[i].gR-base;
    if(prominence>=minimumProminence) peaks.push({positionA:rows[i].distanceA,height:rows[i].gR,prominence});
  }
  return peaks;
}

export function trackPeak(peakRows, maximumShiftA) {
  let previous=null;
  return peakRows.map(peaks=>{
    if(!peaks.length) return null;
    const candidate=previous===null?[...peaks].sort((a,b)=>b.prominence-a.prominence)[0]:[...peaks].sort((a,b)=>Math.abs(a.positionA-previous)-Math.abs(b.positionA-previous))[0];
    if(previous!==null&&Math.abs(candidate.positionA-previous)>maximumShiftA) return null;
    previous=candidate.positionA; return candidate;
  });
}

export function shellMetrics(records, minA, maxA) {
  const rows = records.filter(row => row.distanceA >= minA && row.distanceA <= maxA);
  let area = 0, moment = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = Math.max(rows[i - 1].gR - 1, 0), b = Math.max(rows[i].gR - 1, 0), width = rows[i].distanceA - rows[i - 1].distanceA;
    const slice = width * (a + b) / 2; area += slice; moment += width * (a * rows[i - 1].distanceA + b * rows[i].distanceA) / 2;
  }
  return { excessArea: area, excessWeightedCentroidA: area > 0 ? moment / area : null };
}

export function coordinationNumber(records, densityPerA3, cutoffA) {
  if (!(densityPerA3 >= 0)) throw new Error('A target number density in Å⁻³ is required');
  const rows = records.filter(row => row.distanceA <= cutoffA); let integral = 0;
  for (let i = 1; i < rows.length; i++) {
    const f0 = rows[i - 1].gR * rows[i - 1].distanceA ** 2, f1 = rows[i].gR * rows[i].distanceA ** 2;
    integral += (rows[i].distanceA - rows[i - 1].distanceA) * (f0 + f1) / 2;
  }
  return 4 * Math.PI * densityPerA3 * integral;
}

/** The pair-specific low-sampling row mask used by rdf_pressure_heatmaps.py. */
export function pairSamplingMask(pressuresPa, rawSums, { jumpThresholdDecades = 1, minimumRawSum = 0, minimumRawFraction = 0 } = {}) {
  const maximum = Math.max(0, ...rawSums.filter(Number.isFinite));
  const valid = rawSums.map(value => Number.isFinite(value) && value >= minimumRawSum && (!minimumRawFraction || value >= minimumRawFraction * maximum));
  let cutoffPa = null, jumpDecades = 0;
  if (jumpThresholdDecades > 0 && pressuresPa.length >= 3) {
    const jumps = rawSums.slice(1).map((value, i) => Math.log10(Math.max(value, 1e-300)) - Math.log10(Math.max(rawSums[i], 1e-300)));
    const qualifying = jumps.slice(0, Math.max(1, Math.floor(pressuresPa.length / 2))).map((jump, i) => jump >= jumpThresholdDecades ? i : -1).filter(i => i >= 0);
    if (qualifying.length) {
      const index = qualifying.at(-1); jumpDecades = jumps[index]; cutoffPa = pressuresPa[index + 1];
      for (let i = 0; i <= index; i++) valid[i] = false;
    }
  }
  return { valid, cutoffPa, jumpDecades };
}

export function percentile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!sorted.length) return null;
  const at=(sorted.length-1)*q/100, lo=Math.floor(at), f=at-lo;
  return sorted[lo] + f*((sorted[lo+1] ?? sorted[lo])-sorted[lo]);
}

export function sameGrid(a, b, tolerance = 1e-10) {
  return a.length === b.length && a.every((value, i) => Math.abs(value-b[i]) <= tolerance);
}

export function buildHeatmap(items, maskOptions = {}) {
  const rows=[...items].sort((a,b)=>a.manifest.pressure_pa-b.manifest.pressure_pa);
  if (!rows.length) throw new Error('No RDF rows are available for this heatmap');
  const distances=rows[0].rdf.records.map(row=>row.distanceA);
  if (rows.some(item=>!sameGrid(distances,item.rdf.records.map(row=>row.distanceA)))) throw new Error('RDF radial grids are incompatible; no silent interpolation was applied.');
  const pressuresPa=rows.map(item=>item.manifest.pressure_pa), rawSums=rows.map(item=>item.rdf.records.reduce((sum,row)=>sum+row.unnormalizedDistanceHistogram,0));
  const mask=pairSamplingMask(pressuresPa,rawSums,maskOptions), values=rows.map(item=>item.rdf.records.map(row=>row.gR));
  const flat=values.flat();
  return { rows, pressuresPa, distances, values, rawSums, ...mask, trueMaximum:Math.max(...flat), colorMaximum:Math.max(1.01,percentile(flat,99)) };
}

export function nearestPressureIndex(pressuresPa, targetPa) {
  if (!pressuresPa.length) return -1;
  return pressuresPa.reduce((best,value,index)=>Math.abs(value-targetPa)<Math.abs(pressuresPa[best]-targetPa)?index:best,0);
}

export function matchNearestPressure(pressuresPa, targetPa) {
  const index=nearestPressureIndex(pressuresPa,targetPa), actualPa=pressuresPa[index];
  return { index, actualPa, differencePa:actualPa-targetPa, exact:actualPa===targetPa };
}

export function highRegions(records, { mode='fraction', threshold=0.5, mapMaximum=null } = {}) {
  const limit=mode==='absolute'?threshold:threshold*(mapMaximum ?? Math.max(...records.map(row=>row.gR)));
  const regions=[]; let start=null;
  records.forEach((row,index)=>{
    if(row.gR>=limit && start===null) start=index;
    if(start!==null && (row.gR<limit || index===records.length-1)) {
      const end=row.gR>=limit&&index===records.length-1?index:index-1, slice=records.slice(start,end+1), peak=slice.reduce((a,b)=>b.gR>a.gR?b:a);
      regions.push({startA:records[start].distanceA,endA:records[end].distanceA,widthA:records[end].distanceA-records[start].distanceA,peakPositionA:peak.distanceA,peakHeight:peak.gR,criterion:{mode,threshold,limit}}); start=null;
    }
  });
  return regions;
}

export function mapAnnotations(heatmap, options) {
  let global={height:-Infinity,positionA:null,pressurePa:null};
  const byPressure=heatmap.rows.map((item,i)=>{
    const records=item.rdf.records, peaks=findPeaks(records,records[0].distanceA,records.at(-1).distanceA,0);
    records.forEach(row=>{if(row.gR>global.height)global={height:row.gR,positionA:row.distanceA,pressurePa:item.manifest.pressure_pa};});
    return {pressurePa:item.manifest.pressure_pa,peaks,regions:highRegions(records,{...options,mapMaximum:heatmap.trueMaximum})};
  });
  const persistence=[];
  byPressure.forEach(row=>row.regions.forEach(region=>{let group=persistence.find(g=>region.startA<=g.endA&&region.endA>=g.startA);if(!group){group={startA:region.startA,endA:region.endA,pressuresPa:[]};persistence.push(group)}group.startA=Math.min(group.startA,region.startA);group.endA=Math.max(group.endA,region.endA);group.pressuresPa.push(row.pressurePa)}));
  return {global,byPressure,persistence:persistence.map(g=>({...g,widthA:g.endA-g.startA,pressureMinPa:Math.min(...g.pressuresPa),pressureMaxPa:Math.max(...g.pressuresPa)}))};
}

export function compareRdfs(aRecords,bRecords) {
  const aGrid=aRecords.map(r=>r.distanceA),bGrid=bRecords.map(r=>r.distanceA);
  if(!sameGrid(aGrid,bGrid)) return {compatible:false,reason:'Radial grids differ; difference is disabled because no alignment method was selected.'};
  const aPeak=aRecords.reduce((x,y)=>y.gR>x.gR?y:x),bPeak=bRecords.reduce((x,y)=>y.gR>x.gR?y:x);
  return {compatible:true,difference:bRecords.map((row,i)=>({distanceA:row.distanceA,gR:row.gR-aRecords[i].gR})),peakHeightDifference:bPeak.gR-aPeak.gR,peakPositionDifferenceA:bPeak.distanceA-aPeak.distanceA};
}
