/** Basic basename filter for RASPA all-component movie trajectories. */
export function isAllComponentsMovieBasename(path=''){
  const basename=String(path).replace(/\\/g,'/').split('/').at(-1);
  return /^Movie.*AllComponents.*\.pdb$/i.test(basename);
}

const NUMBER='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';

/** Parse Movie_<framework>_<a>.<b>.<c>_<temperature K>_<pressure Pa>_AllComponents.pdb. */
export function parseAllComponentsMovieFilename(path=''){
  const basename=String(path).replace(/\\/g,'/').split('/').at(-1);
  if(!isAllComponentsMovieBasename(basename))return {ok:false,code:'not_all_components_movie',basename,message:'Filename does not match the broad RASPA all-components movie pattern.'};
  const match=basename.match(new RegExp(`^Movie_(.+)_(\\d+)\\.(\\d+)\\.(\\d+)_(${NUMBER})_(${NUMBER})_AllComponents\\.pdb$`,'i'));
  if(!match)return {ok:false,code:'malformed_all_components_movie_filename',basename,message:'All-components movie filename does not use canonical Movie_<framework>_<a>.<b>.<c>_<temperature_K>_<pressure_Pa>_AllComponents.pdb metadata.'};
  const unitCells=match.slice(2,5).map(Number),temperatureK=Number(match[5]),pressurePa=Number(match[6]);
  if(!unitCells.every(value=>Number.isSafeInteger(value)&&value>0)||!Number.isFinite(temperatureK)||!Number.isFinite(pressurePa))return {ok:false,code:'malformed_all_components_movie_filename',basename,message:'All-components movie filename contains invalid numeric metadata.'};
  return {ok:true,basename,framework:match[1],unitCells,temperatureK,pressurePa};
}
