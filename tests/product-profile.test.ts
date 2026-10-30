import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFarmProfile} from '../lib/farm-profile.ts';
import {ForecastCache} from '../lib/irrigation/recommendation.ts';
import {POST} from '../app/api/farm-evidence/route.ts';
import {POST as allocation} from '../app/api/irrigation/allocation/route.ts';
import {parseFarm,passportData} from '../app/atlas/workspace.ts';
import {simulateSeason} from '../lib/irrigation/season.ts';
import {DEMO_SCENARIOS} from '../lib/irrigation/season-demos.ts';
const polygon:[number,number][]=[[66.80,39.55],[66.81,39.55],[66.81,39.56],[66.80,39.56]];
const base={latitude:39.555,longitude:66.805,polygon,cropId:'cotton',plantingDate:'2026-07-01'};
const down=(async()=>{throw Error('offline');}) as typeof fetch;
const provider={latitude:39.55,longitude:66.8,timezone:'Asia/Samarkand',daily_units:{rain_sum:'mm',showers_sum:'mm',et0_fao_evapotranspiration:'mm'},daily:{temperature_2m_max:Array(7).fill(34),temperature_2m_min:Array(7).fill(20),precipitation_sum:Array(7).fill(0),time:Array.from({length:7},(_,i)=>`2026-07-0${i+1}`),rain_sum:Array(7).fill(0),showers_sum:Array(7).fill(0),et0_fao_evapotranspiration:Array(7).fill(6)}};
const options=()=>({fetcher:(async()=>Response.json(provider)) as typeof fetch,soilMoistureFetcher:down,cache:new ForecastCache()});
test('advanced profile retains supplied retention provenance and leaves mapped evidence unchanged',async()=>{
 const input={...base,retentionOverride:{fieldCapacity:.32,wiltingPoint:.12,kind:'user-supplied-measurement' as const,source:'Test laboratory, 2026-06-30'},initialDepletionMm:40,applicationEfficiency:.7};
 const profile=await buildFarmProfile(input,options());assert.deepEqual(profile.suppliedInputs,input);assert.equal(profile.autoSoilForIrrigation?.fieldCapacity,.32);assert.match(profile.autoSoilForIrrigation!.chain,/Test laboratory/);assert.equal(profile.evidence.soil?.kind,'modeled-estimate');assert.equal(profile.evidence.groundwater.depthToWaterM,null);assert.ok(profile.irrigation?.outlook);
 await assert.rejects(()=>buildFarmProfile({...input,retentionOverride:{...input.retentionOverride,wiltingPoint:.4}},options()),/wiltingPoint/);
 await assert.rejects(()=>buildFarmProfile({...input,retentionOverride:{...input.retentionOverride,source:''}},options()),/source/);
});
test('private profile POST rejects remote origins, malformed JSON and invalid profile input',async()=>{
 const make=(url:string,body:string,origin?:string)=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{origin}:{})},body});
 assert.equal((await POST(make('https://untrusted.example/api/farm-evidence','{}'))).status,403);
 assert.equal((await POST(make('http://localhost/api/farm-evidence','{}','https://foreign.example'))).status,403);
 assert.equal((await POST(make('http://localhost/api/farm-evidence','not-json'))).status,400);
 assert.equal((await POST(make('http://localhost/api/farm-evidence',JSON.stringify({...base,cropId:'invented'})))).status,400);
});
test('field migration preserves geometry, crop, planting and optional seed; export retains profile',()=>{
 const old={version:1,name:'Test field',boundary:polygon,cropId:'cotton',plantingDate:'2026-04-15'};
 const migrated=parseFarm(old);assert.equal(migrated.version,2);assert.deepEqual(migrated.boundary,polygon);
 const withSeed=parseFarm({...migrated,seedQuantityKg:20});assert.equal(withSeed.seedQuantityKg,20);assert.equal(parseFarm({farm:withSeed}).seedQuantityKg,20);
 assert.throws(()=>parseFarm({...withSeed,seedQuantityKg:-1}));
 assert.equal(passportData(withSeed,{}).farm.seedQuantityKg,20);
});
test('v2 allocation reconciles the preserved fixture under explicit reduced supply',async()=>{
 const weather=provider.daily.time.map(date=>({date,et0Mm:6,rainMm:0}));
 const response=await allocation(new Request('http://localhost/api/irrigation/allocation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({weather,supplyFraction:.2})}));
 assert.equal(response.status,200);const r=await response.json();assert.equal(r.modified.version,'ariq-irrigation-v2');assert.equal(r.input.fields.length,3);assert.ok(r.modified.totals.unmetGateM3>=r.baseline.totals.unmetGateM3);assert.ok(r.modified.totals.sourceUsedM3<=r.input.network.supplyM3*.2+1e-6);assert.ok(r.modified.events.every((e:{feasibilityProven:boolean})=>e.feasibilityProven===false));
});
test('season exposes canonical capacity and preserves modeled soil provenance',()=>{
 const result=simulateSeason({...DEMO_SCENARIOS[0].baseline,soilKind:'modeled-estimate'});assert.equal(result.soilKind,'modeled-estimate');assert.ok(result.rootZone.totalAvailableMm>result.rootZone.readilyAvailableMm);assert.ok(Math.abs(result.rootZone.totalAvailableMm-120)<1e-9);
});

test('allocation rejects null and out-of-range supply without running a model',async()=>{
 for(const body of [null,{supplyFraction:-1},{supplyFraction:1.1}]){
 const r=await allocation(new Request('http://localhost/api/irrigation/allocation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));assert.equal(r.status,400);
 }
});
