// Browser-only regression checks against the built or deployed atlas.
const {chromium}=require('playwright'),fs=require('node:fs');
const install=require('./render-probe.cjs');
const base=process.env.ARIQ_REVIEW_URL||'http://127.0.0.1:8787';
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
 try{for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},deviceScaleFactor:mobile?3:1,isMobile:mobile,hasTouch:mobile});
  if(base.startsWith('https://ariq-private.nezzoval.workers.dev')){const token=JSON.parse(fs.readFileSync('.env.access-test.json'));await context.route('https://ariq-private.nezzoval.workers.dev/**',r=>r.continue({headers:{...r.request().headers(),'CF-Access-Client-Id':token.client_id,'CF-Access-Client-Secret':token.client_secret}}));}
  await context.addInitScript(install);await context.addInitScript(()=>sessionStorage.setItem('ariq-entered','1'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const cdp=await context.newCDPSession(page);
  await page.goto(base);await page.waitForFunction(()=>window.__ariqRenderProbe?.discover(),null,{timeout:90000});await page.waitForTimeout(3500);
  await page.evaluate(()=>window.__ariqRenderProbe.attach());
  const pose=()=>page.evaluate(()=>{const p=window.__ariqRenderProbe;return {camera:p.state.camera.position.toArray(),target:p.controls.target.toArray(),distance:p.state.camera.position.distanceTo(p.controls.target)};});
  const a=await pose();
  if(mobile){
   const touch=async(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y],id)=>({x,y,id,radiusX:2,radiusY:2,force:1}))});
   await touch('touchStart',[[190,420]]);for(let i=1;i<=20;i++)await touch('touchMove',[[190+i*3,420-i]]);await touch('touchEnd',[]);await page.waitForTimeout(800);
   const b=await pose();assert(JSON.stringify(a.camera)!==JSON.stringify(b.camera),'Touch rotation did not move camera');
   await touch('touchStart',[[140,420],[240,420]]);for(let i=1;i<=16;i++)await touch('touchMove',[[140-i*2,420+i],[240+i*2,420+i]]);await touch('touchEnd',[]);await page.waitForTimeout(900);
   const c=await pose();assert(Math.abs(c.distance-b.distance)>.1,'Pinch zoom did not change distance');assert(JSON.stringify(c.target)!==JSON.stringify(b.target),'Two-finger pan did not move target');
  }else{
   await page.mouse.move(700,450);await page.mouse.down();await page.mouse.move(840,480,{steps:24});await page.mouse.up();await page.waitForTimeout(800);const b=await pose();assert(JSON.stringify(a.camera)!==JSON.stringify(b.camera),'Mouse rotation did not move camera');
   await page.mouse.move(700,450);await page.mouse.down({button:'right'});await page.mouse.move(750,480,{steps:16});await page.mouse.up({button:'right'});await page.waitForTimeout(800);const c=await pose();assert(JSON.stringify(c.target)!==JSON.stringify(b.target),'Mouse pan did not move target');
   await page.mouse.wheel(0,-200);await page.waitForTimeout(900);const d=await pose();assert(d.distance<c.distance,'Wheel zoom did not reduce distance');
  }
  // Verify the preserved seven-second emissive pulse, then reduced-motion idle.
  // Screenshot equality also catches any water ribbon, regardless of material names.
  const pulseA=await page.locator('canvas').screenshot();await page.waitForTimeout(1700);const pulseB=await page.locator('canvas').screenshot();assert(!pulseA.equals(pulseB),'Water pulse stopped');
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(1000);const stillA=await page.locator('canvas').screenshot();await page.waitForTimeout(700);const stillB=await page.locator('canvas').screenshot();assert(stillA.equals(stillB),'Reduced-motion idle should be still');
  // Dam instances mount/unmount, and the cached shadow is explicitly regenerated.
  await page.locator('.a-layers > button').click();const reservoirs=page.locator('.layer-choices input').nth(2);
  const dams=()=>page.evaluate(()=>{let n=0;window.__ariqRenderProbe.state.scene.traverse(o=>{if(o.isInstancedMesh&&o.castShadow)n+=o.count;});return n;});
  const before=await dams();assert(before>0,'Dam instances missing');await reservoirs.uncheck();await page.waitForTimeout(300);assert(await dams()===0,'Dam layer did not hide');await reservoirs.check();await page.waitForTimeout(500);assert(await dams()===before,'Dam instances did not return');
  const shadow=await page.evaluate(()=>{const p=window.__ariqRenderProbe;return {autoUpdate:p.state.gl.shadowMap.autoUpdate,pending:p.state.gl.shadowMap.needsUpdate};});assert(!shadow.autoUpdate&&!shadow.pending,'Static shadow did not finish refreshing');
  assert(!errors.length,errors.join('\n'));results.push({base,mobile,rotation:true,pan:true,zoom:true,waterPulse:true,reducedMotionStill:true,damLayerRestored:true,shadowCacheRefreshed:true,errors});
  await page.screenshot({path:`docs/render-performance/interaction-${mobile?'mobile':'desktop'}.png`});await context.close();
 }}finally{await browser.close();}
 fs.writeFileSync(`docs/render-performance/${process.env.REVIEW_PREFIX||'interaction'}.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
