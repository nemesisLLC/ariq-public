import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readJson,HttpError} from '../lib/irrigation/http.ts';
import {CallBudget,validateExplanation,validateLanguage} from '../lib/irrigation/explanation.ts';
import {fetchWeather} from '../lib/weather.ts';

const request=(body:string,headers:Record<string,string>={})=>new Request('http://127.0.0.1:3000/api/irrigation/plan',{method:'POST',body,headers:{'Content-Type':'application/json',...headers}});

test('private deployment accepts its exact HTTPS origin while rejecting other hosts and cross-site requests',async()=>{
  const origin='https://ariq-private.nezzoval.workers.dev';
  const remote=(host:string,source=host)=>new Request(host+'/api/irrigation/plan',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:source},body:'{"ok":true}',
  });
  assert.deepEqual(await readJson(remote(origin)),{ok:true});
  for(const host of ['https://another.nezzoval.workers.dev','http://ariq-private.nezzoval.workers.dev','https://ariq-private.nezzoval.workers.dev:8443'])
    await assert.rejects(readJson(remote(host)),(e:unknown)=>e instanceof HttpError&&e.status===403);
  await assert.rejects(readJson(remote(origin,'https://untrusted.example')),(e:unknown)=>e instanceof HttpError&&e.status===403);
});
test('local JSON API rejects cross-site and oversized requests before calculation',async()=>{
  await assert.rejects(readJson(request('{}',{Origin:'https://untrusted.example'})),(e:unknown)=>e instanceof HttpError&&e.status===403);
  await assert.rejects(readJson(request('{}',{'Sec-Fetch-Site':'cross-site'})),(e:unknown)=>e instanceof HttpError&&e.status===403);
  await assert.rejects(readJson(request(' '.repeat(66000))),(e:unknown)=>e instanceof HttpError&&e.status===413);
  await assert.rejects(readJson(request('{')),(e:unknown)=>e instanceof HttpError&&e.status===400);
  assert.deepEqual(await readJson(request('{"kind":"simulation"}')),{kind:'simulation'});
});
test('local JSON API accepts loopback-alias origins but not other ports',async()=>{
  // Browser visited 127.0.0.1 while the server reports localhost (and vice versa).
  assert.deepEqual(await readJson(request('{"ok":true}',{Origin:'http://localhost:3000'})),{ok:true});
  await assert.rejects(readJson(request('{}',{Origin:'http://localhost:9999'})),(e:unknown)=>e instanceof HttpError&&e.status===403);
  await assert.rejects(readJson(request('{}',{Origin:'https://localhost:3000'})),(e:unknown)=>e instanceof HttpError&&e.status===403);
});
test('AI allowance counts failed attempts and stops concurrent or excess calls',()=>{
  const budget=new CallBudget(2);budget.acquire(0);
  assert.throws(()=>budget.acquire(2000),HttpError);
  budget.release();assert.throws(()=>budget.acquire(1000),HttpError);
  budget.acquire(2000);budget.release();assert.equal(budget.used,2);
  assert.throws(()=>budget.acquire(4000),HttpError);
});
test('translated prose cannot introduce numeric claims, new fields, or wrong languages',()=>{
  const output={language:'uz',title:'Suv taqsimoti',summary:'Bu hisoblangan ssenariy.',fieldNotes:[{fieldId:'a',explanation:'Talab qisman qondirildi.'}],caveats:['Bu dala kuzatuvi emas.']};
  assert.equal(validateExplanation(output,'uz',['a']).language,'uz');
  assert.throws(()=>validateExplanation({...output,summary:'Saves 80 percent water'},'uz',['a']),HttpError);
  assert.throws(()=>validateExplanation(output,'ru',['a']),HttpError);
  assert.throws(()=>validateExplanation(output,'uz',['b']),HttpError);
  assert.throws(()=>validateLanguage('de'),HttpError);
});
function provider(){
  return {latitude:39.68,longitude:67,timezone:'Asia/Samarkand',daily_units:{rain_sum:'mm',showers_sum:'mm',et0_fao_evapotranspiration:'mm'},daily:{time:Array.from({length:7},(_,i)=>`2026-07-0${i+1}`),temperature_2m_max:Array(7).fill(30),temperature_2m_min:Array(7).fill(15),precipitation_sum:Array(7).fill(10),rain_sum:Array(7).fill(1),showers_sum:Array(7).fill(2),et0_fao_evapotranspiration:Array(7).fill(4)}};
}
test('forecast preserves provenance and liquid rainfall separately from total precipitation',async()=>{
  const data=provider();let requested='';
  const forecast=await fetchWeather(39.6542,66.9597,(async(url:unknown)=>{requested=String(url);return Response.json(data);}) as typeof fetch);
  assert.equal(forecast.daily.rain_sum[0]+forecast.daily.showers_sum[0],3);
  assert.equal(forecast.daily.precipitation_sum[0],10);
  assert.equal(forecast.latitude,39.68);assert.match(forecast.source,/latitude=39.6542/);
  assert.match(requested,/rain_sum/);assert.ok(Number.isFinite(Date.parse(forecast.retrievedAt)));
});
test('missing forecast values or unexpected units cannot silently become zero rain',async()=>{
  const data=provider();(data.daily.rain_sum as unknown[])[0]=null;
  await assert.rejects(fetchWeather(39,67,(async()=>Response.json(data)) as typeof fetch));
  const wrongUnit=provider();wrongUnit.daily_units.rain_sum='inch';
  await assert.rejects(fetchWeather(39,67,(async()=>Response.json(wrongUnit)) as typeof fetch));
  let called=false;await assert.rejects(fetchWeather(999,67,(async()=>{called=true;return Response.json({});}) as typeof fetch));assert.equal(called,false);
});
