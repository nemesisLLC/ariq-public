import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyIntervention,investigate,permittedActions} from '../lib/irrigation/agent.ts';
import {makeDemoScenario} from '../lib/irrigation/scenario.ts';
import {CallBudget} from '../lib/irrigation/explanation.ts';
import {HttpError} from '../lib/irrigation/http.ts';
const scenario=()=>makeDemoScenario(Array.from({length:7},(_,i)=>({date:`2026-07-0${i+1}`,et0Mm:5,rainMm:0})),.35);
const proposal=(action='increase_supply_25pct',canalId='')=>({action,canalId,reason:'The configured supply limits delivery.'});
const response=(args:unknown)=>Response.json({status:'completed',output:[{type:'function_call',name:'simulate_intervention',arguments:JSON.stringify(args)}],usage:{input_tokens:100,output_tokens:80}});
test('a permitted counterfactual changes a copy and reports computed differences',async()=>{
  const input=scenario(),original=structuredClone(input);let calls=0,sent='';
  const run=await investigate(input,'en',['increase_supply_25pct'],'reduce_unmet_demand',{enabled:true,apiKey:'unit-test-placeholder',budget:new CallBudget(1),fetcher:(async(_url:unknown,init?:RequestInit)=>{calls++;sent=String(init?.body);return response(proposal());}) as typeof fetch});
  assert.equal(calls,1);assert.deepEqual(input,original);
  assert.equal(run.scenario.network.supplyM3,input.network.supplyM3*1.25);
  assert.ok(run.comparison.fieldGateDeltaM3>0);assert.equal(run.trace.length,4);
  assert.match(sent,/simulate_intervention/);assert.equal(run.remainingLocalCalls,0);
});
test('the agent cannot apply a nonpermitted change or invent a canal',()=>{
  const input=scenario();
  assert.throws(()=>applyIntervention(input,{action:'increase_supply_25pct',canalId:'',reason:'Test'},['no_change']),HttpError);
  assert.throws(()=>applyIntervention(input,{action:'restore_closed_canal',canalId:'invented',reason:'Test'},['restore_closed_canal']),HttpError);
  assert.throws(()=>permittedActions(['increase_supply_25pct','increase_supply_25pct']),HttpError);
});
test('closed-route recovery is recalculated, never asserted from the model rationale',()=>{
  const input=scenario();input.network.edges.find(e=>e.id==='branch-b')!.closed=true;
  const run=applyIntervention(input,{action:'restore_closed_canal',canalId:'branch-b',reason:'Test'},['restore_closed_canal']);
  assert.equal(run.baseline.allocations.find(f=>f.fieldId==='demo-field-b')!.allocatedM3,0);
  assert.ok(run.candidate.allocations.find(f=>f.fieldId==='demo-field-b')!.allocatedM3>0);
  assert.equal(input.network.edges.find(e=>e.id==='branch-b')!.closed,true);
});
test('free-text assumptions and unknown properties are not sent to Meta',async()=>{
  const input={...scenario(),inputNote:'PRIVATE-CANARY-ASSUMPTION',unrelatedPrivateValue:'PRIVATE-CANARY-EXTRA'};
  await investigate(input,'en',['no_change'],'reduce_unmet_demand',{enabled:true,apiKey:'unit-test-placeholder',budget:new CallBudget(1),fetcher:(async(_url:unknown,init?:RequestInit)=>{assert.ok(!String(init?.body).includes('PRIVATE-CANARY'));return response(proposal('no_change'));}) as typeof fetch});
});
test('disabled AI makes no provider call; invalid or multiple tool calls are rejected',async()=>{
  let called=false;
  await assert.rejects(investigate(scenario(),'en',['no_change'],'reduce_unmet_demand',{enabled:false,fetcher:(async()=>{called=true;return response(proposal());}) as typeof fetch}),HttpError);
  assert.equal(called,false);
  await assert.rejects(investigate(scenario(),'en',['no_change'],'reduce_unmet_demand',{enabled:true,apiKey:'unit-test-placeholder',budget:new CallBudget(1),fetcher:(async()=>Response.json({status:'completed',output:[{type:'function_call',name:'simulate_intervention',arguments:'{}'},{type:'function_call',name:'simulate_intervention',arguments:'{}'}]})) as typeof fetch}),HttpError);
});
