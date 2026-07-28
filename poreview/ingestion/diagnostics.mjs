export const SEVERITIES = Object.freeze(['info', 'warning', 'error', 'fatal']);

export function diagnostic(severity, code, message, details = {}) {
  if (!SEVERITIES.includes(severity)) throw new TypeError(`Unknown diagnostic severity: ${severity}`);
  return { severity, code, message, ...details };
}

export function hasFatal(diagnostics = []) { return diagnostics.some(item => item.severity === 'fatal'); }
