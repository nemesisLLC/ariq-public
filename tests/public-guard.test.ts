import test from 'node:test';
import assert from 'node:assert/strict';
import {publicGuard} from '../cloudflare/public-guard.ts';
const base='https://ariq-private.nezzoval.workers.dev';
test('legacy investigation stays blocked; copilot is guarded by limiter/origin, not hard-blocked',async()=>{
 assert.equal((await publicGuard(new Request(base+'/api/irrigation/investigate'),{}))?.status,503);
 // No limiter configured on a public host fails closed even for copilot.
 assert.equal((await publicGuard(new Request(base+'/api/copilot'),{}))?.status,503);
 // With a limiter, copilot passes the guard; the route itself enforces
 // config + server key + Durable Object budget before any model call.
 const env={API_RATE_LIMITER:{limit:async()=>({success:true})}};
 assert.equal(await publicGuard(new Request(base+'/api/copilot',{headers:{'CF-Connecting-IP':'192.0.2.1'}}),env),null);
 assert.equal((await publicGuard(new Request(base+'/api/copilot',{headers:{origin:'https://other.example'}}),env))?.status,403);
 assert.equal(await publicGuard(new Request(base+'/'),{}),null);
});
test('public API fails closed and rejects cross-site callers',async()=>{
 assert.equal((await publicGuard(new Request(base+'/api/health'),{}))?.status,503);
 assert.equal((await publicGuard(new Request(base+'/api/health',{headers:{origin:'https://other.example'}}),{API_RATE_LIMITER:{limit:async()=>{throw Error('must not run')}}}))?.status,403);
});
test('public API rate limits by Cloudflare supplied IP across routes',async()=>{
 const keys:string[]=[];
 const env={API_RATE_LIMITER:{limit:async({key}:{key:string})=>{keys.push(key);return {success:keys.length<2}}}};
 for(const [i,path]of ['/api/health','/api/farm-evidence'].entries()){
 const result=await publicGuard(new Request(base+path,{headers:{'CF-Connecting-IP':'192.0.2.1'}}),env);
 assert.equal(result?.status,i===0?undefined:429);
 }
 assert.deepEqual(keys,['192.0.2.1','192.0.2.1']);
});
