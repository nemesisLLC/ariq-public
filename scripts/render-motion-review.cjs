const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path');
const install=require('./render-probe.cjs');
const base=process.env.ARIQ_REVIEW_URL||'https://ariq-private.nezzoval.workers.dev';
const prefix=process.env.REVIEW_PREFIX||'baseline';
const out=path.resolve('docs/render-performance');fs.mkdirSync(out,{recursive:true});
const summarize=values=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y);return {count:a.length,mean:a.reduce((x,y)=>x+y,0)/a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)]};};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl-draft-extensions','--enable-precise-memory-info']});
 const results=[];
 try{
  for(const mobile of [false,true]){
   if(process.env.ONLY_DESKTOP&&mobile)continue;
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},deviceScaleFactor:mobile?3:1,isMobile:mobile,hasTouch:mobile});
   if(base.startsWith('https://ariq-private.nezzoval.workers.dev')){const token=JSON.parse(fs.readFileSync('.env.access-test.json'));await context.route('https://ariq-private.nezzoval.workers.dev/**',r=>r.continue({headers:{...r.request().headers(),'CF-Access-Client-Id':token.client_id,'CF-Access-Client-Secret':token.client_secret}}));}
   await context.addInitScript(install);await context.addInitScript(()=>sessionStorage.setItem('ariq-entered','1'));
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const cdp=await context.newCDPSession(page);if(mobile)await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
   await page.goto(base);await page.waitForFunction(()=>window.__ariqRenderProbe?.discover(),null,{timeout:90000});
   console.log('Renderer found',mobile?'mobile':'desktop');
   const device=await page.evaluate(()=>window.__ariqRenderProbe.attach());console.log(device);
   await page.waitForTimeout(3000);
   for(const variant of (process.env.REPEATS?Array(Math.min(5,Number(process.env.REPEATS))).fill('baseline'):(process.env.ABLATION?'baseline,cached-shadow':'baseline').split(','))){
    await cdp.send('HeapProfiler.collectGarbage');const memoryBefore=await cdp.send('Runtime.getHeapUsage');
    const raw=await page.evaluate(async args=>window.__ariqRenderProbe.motion(args),{duration:12000,variant,pointer:process.env.POINTER==='1',steps:180});
    const memoryAfter=await cdp.send('Runtime.getHeapUsage');
    const intervals=raw.frames.slice(1).map((f,i)=>f.at-raw.frames[i].at);
    const row={base,mobile,variant,device,errors,motion:process.env.POINTER==='1'?'181 identical camera poses and pointer positions':'12-second analytic camera path',fps:1000/(intervals.reduce((a,b)=>a+b,0)/intervals.length),frameMs:summarize(intervals),pointerCpuMs:summarize(raw.pointerMs),cpuSubmitMs:summarize(raw.frames.map(x=>x.cpuMs)),gpuMs:summarize(raw.gpuMs),drawCalls:summarize(raw.frames.map(x=>x.calls)),triangles:summarize(raw.frames.map(x=>x.triangles)),memoryBefore,memoryAfter,resources:raw.resources,frames:raw.frames,gpuSamples:raw.gpuMs};
    await cdp.send('HeapProfiler.collectGarbage');row.memoryAfterGc=await cdp.send('Runtime.getHeapUsage');
    results.push(row);fs.writeFileSync(path.join(out,`${prefix}.json`),JSON.stringify(results,null,2));
    console.log(JSON.stringify({...row,frames:undefined,gpuSamples:undefined},null,2));
    await page.screenshot({path:path.join(out,`${prefix}-${mobile?'mobile':'desktop'}-${variant}.png`)});
   }
   await context.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
