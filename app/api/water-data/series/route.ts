import {searchSeries, type SeriesQuery} from '../../../../lib/data-foundation.ts';
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query: SeriesQuery = {};
  for (const key of ['sourceDataset', 'country', 'region', 'geography', 'measurementKind', 'q'] as const) {
    const v = params.get(key); if (v !== null) query[key] = v;
  }
  const results = searchSeries(query);
  return Response.json({ total: results.length, results }, { headers: { 'Cache-Control': 'no-store' } });
}
