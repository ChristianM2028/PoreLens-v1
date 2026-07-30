/** Collapse repeated import messages without discarding their severity, details, or count. */
export function groupDiagnostics(diagnostics = []) {
  const groups = new Map();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.severity}\0${diagnostic.message}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { ...diagnostic, count: 1 });
  }
  return [...groups.values()];
}
