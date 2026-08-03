import { VTKRecord } from '../models.mjs?rev=draggable-chain-legend-v1';
export const VTK_HEADER_BYTES = 8192;
export function indexVtk(path, header = '', context = {}) {
  const name = path.split(/[\\/]/).at(-1), number = [...name.matchAll(/(\d+)/g)].at(-1)?.[1];
  const fields = [...header.matchAll(/^\s*(?:SCALARS|VECTORS)\s+(\S+)/gim)].map(m => m[1]);
  const format = /<VTKFile\b/i.test(header) ? 'xml' : /# vtk DataFile/i.test(header) ? 'legacy' : null;
  const encoding = format === 'xml' ? 'xml' : /^\s*BINARY\s*$/im.test(header) ? 'binary' : /^\s*ASCII\s*$/im.test(header) ? 'ascii' : null;
  const datasetType = format === 'legacy' ? header.match(/^\s*DATASET\s+(STRUCTURED_POINTS|IMAGE_DATA|POLYDATA)\b/im)?.[1].toUpperCase() ?? header.match(/^\s*DATASET\s+(\S+)/im)?.[1].toUpperCase() ?? null : null;
  const supportedScalarGrid = format === 'legacy' && encoding === 'ascii' && ['STRUCTURED_POINTS', 'IMAGE_DATA'].includes(datasetType) && fields.length > 0;
  const contextualGeometry = format === 'legacy' && encoding === 'ascii' && datasetType === 'POLYDATA';
  const componentName = context.componentNames?.find(value => name.toLowerCase().includes(value.toLowerCase())) ?? null;
  return new VTKRecord({ path, frame: number ? Number(number) : null, cycle: number ? Number(number) : null, componentName, content: /framework/i.test(name) ? 'framework' : componentName ? 'adsorbate' : 'unknown', fields, format, encoding, datasetType, supportedScalarGrid, contextualGeometry, parseable: supportedScalarGrid });
}

/** Read only enough bytes to classify a VTK record during discovery. */
export async function readVtkHeaderPrefix(file, limit = VTK_HEADER_BYTES) {
  const source = file?.handle ? await file.handle.getFile() : file;
  if (!source) return '';
  if (typeof source.slice === 'function') return source.slice(0, limit).text();
  const text = typeof source.text === 'function' ? await source.text() : String(source.text ?? '');
  return text.slice(0, limit);
}
