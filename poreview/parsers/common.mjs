export function cleanLines(text) {
  return text.split(/\r?\n/).map((raw, index) => ({ raw, line: raw.replace(/\s*(?:#|\/\/|;).*$/, '').trim(), lineNumber: index + 1 })).filter(item => item.line);
}
export const finiteNumber = value => { const number = Number(value); return Number.isFinite(number) ? number : null; };
