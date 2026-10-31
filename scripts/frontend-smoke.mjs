import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { buildFarmProfile } from '../lib/farm-profile.ts';

// Run against a local production server. Model and weather responses are mocked;
// this check never calls a paid provider or writes a visitor's real field.
const base = process.env.ARIQ_REVIEW_URL ?? 'http://127.0.0.1:3011';
const output = resolve(process.env.ARIQ_REVIEW_OUTPUT ?? '../frontend-review');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const profile = await buildFarmProfile({ latitude:39.57, longitude:66.82, cropId:'cotton', plantingDate:'2026-07-01', polygon:[[66.805,39.555],[66.815,39.555],[66.815,39.565],[66.805,39.565]] }, {
  fetcher: async () => Response.json({ latitude:39.57, longitude:66.82, timezone:'Asia/Samarkand', daily_units:{rain_sum:'mm',showers_sum:'mm',et0_fao_evapotranspiration:'mm'}, daily:{time:Array.from({length:7},(_,i)=>`2026-07-0${i+1}`),temperature_2m_max:Array(7).fill(34),temperature_2m_min:Array(7).fill(20),precipitation_sum:Array(7).fill(0),rain_sum:Array(7).fill(0),showers_sum:Array(7).fill(0),et0_fao_evapotranspiration:Array(7).fill(6)} }),
  soilMoistureFetcher: async () => { throw Error('Offline review'); },
});
assert.ok(profile.irrigation?.forecastDays.length, `Review fixture must include a usable forecast: ${JSON.stringify(profile.advisories)}`);
const check = (value, message) => { assert.ok(value, message); console.log(`PASS ${message}`); };
async function pageFor(options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/copilot', async route => route.fulfill({ json:{available:false} }));
  return { context, page };
}
try {
  for (const [name, viewport, touch] of [['mobile',{width:390,height:844},true],['landscape',{width:844,height:390},true]]) {
    const {context,page}=await pageFor({viewport,isMobile:touch,hasTouch:touch});
    const entranceRequests=[];
    page.on('request',r=>{if(r.url().includes('/media/registan/'))entranceRequests.push(r.url());});
    await page.goto(base);
    await page.locator('.museum-atlas').waitFor();
    check(await page.locator('.registan-entrance,.registan-replay').count()===0,`${name}: entrance and replay bypassed`);
    await page.getByRole('button',{name:'Open ARIQ Copilot',exact:true}).click();
    await page.getByText('Start with your field',{exact:true}).waitFor();
    check(entranceRequests.length===0,`${name}: no Registan image downloads`);
    check(await page.locator('#copilot-q').evaluate(el=>getComputedStyle(el).fontSize)==='16px',`${name}: readable input without focus zoom`);
    if(name==='mobile')check((await page.locator('#copilot-q').boundingBox()).width>200,'mobile: question input has room to type');
    await page.screenshot({animations:'disabled',path:resolve(output,`${name}-help.png`)});
    await page.locator('.copilot-guide button').click();
    await page.locator('.farm-journey').waitFor();
    check(await page.locator('.copilot-panel').count()===0,`${name}: local guide opens field selection without AI`);
    await page.locator('.journey-pane input[type=search]').fill('Samarqand');
    await page.locator('.journey-place').first().waitFor();
    await page.screenshot({animations:'disabled',path:resolve(output,`${name}-find.png`)});
    await page.locator('.journey-place').first().click();
    await page.locator('.journey-step-1').waitFor();
    await page.getByRole('button',{name:'Open ARIQ Copilot',exact:true}).click();
    await page.getByText('Outline your field',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.screenshot({animations:'disabled',path:resolve(output,`${name}-draw.png`)});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: no horizontal page overflow`);
    await context.close();
  }
  const {context,page}=await pageFor({viewport:{width:1440,height:900}});
  await page.addInitScript(()=>localStorage.setItem('ariq-copilot-ui-v1',JSON.stringify({x:5000,y:5000,w:680,h:760})));
  await page.goto(base);
  await page.getByRole('button',{name:'Skip intro',exact:true}).click();
  await page.locator('.museum-atlas').waitFor();
  await page.getByRole('button',{name:'Open ARIQ Copilot',exact:true}).click();
  let box=await page.locator('.copilot-panel').boundingBox();
  check(box.x+box.width<=1440&&box.y+box.height<=900,'desktop: stale window position recovered');
  await page.setViewportSize({width:1024,height:600});
  await page.waitForFunction(()=>{const r=document.querySelector('.copilot-panel').getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight;});
  check(true,'desktop: window stays reachable after resize');
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.querySelector('.copilot-launcher')===document.activeElement);
  check(await page.locator('.copilot-launcher').evaluate(el=>el===document.activeElement),'desktop: Escape restores launcher focus');
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'Open ARIQ Copilot',exact:true}).click();
  let release;
  let payload;
  const gate=new Promise(r=>{release=r;});
  await page.route('**/api/copilot',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{available:true}});
    payload=route.request().postDataJSON();
    await gate;
    await route.fulfill({json:{explanation:{title:'Water outlook',summary:'Check the soil before choosing irrigation. '+ 'Long explanation '.repeat(35),caveats:[]},toolResults:{},actions:[]}});
  });
  await page.locator('#copilot-q').fill('Help me understand my field');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByText('Working with ARIQ’s scientific tools…',{exact:true}).waitFor();
  await page.locator('.atlas-primary button').click();
  await page.locator('.farm-journey').waitFor();
  release();
  await page.locator('.copilot-turn.assistant').waitFor();
  check(!!payload,'Copilot: in-flight reply survives atlas-to-farm navigation');
  await page.screenshot({animations:'disabled',path:resolve(output,'desktop-reply.png')});
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Explore an example farm',exact:true}).click();
  await page.locator('.journey-step-2').waitFor();
  await page.getByRole('button',{name:'Cotton',exact:true}).click();
  await page.locator('input[type=date]').fill('2026-07-01');
  await page.screenshot({animations:'disabled',path:resolve(output,'desktop-crop.png')});
  let failProfile=true;
  await page.route('**/api/farm-evidence?*',async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.has('cropId')&&failProfile)return route.fulfill({status:503,json:{error:'Weather check unavailable. Try again.'}});
    return route.fulfill({json:url.searchParams.has('cropId')?{profile}:profile.evidence});
  });
  await page.getByRole('button',{name:'Understand my field',exact:false}).click();
  await page.locator('.journey-error').waitFor();
  await page.getByRole('button',{name:'Open ARIQ Copilot',exact:true}).click();
  await page.getByText('Try the field check again',{exact:true}).waitFor();
  await page.screenshot({animations:'disabled',path:resolve(output,'desktop-error-help.png')});
  await page.getByRole('button',{name:'Close',exact:true}).click();
  failProfile=false;
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByText('Your water outlook',{exact:true}).waitFor();
  check(!await page.locator('.field-pulse').evaluate(el=>el.open),'field: detailed moisture scenarios start collapsed');
  await page.screenshot({animations:'disabled',path:resolve(output,'desktop-results.png')});
  await page.setViewportSize({width:390,height:844});
  await page.locator('.field-reading').scrollIntoViewIfNeeded();
  await page.screenshot({animations:'disabled',path:resolve(output,'mobile-results.png')});
  await page.getByRole('button',{name:'Open ARIQ Copilot',exact:true}).click();
  await page.getByText('Read your water outlook',{exact:true}).waitFor();
  let followup;
  await page.route('**/api/copilot',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{available:true}});
    followup=route.request().postDataJSON();
    await route.fulfill({status:503,json:{kind:'copilot-disabled'}});
  });
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('.journey-header select').last().selectOption('us');
  await page.getByRole('button',{name:'Open ARIQ Copilot',exact:true}).click();
  await page.locator('#copilot-q').fill('Explain the next step');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByText('Copilot is temporarily unavailable. ARIQ’s calculators and atlas keep working.',{exact:true}).waitFor();
  check(followup.units==='us'&&followup.history.every(t=>t.text.length<=1000),'Copilot: follow-up preserves field units and accepted history lengths');
  check(await page.getByText('Read your water outlook',{exact:true}).isVisible(),'Copilot: local guidance stays available when AI fails');
  await page.screenshot({animations:'disabled',path:resolve(output,'mobile-results-help.png')});
  await context.close();
  check(errors.length===0,`no browser exceptions (${errors.join('; ')})`);
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
