import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculatePlan,InputError,type PlanInput} from '../lib/irrigation/core.ts';
import {makeDemoScenario} from '../lib/irrigation/scenario.ts';

test('a tiny delivery following a long slot retains a positive feasible interval',()=>{
  const soil={fieldCapacity:.3,wiltingPoint:.1,rootDepthM:.5,depletionFraction:.5,initialDepletionMm:50,targetDepletionFraction:.2};
  const scenario:PlanInput={kind:'simulation',inputNote:'Numerical precision stress fixture, not a real farm.',rainRetentionFraction:1,weather:[{date:'2026-07-01',et0Mm:10,rainMm:0}],fields:[{id:'large',nodeId:'a',areaHa:10000,kc:1,applicationEfficiency:1,priority:1,soil},{id:'tiny',nodeId:'b',areaHa:.001,kc:.000001,applicationEfficiency:1,priority:.1,soil:{...soil,targetDepletionFraction:.5}}],network:{sourceId:'s',nodes:['s','a','b'],supplyM3:1e9,sourceMaxFlowM3PerHour:1e7,windowHours:336,edges:[{id:'slow',from:'s',to:'a',efficiency:1,maxFlowM3PerHour:13000,closed:false},{id:'fast',from:'s',to:'b',efficiency:1,maxFlowM3PerHour:1e7,closed:false}]}};
  const result=calculatePlan(scenario),tiny=result.schedule.find(s=>s.fieldId==='tiny');
  assert.ok(tiny);assert.ok(tiny.endHour>tiny.startHour);
  assert.ok(Math.abs((tiny.endHour-tiny.startHour)*tiny.gateFlowM3PerHour-tiny.gateVolumeM3)<1e-12);
  assert.ok(tiny.gateFlowM3PerHour<=1e7*(1+1e-9));
});
test('demo replay is deterministic, responds to supply changes, and labels synthetic inputs',()=>{
  const weather=Array.from({length:7},(_,i)=>({date:`2026-07-0${i+1}`,et0Mm:5,rainMm:0}));
  const low=makeDemoScenario(weather,.3),high=makeDemoScenario(weather,1);
  const a=calculatePlan(low),b=calculatePlan(high);
  assert.deepEqual(calculatePlan(low),a);assert.equal(a.kind,'simulation');
  assert.match(low.inputNote,/not measured/);assert.ok(b.totals.fieldGateM3>a.totals.fieldGateM3);
  const closed=calculatePlan(makeDemoScenario(weather,1,'branch-b'));
  assert.equal(closed.allocations.find(f=>f.fieldId==='demo-field-b')?.allocatedM3,0);
  assert.ok(closed.allocations.some(f=>f.allocatedM3>0));
  const invalid=structuredClone(low);invalid.network.edges[0].volumeLimitM3=-1;
  assert.throws(()=>calculatePlan(invalid),InputError);
});
test('subnormal flow rates fail validation rather than overflow the allocator',()=>{
  const scenario=makeDemoScenario([{date:'2026-07-01',et0Mm:10,rainMm:0}],1);
  scenario.network.sourceMaxFlowM3PerHour=1e-310;
  assert.throws(()=>calculatePlan(scenario),InputError);
  scenario.network.sourceMaxFlowM3PerHour=500;
  scenario.network.edges[0].maxFlowM3PerHour=1e-310;
  assert.throws(()=>calculatePlan(scenario),InputError);
});
