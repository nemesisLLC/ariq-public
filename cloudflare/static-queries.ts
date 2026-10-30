import {UZ_BBOX} from '../app/atlas/geo.ts';
export const NATIONAL_BBOX = `${UZ_BBOX.minLon},${UZ_BBOX.minLat},${UZ_BBOX.maxLon},${UZ_BBOX.maxLat}`;
export const BOOTSTRAP_FILTERS = ['kind=river','kind=canal','category=water-body','category=infrastructure'];
export function staticQueryPath(url: URL): string | null {
  if (url.pathname === '/api/water-data/regions') return '/data/bootstrap/regions.json';
  if (url.pathname !== '/api/water-data') return null;
  const p = url.searchParams, keys = [...p.keys()];
  if (keys.length !== new Set(keys).size || keys.some(k=>!['format','bbox','kind','category','limit','offset'].includes(k))) return null;
  if (p.get('format') !== 'geojson' || p.get('bbox') !== NATIONAL_BBOX || p.get('limit') !== '1000') return null;
  const filter = BOOTSTRAP_FILTERS.find(f=>{const [key,value]=f.split('=');return p.get(key)===value;});
  if (!filter || (p.has('kind') && p.has('category'))) return null;
  const offset = Number(p.get('offset') ?? '0');
  if (!Number.isInteger(offset) || offset < 0 || offset > 5000 || offset % 1000 !== 0) return null;
  return `/data/bootstrap/${filter.replace('=','-')}-${offset}.json`;
}
