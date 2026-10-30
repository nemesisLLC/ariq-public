const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.ARIQ_REVIEW_URL||'http://127.0.0.1:8787';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true}),results=[];
try{for(const mobile of [false,true]){
const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});await context.addInitScript(()=>sessionStorage.setItem('ariq-entered','1'));
const page=await context.newPage();await page.goto(base);await page.getByRole('button',{name:'Find my field',exact:true}).first().click();await page.getByRole('searchbox').fill('Samarqand');await page.locator('.journey-place').first().click();await page.locator('.maplibregl-canvas').waitFor();await page.waitForTimeout(1500);
const b=await page.locator('.maplibregl-canvas').boundingBox();const points=[[.35,.43],[.65,.43],[.65,.64],[.35,.64]].map(([x,y])=>({x:b.x+b.width*x,y:b.y+b.height*y}));
const tap=async p=>mobile?page.touchscreen.tap(p.x,p.y):page.mouse.click(p.x,p.y);
await page.getByRole('button',{name:'Draw boundary',exact:true}).click();for(const p of points)await tap(p);
await tap({x:points[0].x+10,y:points[0].y+8});await page.getByRole('button',{name:'Use this boundary',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/Finish boundary/}).count(),0);
await page.getByRole('button',{name:'Delete boundary',exact:true}).click();await page.getByRole('button',{name:'Rectangle',exact:true}).click();
if(mobile){await tap(points[0]);await tap(points[2]);}else{await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[2].x,points[2].y,{steps:8});await page.waitForTimeout(150);
const closed=await page.evaluate(()=>{const el=document.querySelector('.farmmap');let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];for(;f;f=f.return)for(let h=f.memoizedState;h;h=h.next){const m=h.memoizedState?.current;if(m?.getSource){const d=m.getSource('farm-draw').serialize().data;const line=d.features.find(f=>f.properties.role==='draft-line').geometry.coordinates;return line.length===5&&JSON.stringify(line[0])===JSON.stringify(line[4]);}}throw Error('Map missing');});assert(closed,'Rectangle preview must include all four edges');await page.mouse.up();}
await page.getByRole('button',{name:'Use this boundary',exact:true}).waitFor();await page.screenshot({path:`docs/product-review/${mobile?'mobile':'desktop'}-drawing-fix.png`});results.push({mobile,polygonNearStartCloses:true,rectangle:true,closedPreview:mobile?'desktop preview verified separately':true});await context.close();
}fs.writeFileSync('docs/product-review/drawing-fix.json',JSON.stringify({base,results},null,2));console.log(results);}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

