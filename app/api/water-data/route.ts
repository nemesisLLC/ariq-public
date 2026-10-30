import {featuresGeoJson, searchFeatures, type FeatureQuery} from '../../../lib/data-foundation.ts';

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const query = parse(params);
    if (params.get('format') === 'geojson') return Response.json(featuresGeoJson(query), { headers: { 'Cache-Control': 'no-store' } });
    const { total, results } = searchFeatures(query);
    return Response.json({ total, count: results.length, results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid query.' }, { status: 400 });
  }
}
function parse(params: URLSearchParams): FeatureQuery {
  const query: FeatureQuery = {};
  for (const key of ['q', 'category', 'kind', 'region', 'basin', 'sourceDataset'] as const) {
    const v = params.get(key); if (v !== null) query[key] = v;
  }
  const bbox = params.get('bbox'); if (bbox !== null) query.bbox = bbox.split(',').map(Number) as [number, number, number, number];
  const limit = params.get('limit'); if (limit !== null) query.limit = Number(limit);
  const offset = params.get('offset'); if (offset !== null) query.offset = Number(offset);
  return query;
}
