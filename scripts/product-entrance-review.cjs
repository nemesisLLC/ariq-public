const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.ARIQ_REVIEW_URL||'https://ariq-private.nezzoval.workers.dev';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
try{for(const mobile of [false,true]){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
 const token=JSON.parse(fs.readFileSync('.env.access-test.json'));
 await context.route(`${base}/**`,r=>r.continue({headers:{...r.request().headers(),'CF-Access-Client-Id':token.client_id,'CF-Access-Client-Secret':token.client_secret}}));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.locator('.registan-entrance.is-ready').waitFor({timeout:90000});
 await page.getByRole('button',{name:'Enter ARIQ',exact:true}).click();
 await page.getByRole('button',{name:'Replay entrance'}).waitFor({timeout:60000});
 await page.getByRole('button',{name:'Replay entrance'}).click();
 await page.locator('.registan-entrance').waitFor();await page.getByRole('button',{name:'Skip intro'}).click();
 await page.getByRole('button',{name:'Replay entrance'}).waitFor();
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Replay entrance'}).click();
 await page.getByRole('button',{name:'Enter ARIQ',exact:true}).click();await page.getByRole('button',{name:'Replay entrance'}).waitFor();
 assert.equal(errors.length,0);results.push({mobile,animatedEntrance:true,replay:true,skip:true,reducedMotion:true,errors});
 await context.close();
}fs.writeFileSync('docs/product-review/deployed/entrance.json',JSON.stringify(results,null,2));console.log(results);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

