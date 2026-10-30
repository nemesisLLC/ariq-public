import {calculateSchedule} from '../../../../lib/irrigation/scheduler';
import {evidence} from '../../../../lib/irrigation/evidence';
import {readJson,json,fail} from '../../../../lib/irrigation/http';
export async function POST(request:Request){
  try{return json({schedule:calculateSchedule(await readJson(request,131072)),evidence,provenance:{inputs:'User-provided scenario; not independently verified.',results:'Simulated model calculations; not observed water conditions, measured supply, or a yield prediction.'}});}catch(error){return fail(error);}
}
