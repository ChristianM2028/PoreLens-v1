export const APP_MODES = Object.freeze({ EMPTY: 'empty', SYNTHETIC: 'synthetic', FILES_SELECTED: 'files-selected' });

export function summarizeSelectedFiles(files) {
  const list = Array.from(files ?? []);
  const types = new Map();
  for (const file of list) {
    const name = typeof file.name === 'string' ? file.name : '';
    const dot = name.lastIndexOf('.');
    const extension = dot >= 0 ? name.slice(dot + 1).toUpperCase() : 'UNKNOWN';
    types.set(extension, (types.get(extension) ?? 0) + 1);
  }
  return { count: list.length, typeSummary: [...types].map(([ext, count]) => `${count} ${ext}`).join(' · ') };
}

export function viewForMode(mode, summary = { count: 0, typeSummary: '' }) {
  if (mode === APP_MODES.SYNTHETIC) return {
    workspaceHidden: false,
    badge: 'Synthetic demonstration',
    status: 'Synthetic demo active · illustrative curves only · not calculated from RASPA data',
  };
  if (mode === APP_MODES.FILES_SELECTED) return {
    workspaceHidden: true,
    badge: 'No analysis loaded',
    status: `${summary.count} local file${summary.count === 1 ? '' : 's'} selected${summary.typeSummary ? ` · ${summary.typeSummary}` : ''}. Parsing is not implemented yet; no scientific values are shown.`,
  };
  return { workspaceHidden: true, badge: 'No analysis loaded', status: 'Select local files to begin. No dataset has been parsed.' };
}
