import {calculatePlan} from '../../../../lib/irrigation/core';
import {explainPlan,validateLanguage} from '../../../../lib/irrigation/explanation';
import {readJson,json,fail,HttpError} from '../../../../lib/irrigation/http';
export async function POST(request:Request){
  try{
    const body=await readJson(request);
    if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'Send a scenario and language.');
    const input=body as Record<string,unknown>,language=validateLanguage(input.language);
    const plan=calculatePlan(input.scenario);
    return json({plan,...await explainPlan(plan,language)});
  }catch(error){return fail(error);}
}
