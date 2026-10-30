import {mkdirSync,writeFileSync} from 'node:fs';
import {featuresGeoJson,regionSummary} from '../lib/data-foundation.ts';
import {BOOTSTRAP_FILTERS,NATIONAL_BBOX} from '../cloudflare/static-queries.ts';
const out='dist/client/data/bootstrap';
mkdirSync(out,{recursive:true});
writeFileSync(`${out}/regions.json`,JSON.stringify({count:14,regions:regionSummary()}));
for(const filter of BOOTSTRAP_FILTERS){
  const [key,value]=filter.split('=');
  for(let offset=0;offset<=5000;offset+=1000){
    const data=featuresGeoJson({[key]:value,bbox:NATIONAL_BBOX.split(',').map(Number) as [number,number,number,number],limit:1000,offset});
    writeFileSync(`${out}/${filter.replace('=','-')}-${offset}.json`,JSON.stringify(data));
    if(data.nextOffset===null)break;
  }
}
console.log('Prepared exact existing national data responses as Static Assets.');
