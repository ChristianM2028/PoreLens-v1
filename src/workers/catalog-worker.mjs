import {parseSimulationInput} from '../import/parsers/simulation_input.mjs?rev=porelens-20260731-gemc-critical-v1';
self.onmessage=event=>{const {id,text}=event.data;try{self.postMessage({id,value:parseSimulationInput(text)})}catch(error){self.postMessage({id,error:error.message})}};
