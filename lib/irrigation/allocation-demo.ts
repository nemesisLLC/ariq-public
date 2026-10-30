import {makeDemoScenario} from './scenario.ts';
import {calculateSchedule,type ScheduleInput} from './scheduler.ts';
import type {WeatherDay} from './core.ts';
/** Adapt the preserved labelled three-field fixture to the canonical daily v2 engine. */
export function allocationExample(weather:WeatherDay[]):ScheduleInput{
 const original=makeDemoScenario(weather,1);
 return {...original,fields:original.fields,network:{...original.network,windowHoursPerDay:original.network.windowHours}};
}
