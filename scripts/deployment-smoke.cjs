const fs = require('node:fs');
const assert = require('node:assert/strict');
const base = process.env.ARIQ_REVIEW_URL || 'https://ariq-private.nezzoval.workers.dev';
const credential = JSON.parse(fs.readFileSync('.env.access-test.json','utf8'));
const headers = {'CF-Access-Client-Id':credential.client_id,'CF-Access-Client-Secret':credential.client_secret};
(async () => {
  const results = [];
  for (const path of ['/', '/api/health', '/api/data-freshness', '/media/registan/preview-instant-v1.avif','/data/uzbekistan-artifact-v2.json']) {
    const anonymous = await fetch(base+path,{redirect:'manual'});
    assert.equal(anonymous.status,302,`Anonymous ${path} must require Access`);
    const started = Date.now();
    const response = await fetch(base+path,{headers});
    const bytes = (await response.arrayBuffer()).byteLength;
    assert.equal(response.status,200,`Authenticated ${path}`);
    results.push({path,anonymous:anonymous.status,status:response.status,bytes,ms:Date.now()-started,
      cache:response.headers.get('cache-control'),encoding:response.headers.get('content-encoding')});
  }
  for (const path of ['/api/copilot','/api/irrigation/investigate']) {
    const response = await fetch(base+path,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
    assert.ok(response.status>=400,`AI cannot be publicly enabled: ${path}`);
    results.push({path,status:response.status,body:await response.json()});
  }
  const weather = await fetch(base+'/api/weather?lat=39.72&lon=66.91',{headers});
  const forecast = await weather.json();
  assert.equal(weather.status,200);
  assert.equal(forecast.daily.time.length,7);
  results.push({path:'/api/weather',status:weather.status,forecast});
  fs.writeFileSync('docs/deployment-review/deployed-smoke.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(results.map(({forecast,body,...r})=>r),null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
