import {searchWaterSources, waterDataset, waterSourcesGeoJson, waterStatistics, type WaterQuery} from '../../../lib/water-sources.ts';

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    if (params.get('format') === 'geojson') {
      return Response.json(waterSourcesGeoJson(parseQuery(params)), { headers: { 'Cache-Control': 'no-store' } });
    }
    const { total, results } = searchWaterSources(parseQuery(params));
    return Response.json({
      dataset: waterDataset.dataset, version: waterDataset.version, generatedAt: waterDataset.generatedAt,
      kind: waterDataset.kind, description: waterDataset.description, sources: waterDataset.sources,
      total, count: results.length, results,
      statistics: params.get('include') === 'statistics' ? waterStatistics : undefined,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid query.' }, { status: 400 });
  }
}

function parseQuery(params: URLSearchParams): WaterQuery {
  const query: WaterQuery = {};
  const q = params.get('q'); if (q !== null) query.q = q;
  const kind = params.get('kind'); if (kind !== null) query.kind = kind as WaterQuery['kind'];
  const region = params.get('region'); if (region !== null) query.region = region;
  const basin = params.get('basin'); if (basin !== null) query.basin = basin;
  const bbox = params.get('bbox');
  if (bbox !== null) query.bbox = bbox.split(',').map(Number) as [number, number, number, number];
  const has = params.get('hasCoordinates');
  if (has !== null) { if (has !== 'true' && has !== 'false') throw new Error('hasCoordinates must be true or false'); query.hasCoordinates = has === 'true'; }
  const limit = params.get('limit'); if (limit !== null) query.limit = Number(limit);
  const offset = params.get('offset'); if (offset !== null) query.offset = Number(offset);
  return query;
}
