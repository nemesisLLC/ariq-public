/// <reference lib="webworker" />
import {compareScenarios,type SeasonInput} from '../../lib/irrigation/season';
self.onmessage=(event:MessageEvent<{id:number;base:SeasonInput;modified:SeasonInput}>)=>{
  const {id,base,modified}=event.data;
  try {self.postMessage({id,result:compareScenarios(base,modified)});}catch(error){self.postMessage({id,error:error instanceof Error?error.message:'Simulation failed.'});}
};
