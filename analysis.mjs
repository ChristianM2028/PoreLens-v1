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
