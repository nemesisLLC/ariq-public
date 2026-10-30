import {ForecastUnavailableError, recommend} from '../../../../lib/irrigation/recommendation.ts';
import {readJson,json,fail} from '../../../../lib/irrigation/http.ts';
export async function POST(request:Request){
  try{return json(await recommend(await readJson(request,16384)));}
  catch(error){
    if(error instanceof ForecastUnavailableError)return json({error:error.message,kind:'forecast-unavailable',missingInputs:[{field:'weather-forecast',effect:'No demand, stress, deadline, or schedule can be calculated without forecast weather. Retry when the forecast source is reachable.'}]},502);
    return fail(error);
  }
}
