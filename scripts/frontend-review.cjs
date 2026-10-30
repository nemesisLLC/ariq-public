/* Run against local Next only. Uses an isolated browser profile and an explicitly drawn test field. */
const {chromium}=require(process.env.ARIQ_PLAYWRIGHT_PATH||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=process.env.ARIQ_REVIEW_URL||'http://127.0.0.1:3110';
const out=path.resolve('docs/frontend-review');fs.mkdirSync(out,{recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'});
  await context.addInitScript(()=>sessionStorage.setItem('ariq-entered','1'));
  const page=await context.newPage(),errors=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));
  async function shot(name){await page.screenshot({path:path.join(out,name+'.png')});}
  async function check(name,fn){try{await fn();checks.push({name,pass:true});console.log('PASS',name);}catch(e){checks.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message);await shot('failure-'+name.replace(/\W/g,'-'));}}
  await page.goto(base);await page.locator('.a-geography canvas').waitFor({timeout:45000});await page.waitForTimeout(3000);await shot('after-atlas');
  await check('Country scene and navigation',async()=>{assert.equal(await page.getByRole('heading',{name:'Uzbekistan',exact:true}).count(),1);assert.equal(await page.locator('.a-toolbelt button').count(),7);});
  await page.mouse.move(900,500);await page.mouse.down();await page.mouse.move(1100,570,{steps:18});await page.mouse.up();await page.waitForTimeout(700);await shot('after-orbit');
  await page.getByRole('button',{name:'Country view',exact:true}).click();
  await page.getByRole('button',{name:'Places & regions',exact:true}).click();await page.getByRole('button',{name:'Samarkand',exact:true}).click();await page.waitForTimeout(700);await shot('regional-samarkand');
  await page.getByRole('button',{name:'Find my field',exact:true}).last().click();await page.locator('.farmmap canvas').waitFor({timeout:30000});await page.waitForTimeout(3500);await shot('farm-empty');
  await check('Rectangle drawing',async()=>{
    await page.getByRole('button',{name:'Rectangle',exact:true}).click();const map=await page.locator('.farmmap').boundingBox();
    await page.mouse.move(map.x+map.width*.42,map.y+map.height*.43);await page.mouse.down();await page.mouse.move(map.x+map.width*.53,map.y+map.height*.56,{steps:16});await page.mouse.up();
    await page.locator('.farm-area-display strong').waitFor();
  });
  await page.getByLabel('Field name',{exact:true}).fill('Samarkand test field');
  await page.getByLabel('Crop',{exact:true}).selectOption('winter-wheat');
  await page.getByLabel('Planting date',{exact:true}).fill('2026-09-23');
  await shot('farm-boundary');
  await check('Forecast integration',async()=>{
    const response=page.waitForResponse(r=>r.url().includes('/api/irrigation/recommendation')&&r.request().method()==='POST',{timeout:95000});
    await page.getByRole('button',{name:'Check water demand',exact:true}).click();const r=await response;assert.equal(r.status(),200,await r.text());const body=await r.json();assert.equal(r.request().postDataJSON().applicationEfficiency,undefined);assert.ok(body.missingInputs.some(m=>m.field==='applicationEfficiency'));await page.locator('.farm-demand').waitFor();await shot('farm-demand');
  });
  await check('Groundwater scenario integration',async()=>{
    await page.locator('.a-toolbelt').getByRole('button',{name:'Groundwater',exact:true}).click();await page.getByLabel('Depth to groundwater (m)',{exact:true}).fill('1.4');await page.getByLabel('Root depth (m)',{exact:true}).fill('0.6');await page.getByLabel('Electrical conductivity (dS/m)',{exact:true}).fill('2.1');await page.getByRole('button',{name:'Explore this scenario',exact:true}).click();await page.getByText('Potential capillary contribution',{exact:true}).waitFor();await shot('groundwater');
  });
  await check('Soil texture integration',async()=>{
    await page.locator('.a-toolbelt').getByRole('button',{name:'Soil & nutrients',exact:true}).click();await page.getByLabel('Sand (%)',{exact:true}).fill('40');await page.getByLabel('Clay (%)',{exact:true}).fill('20');await page.getByLabel('Organic matter (%)',{exact:true}).fill('2');await page.getByRole('button',{name:'Estimate water holding',exact:true}).click();await page.getByText('Available water per root metre',{exact:true}).waitFor();await shot('soil-water-holding');
  });
  await check('Water Futures historical and worker integration',async()=>{
    await page.locator('.a-toolbelt').getByRole('button',{name:'Water Futures',exact:true}).click();await page.getByText('Use this reference as a scenario. It is not a measurement of my field.',{exact:true}).click();await page.getByLabel('Application efficiency (%)',{exact:true}).fill('65');await page.getByLabel('Season water budget (m³)',{exact:true}).fill('60000');await page.getByRole('button',{name:'Load historical weather & compare',exact:true}).click();await page.locator('.comparison-heading').waitFor({timeout:100000});assert.ok(await page.getByText('Relative yield retained',{exact:true}).count());await shot('water-futures');
  });
  await check('Passport export',async()=>{
    await page.locator('.a-toolbelt').getByRole('button',{name:'Water Passport',exact:true}).click();await page.locator('.water-passport').waitFor();await shot('water-passport');const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download passport',exact:true}).click();const download=await pending;await download.saveAs(path.join(out,'test-passport.json'));const value=JSON.parse(fs.readFileSync(path.join(out,'test-passport.json'),'utf8'));assert.equal(value.schema,'ariq-water-passport/v1');assert.equal(value.farm.cropId,'winter-wheat');assert.ok(value.areaHa>0);
  });
  await check('Sources integration',async()=>{await page.locator('.a-toolbelt').getByRole('button',{name:'Water briefing',exact:true}).click();await page.locator('.freshness-row').first().waitFor();await shot('water-briefing');});
  await check('Honest disabled Copilot',async()=>{await page.locator('.a-toolbelt').getByRole('button',{name:'Copilot',exact:true}).click();await page.getByText('Copilot is currently unavailable',{exact:true}).waitFor();await shot('copilot-disabled');});
  await check('Russian language',async()=>{await page.locator('#a-language').selectOption('ru');await page.getByText('Помощник пока недоступен',{exact:true}).waitFor();assert.equal(await page.locator('html').getAttribute('lang'),'ru');await shot('russian');});
  await check('Uzbek language',async()=>{await page.locator('#a-language').selectOption('uz');await page.getByText('Yordamchi hozircha mavjud emas',{exact:true}).waitFor();await shot('uzbek');});
  await page.locator('#a-language').selectOption('en');await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Back to the atlas',exact:true}).count().then(async n=>{if(n)await page.getByRole('button',{name:'Back to the atlas',exact:true}).click();});
  await check('Mobile layout',async()=>{
    await page.setViewportSize({width:390,height:844});await page.locator('.a-brand').click();await page.waitForTimeout(1200);await shot('mobile-atlas');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('button',{name:'Find my field',exact:true}).first().click();await page.waitForTimeout(1600);await shot('mobile-farm');
  });
  await check('No browser exceptions',async()=>assert.deepEqual(errors,[]));
  fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({base,generatedAt:new Date().toISOString(),checks,errors},null,2));
  await browser.close();if(checks.some(c=>!c.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1);});
