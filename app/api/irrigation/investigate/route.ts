import {investigate} from '../../../../lib/irrigation/agent';
import {readJson,json,fail,HttpError} from '../../../../lib/irrigation/http';
export async function POST(request:Request){
  try{
    const body=await readJson(request);
    if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'Send a scenario, language, goal and permitted actions.');
    const input=body as Record<string,unknown>;
    return json(await investigate(input.scenario,input.language,input.allowedActions,input.goal));
  }catch(error){if(process.env.NODE_ENV==='development'&&error instanceof Error)console.error('Local investigation:',error.name,error.message);return fail(error);}
}
