export function samplingQuality(records, { absoluteFloor = 0, fractionOfMaximum = 0 } = {}, maximum = null) {
  const weight = records.reduce((sum, row) => sum + row.unnormalizedDistanceHistogram, 0);
  const reasons = [];
  if (weight < absoluteFloor) reasons.push(`histogram weight ${weight} is below absolute floor ${absoluteFloor}`);
  if (maximum !== null && weight < maximum * fractionOfMaximum) reasons.push(`histogram weight is below ${fractionOfMaximum} of this pair's maximum`);
  return { weight, valid: reasons.length === 0, reasons };
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
