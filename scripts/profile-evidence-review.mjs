import {execFileSync} from 'node:child_process';
import {writeFileSync,unlinkSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const temporary=new URL('../lib/.evidence-baseline.ts',import.meta.url);
const baseline=execFileSync('git',['show','067a8b0:lib/farm-intelligence.ts'],{encoding:'utf8'});
writeFileSync(temporary,baseline);
try {
  const before=await import(temporary.href);
  const after=await import('../lib/farm-intelligence.ts');
  const rows=[];
  for(const [lat,lon] of [[39.65,66.96],[42.46,59.61],[41.3,69.2],[37.2,67.3]]){
    for(const polygon of [undefined,[[lon,lat],[lon+.002,lat],[lon+.002,lat+.002],[lon,lat+.002]]]){
      const options=polygon?{polygon}:undefined;
      assert.deepEqual(after.getFarmEvidence(lat,lon,options),before.getFarmEvidence(lat,lon,options));
      const time=fn=>{const start=performance.now();for(let i=0;i<30;i++)fn(lat,lon,options);return (performance.now()-start)/30;};
      rows.push({lat,lon,polygon:!!polygon,beforeMs:time(before.getFarmEvidence),afterMs:time(after.getFarmEvidence),identical:true});
    }
  }
  writeFileSync('docs/deployment-review/evidence-cpu-local.json',JSON.stringify({note:'Node wall time for synchronous evidence assembly; not deployed CPU. Warm immutable grids. 30 calls per case.',rows},null,2));
  console.log(rows);
}finally{unlinkSync(temporary);}
