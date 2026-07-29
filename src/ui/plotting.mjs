/** Pure display geometry. Scientific metrics and exports must use the source records. */
export function prepareRawLine(records) {
  const indexed = records.map((row, sourceIndex) => ({ ...row, sourceIndex }));
  indexed.sort((a, b) => Number(a.distanceA) - Number(b.distanceA) || a.sourceIndex - b.sourceIndex);
  let previous = null;
  return indexed.map(row => {
    const distanceA = Number(row.distanceA), gR = Number(row.gR);
    const valid = Number.isFinite(distanceA) && Number.isFinite(gR) && distanceA !== previous;
    if (Number.isFinite(distanceA)) previous = distanceA;
    return { distanceA, gR, sourceIndex: row.sourceIndex, valid };
  });
}

export function smoothDisplay(line, window = 5) {
  const bounded = Math.max(3, Math.min(31, Math.trunc(window) | 1));
  const half = (bounded - 1) / 2;
  return line.map((point, index) => {
    if (!point.valid) return { ...point };
    const segment = [];
    for (let i = index - half; i <= index + half; i++) {
      if (i < 0 || i >= line.length || !line[i].valid) return { ...point };
      segment.push(line[i].gR);
    }
    return { ...point, gR: segment.reduce((a, b) => a + b, 0) / segment.length };
  });
}

export function decimateMarkers(line, maximum = 48) {
  const valid = line.filter(point => point.valid);
  const stride = Math.max(1, Math.ceil(valid.length / maximum));
  return valid.filter((_, index) => index % stride === 0 || index === valid.length - 1);
}

export function lineCommands(line, xScale, yScale) {
  let connected = false;
  return line.map(point => {
    if (!point.valid) { connected = false; return { command: 'gap' }; }
    const x = xScale(point.distanceA), y = yScale(point.gR);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { connected = false; return { command: 'gap' }; }
    const command = connected ? 'lineTo' : 'moveTo'; connected = true;
    return { command, x, y, sourceIndex: point.sourceIndex };
  });
}

export function formatNumber(value, digits = 5) {
  if (!Number.isFinite(value)) return 'not available';
  return Number(value.toPrecision(digits)).toString();
}

export function peakTrace(annotations) {
  return annotations.byPressure.map(row => {
    const peak = row.peaks.reduce((best, item) => !best || item.height > best.height ? item : best, null);
    return peak ? { pressurePa: row.pressurePa, distanceA: peak.positionA } : null;
  });
}
