import {allocationExample} from '../../../../lib/irrigation/allocation-demo.ts';
import {calculateSchedule,type ScheduleInput} from '../../../../lib/irrigation/scheduler.ts';
import {readJson,json,fail,HttpError} from '../../../../lib/irrigation/http.ts';
export async function POST(request:Request){
 try{
  const body=await readJson(request,65536) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'Provide an object');
  const fraction=body.supplyFraction;
  if(typeof fraction!=='number'||!Number.isFinite(fraction)||fraction<0||fraction>1)throw new HttpError(400,'Supply fraction must be between 0 and 1');
  if(!body.scenario&&!Array.isArray(body.weather))throw new HttpError(400,'Provide forecast weather or an explicit scenario');
  const input=body.scenario?body.scenario as ScheduleInput:allocationExample(body.weather as Parameters<typeof allocationExample>[0]);
  const baseline=calculateSchedule(input);
  const modified=calculateSchedule({...input,network:{...input.network,supplyM3:input.network.supplyM3*fraction}});
  return json({input,baseline,modified,evidenceKind:'simulation',note:'Explicit scenario, not mapped connectivity, live canal supply, or a proof of optimal allocation.'});
 }catch(error){return fail(error);}
}
