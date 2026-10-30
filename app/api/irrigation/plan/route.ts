import {calculatePlan} from '../../../../lib/irrigation/core';
import {evidence} from '../../../../lib/irrigation/evidence';
import {readJson,json,fail} from '../../../../lib/irrigation/http';
export async function POST(request:Request){
  try{return json({plan:calculatePlan(await readJson(request)),evidence,provenance:{inputs:'User-provided scenario; not independently verified.',results:'Model calculations; not observed water conditions.'}});}catch(error){return fail(error);}
}
