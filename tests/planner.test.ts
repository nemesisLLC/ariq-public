import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allocate} from '../lib/planner.ts';
test('never exceeds supply or field need across shortage levels',()=>{const fields=[{id:1,need:100,priority:3},{id:2,need:200,priority:1}];for(let s=0;s<=400;s++){const a=allocate(fields,s);assert.ok(a[1]+a[2]<=s);assert.ok(a[1]<=100&&a[2]<=200);assert.ok(a[1]>=0&&a[2]>=0);}});
test('redistributes capped allocation and rejects invalid inputs',()=>{assert.deepEqual(allocate([{id:1,need:10,priority:3},{id:2,need:90,priority:1}],100),{1:10,2:90});assert.throws(()=>allocate([],-1));assert.throws(()=>allocate([{id:1,need:20,priority:0}],10));});
