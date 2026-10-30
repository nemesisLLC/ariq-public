import {test} from 'node:test';
import assert from 'node:assert/strict';
import {foundationFeatures,foundationRegions,nearestWaterFeatures,pointToSegmentKm,regionSummary} from '../lib/data-foundation.ts';
import {NATIONAL_BBOX,staticQueryPath} from '../cloudflare/static-queries.ts';

test('optimized nearest-water search exactly matches exhaustive distances across all regions',()=>{
  const rad=Math.PI/180;
  for(const r of foundationRegions){
    if(!r.centre)continue;
    const {latitude:lat,longitude:lon}=r.centre;
    const distance=(x:number,y:number)=>6371*2*Math.asin(Math.sqrt(Math.sin((y-lat)*rad/2)**2+Math.cos(lat*rad)*Math.cos(y*rad)*Math.sin((x-lon)*rad/2)**2));
    const all=foundationFeatures.filter(f=>f.geometry).map(f=>{
      const g=f.geometry!;let d=Infinity;
      if(g.type==='Point')d=distance(...g.coordinates);
      else if(g.coordinates.length===1)d=distance(...g.coordinates[0]);
      else for(let i=1;i<g.coordinates.length;i++)d=Math.min(d,pointToSegmentKm(lat,lon,g.coordinates[i-1],g.coordinates[i]));
      return {id:f.id,d};
    }).sort((a,b)=>a.d-b.d||(a.id<b.id?-1:1));
    for(const k of [1,5,100]){
      const actual=nearestWaterFeatures(lat,lon,k);
      assert.deepEqual(actual.map(x=>x.feature.id),all.slice(0,k).map(x=>x.id));
      actual.forEach((x,i)=>assert.ok(Math.abs(x.distanceKm-all[i].d)<1e-10));
    }
  }
});

test('region aggregation retains exact original counts and kinds',()=>{
  const norm=(s:string)=>s.toLowerCase().replace(/['’`]/g,'').replace(/\s+/g,' ').trim();
  for(const summary of regionSummary()){
    const selected=foundationFeatures.filter(f=>f.region!==null&&norm(f.region)===norm(summary.region.nameEn??summary.region.nameSource));
    const byKind:Record<string,number>={};for(const f of selected)byKind[f.kind]=(byKind[f.kind]??0)+1;
    assert.equal(summary.featureCount,selected.length);assert.deepEqual(summary.byKind,byKind);
  }
});

test('only exact unmodified nationwide bootstrap queries use build-time data',()=>{
  const query=`https://ariq-private.nezzoval.workers.dev/api/water-data?format=geojson&bbox=${NATIONAL_BBOX}&kind=river&limit=1000&offset=0`;
  assert.equal(staticQueryPath(new URL(query)),'/data/bootstrap/kind-river-0.json');
  for(const value of [query+'&region=Samarqand',query.replace(NATIONAL_BBOX,'66,39,67,40'),query+'&kind=canal',query.replace('offset=0','offset=17')])assert.equal(staticQueryPath(new URL(value)),null);
});
