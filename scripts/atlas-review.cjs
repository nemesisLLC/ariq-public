// Scope: initial atlas and preserved entry, not the paused full frontend release.
const {chromium}=require(process.env.ARIQ_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const base=process.env.ARIQ_REVIEW_URL||'http://127.0.0.1:3110',out=path.resolve('docs/frontend-review');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const checks=[],exceptions=[];
  try{
    const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'});
    await context.addInitScript(()=>sessionStorage.setItem('ariq-entered','1'));
    const page=await context.newPage();page.on('pageerror',e=>exceptions.push(e.message));
    const screenshot=name=>page.screenshot({path:path.join(out,`atlas-reset-${name}.png`)});
    async function check(name,fn){try{await fn();checks.push({name,pass:true});console.log('PASS',name);}catch(e){checks.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message);}}
    await page.goto(base);await page.locator('.a-geography canvas').waitFor({timeout:45000});await page.waitForTimeout(1600);
    await check('Minimal opening and one primary action',async()=>{assert.equal(await page.locator('.atlas-intro,.a-toolbelt').count(),0);assert.equal(await page.locator('.atlas-primary .primary:visible').count(),1);assert.equal(await page.getByRole('heading',{name:'Uzbekistan',exact:true}).count(),0);assert.equal(await page.locator('.a-workspace').count(),0);});await screenshot('desktop');
    await page.setViewportSize({width:1920,height:1080});await page.waitForTimeout(700);await screenshot('wide');
    await check('Orbit responds and north indicator follows camera',async()=>{
      const before=await page.locator('.atlas-orientation svg').getAttribute('style');await page.mouse.move(1000,480);await page.mouse.down();await page.mouse.move(1190,560,{steps:20});await page.mouse.up();await page.waitForTimeout(650);const after=await page.locator('.atlas-orientation svg').getAttribute('style');assert.notEqual(after,before);await screenshot('orbit');
    });
    await page.getByRole('button',{name:'Country view',exact:true}).click();await page.waitForTimeout(300);
    await check('Layer controls are disclosed and respond',async()=>{await page.getByRole('button',{name:'Map layers',exact:true}).click();await page.getByLabel('Irrigation canals',{exact:true}).uncheck();assert.equal(await page.getByLabel('Irrigation canals',{exact:true}).isChecked(),false);await page.getByLabel('Irrigation canals',{exact:true}).check();await page.getByRole('button',{name:'Map layers',exact:true}).click();});
    await check('Explore reveals places and geographic selection',async()=>{await page.getByText('Explore',{exact:true}).click();await page.getByRole('button',{name:'Places & regions',exact:true}).click();await page.getByRole('button',{name:'Samarkand',exact:true}).click();await page.locator('.a-place-sheet').waitFor();await page.waitForTimeout(700);assert.ok((await page.locator('.a-place-sheet').innerText()).includes('39.6546'));assert.equal(await page.locator('.atlas-primary').count(),0);assert.equal(await page.locator('.atlas-discover').getAttribute('open'),null);await screenshot('city');await page.locator('.a-place-sheet').getByRole('button',{name:'Close',exact:true}).click();});
    await page.getByRole('button',{name:'Country view',exact:true}).click();
    await check('Language switches without moving geography',async()=>{const responseCount=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('uzbekistan-artifact-v2')).length);await page.locator('#a-language').selectOption('uz');await page.getByRole('button',{name:'Dalamni topish',exact:true}).waitFor();await page.locator('#a-language').selectOption('ru');await page.getByRole('button',{name:'Найти моё поле',exact:true}).waitFor();assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('uzbekistan-artifact-v2')).length),responseCount);await screenshot('russian');await page.locator('#a-language').selectOption('en');});
    await check('Mobile framing and overflow',async()=>{await page.setViewportSize({width:390,height:844});await page.waitForTimeout(1000);await screenshot('mobile');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const button=await page.locator('.atlas-primary button').boundingBox();assert.ok(button.height>=44&&button.x>=0&&button.x+button.width<=390);});
    await check('Keyboard focus is visible',async()=>{await page.keyboard.press('Tab');assert.ok(await page.locator(':focus-visible').count());});
    await check('No browser exceptions',async()=>assert.deepEqual(exceptions,[]));
    // Actual accepted entrance is separately loaded without the session gate; no entrance source changed.
    const intro=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'}),entry=await intro.newPage();
    await entry.goto(base);await entry.locator('.registan-enter').waitFor();await entry.screenshot({path:path.join(out,'atlas-reset-preserved-entrance.png')});
    await check('Preserved entrance CTA and reduced-motion handoff',async()=>{const size=await entry.locator('.registan-enter').boundingBox();assert.ok(size.width>=280&&size.height>=64);await entry.locator('.registan-enter').click();await entry.locator('.museum-atlas').waitFor();await entry.locator('.a-geography canvas').waitFor({timeout:30000});assert.equal(await entry.locator('.a-toolbelt').count(),0);});
    await intro.close();
  }finally{
    fs.writeFileSync(path.join(out,'atlas-reset-browser-results.json'),JSON.stringify({base,createdAt:new Date().toISOString(),checks,exceptions},null,2));await browser.close();
  }
  if(checks.some(c=>!c.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
