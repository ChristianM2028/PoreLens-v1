/** Basic basename filter for RASPA all-component movie trajectories. */
export function isAllComponentsMovieBasename(path=''){
  const basename=String(path).replace(/\\/g,'/').split('/').at(-1);
  return /^Movie.*AllComponents.*\.pdb$/i.test(basename);
}
