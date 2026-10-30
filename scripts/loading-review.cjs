const { chromium } = require('playwright');
const fs = require('node:fs');
const base = process.env.ARIQ_REVIEW_URL || 'http://127.0.0.1:3120';
const label = process.env.REVIEW_PREFIX || 'baseline';
const out = 'docs/deployment-review';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      if (process.env.ARIQ_THROTTLE === '1') {
        const network = await context.newCDPSession(page);
        await network.send('Network.enable');
        await network.send('Network.setCacheDisabled',{cacheDisabled:true});
        await network.send('Network.emulateNetworkConditions',{
          offline:false,latency:100,downloadThroughput:200000,uploadThroughput:100000,
        });
      }
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        window.loadingMetrics = {};
        new PerformanceObserver(list => {
          for (const e of list.getEntries()) window.loadingMetrics[e.name] = e.startTime;
        }).observe({type:'paint', buffered:true});
        new MutationObserver(() => {
          if (!window.loadingMetrics.sceneReady && document.querySelector('.is-ready'))
            window.loadingMetrics.sceneReady = performance.now();
        }).observe(document, {subtree:true,attributes:true,childList:true});
      });
      await page.goto(base, {waitUntil:'domcontentloaded'});
      await page.locator('.registan-entrance').waitFor();
      await page.locator('.is-ready').waitFor({timeout:90000});
      await page.screenshot({path:`${out}/${label}-${viewport.width}.png`});
      const before = await page.evaluate(() => ({...window.loadingMetrics,
        resources:performance.getEntriesByType('resource').filter(e => /preview|ceramic|gold|\.js|\.css/.test(e.name)).map(e=>({url:e.name,start:e.startTime,end:e.responseEnd,bytes:e.transferSize})),
        navigation:performance.getEntriesByType('navigation')[0].toJSON()}));
      const clicked = Date.now();
      await page.getByRole('button',{name:'Enter ARIQ',exact:true}).click();
      await page.locator('.registan-app').waitFor({state:'attached',timeout:30000});
      results.push({base,viewport,...before,transitionMs:Date.now()-clicked,errors});
      await context.close();
    }
    fs.writeFileSync(`${out}/${label}-loading.json`,JSON.stringify(results,null,2));
    console.log(JSON.stringify(results.map(r=>({viewport:r.viewport,transitionMs:r.transitionMs,sceneReady:r.sceneReady,fcp:r['first-contentful-paint'],errors:r.errors})),null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
