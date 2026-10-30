import {nearestWaterFeatures} from '../../../../lib/data-foundation.ts';
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const lat = Number(params.get('lat')), lon = Number(params.get('lon'));
    if (!params.has('lat') || !params.has('lon')) throw new Error('lat and lon are required');
    const k = params.get('k') === null ? 5 : Number(params.get('k'));
    return Response.json({ note: 'Geographic proximity only (point distance or closest point on a mapped line); this does not imply hydraulic connectivity or water access.', results: nearestWaterFeatures(lat, lon, k) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid coordinates.' }, { status: 400 });
  }
}
