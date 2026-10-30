import {calculateFieldDemand,type PlanInput,type WeatherDay} from './core.ts';

export function makeDemoScenario(weather:WeatherDay[],supplyFactor=0.55,closedCanalId:string|null=null):PlanInput{
  if(!Number.isFinite(supplyFactor)||supplyFactor<0||supplyFactor>1.5)throw new Error('Supply factor must be between zero and 1.5.');
  const branches=[{id:'branch-a',node:'gate-a',rate:180,eff:.9},{id:'branch-b',node:'gate-b',rate:120,eff:.8},{id:'branch-c',node:'gate-c',rate:240,eff:.85}];
  if(closedCanalId!==null&&!['main-canal',...branches.map(b=>b.id)].includes(closedCanalId))throw new Error('Unknown scenario canal.');
  const scenario:PlanInput={
    kind:'simulation',inputNote:'Illustrative three-field scenario. Field areas, soil, crop coefficient, priorities, supply, efficiencies and canal topology are assumptions, not measured Samarkand farms. Weather provenance is supplied separately.',rainRetentionFraction:.8,weather,
    fields:branches.map((b,i)=>({id:`demo-field-${String.fromCharCode(97+i)}`,nodeId:b.node,areaHa:[1,1.5,.8][i],kc:1.15,applicationEfficiency:[.7,.65,.8][i],priority:[1,1.4,1][i],soil:{fieldCapacity:.30,wiltingPoint:.15,rootDepthM:.8,depletionFraction:.5,initialDepletionMm:[55,50,45][i],targetDepletionFraction:.2}})),
    network:{sourceId:'intake',nodes:['intake','junction',...branches.map(b=>b.node)],supplyM3:0,sourceMaxFlowM3PerHour:500,windowHours:24,edges:[{id:'main-canal',from:'intake',to:'junction',maxFlowM3PerHour:500,efficiency:.9,closed:closedCanalId==='main-canal'},...branches.map(b=>({id:b.id,from:'junction',to:b.node,maxFlowM3PerHour:b.rate,efficiency:b.eff,closed:closedCanalId===b.id}))]}
  };
  const requestedAtSource=scenario.fields.reduce((sum,f,i)=>sum+calculateFieldDemand(f,weather,scenario.rainRetentionFraction).grossDemandM3/(.9*branches[i].eff),0);
  scenario.network.supplyM3=requestedAtSource*supplyFactor;
  return scenario;
}
