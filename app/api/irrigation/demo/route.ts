import {district} from '../../../../lib/district';
import {fetchWeather} from '../../../../lib/weather';
import {calculatePlan} from '../../../../lib/irrigation/core';
import {makeDemoScenario} from '../../../../lib/irrigation/scenario';
import {evidence} from '../../../../lib/irrigation/evidence';
import {readJson,json,fail,HttpError} from '../../../../lib/irrigation/http';
export async function POST(request:Request){
  try{
    const data=await readJson(request,4096);
    if(!data||typeof data!=='object'||Array.isArray(data))throw new HttpError(400,'Send scenario options as an object.');
    const options=data as Record<string,unknown>,factor=options.supplyFactor??.55,closed=options.closedCanalId??null;
    if(typeof factor!=='number'||!Number.isFinite(factor)||factor<0||factor>1.5||(closed!==null&&(typeof closed!=='string'||!['main-canal','branch-a','branch-b','branch-c'].includes(closed))))throw new HttpError(400,'Invalid supply factor or scenario canal.');
    let forecast;try{forecast=await fetchWeather(district.center[1],district.center[0]);}catch{throw new HttpError(502,'The forecast source is unavailable. No invented weather has been substituted.');}
    const weather=forecast.daily.time.map((date,i)=>({date,et0Mm:forecast.daily.et0_fao_evapotranspiration[i],rainMm:forecast.daily.rain_sum[i]+forecast.daily.showers_sum[i]}));
    const scenario=makeDemoScenario(weather,factor,closed);
    return json({scenario,plan:calculatePlan(scenario),evidence,provenance:{weather:{kind:'forecast',sourceUrl:forecast.source,retrievedAt:forecast.retrievedAt,timezone:forecast.timezone,requestedPoint:district.center,gridPoint:[forecast.longitude,forecast.latitude],rainfall:'Liquid rain plus showers. Snowfall is excluded; no snowmelt model.'},fields:{kind:'simulation'},canals:{kind:'simulation',note:'Not inferred from the mapped Zarafshon river.'},supply:{kind:'simulation',note:'Supply factor scales the calculated full-demand source volume; it is not an observed reservoir or river volume.'}}});
  }catch(error){return fail(error);}
}
