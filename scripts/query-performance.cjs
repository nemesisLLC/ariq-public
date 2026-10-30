const fs=require('node:fs'),assert=require('node:assert/strict');
const token=JSON.parse(fs.readFileSync('.env.access-test.json','utf8'));
const headers={'CF-Access-Client-Id':token.client_id,'CF-Access-Client-Secret':token.client_secret};
const base='https://ariq-private.nezzoval.workers.dev';
(async()=>{
  const rows=[];
  for(let i=0;i<3;i++){
    for(const query of ['kind=river&limit=400','kind=canal&limit=400','category=water-body&limit=200']){
      const url=base+`/api/water-data?format=geojson&bbox=66.89,39.70,66.94,39.75&${query}`;
      const started=Date.now(),response=await fetch(url,{headers}),data=await response.json();
      assert.equal(response.status,200);assert.equal(data.type,'FeatureCollection');
      rows.push({query,status:response.status,features:data.features.length,ms:Date.now()-started});
    }
  }
  fs.writeFileSync('docs/deployment-review/final-query-performance.json',JSON.stringify(rows,null,2));
  console.log(JSON.stringify(rows,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
