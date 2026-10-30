import type {LonLat} from './geo.ts';
export type Settlement={id:number;name:string;aliases:string;lat:number;lon:number;region:string;population:number};
export const normalizePlace=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f‘’ʻʼ'`]/g,'').toLocaleLowerCase().trim();
export function searchPlaces(places:Settlement[],query:string):Settlement[]{
  const q=normalizePlace(query);if(q.length<2)return [];
  const score=(p:Settlement)=>[p.name,...p.aliases.split(',')].reduce((best,n)=>{const v=normalizePlace(n);return Math.max(best,v===q?3:v.startsWith(q)?2:v.includes(q)?1:0);},0);
  return places.map(p=>({p,s:score(p)})).filter(v=>v.s>0).sort((a,b)=>b.s-a.s||b.p.population-a.p.population||a.p.name.localeCompare(b.p.name)).slice(0,10).map(v=>v.p);
}
/** Explicit latitude, longitude input; never silently swap axes. */
export function parseSearchCoordinates(query:string):LonLat|null {
  const m=query.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);if(!m)return null;
  const lat=Number(m[1]),lon=Number(m[2]);return lat>=37&&lat<=45.7&&lon>=55.9&&lon<=73.3?[lon,lat]:null;
}
