/**
 * Nationwide Uzbekistan water-data foundation (Feature 3).
 *
 * Unifies the Feature 2 verified water sources with nationwide OpenStreetMap
 * features, region boundaries (centres/bboxes), time series (reported SIAT /
 * AQUASTAT / ICWC yearbook / World Bank, modeled ERA5 reanalysis), a source
 * catalog with ingestion status and licensing, and a conflicts register.
 *
 * Rules: geographic proximity is never hydraulic connectivity; national
 * statistics are never downscaled to fields; every value keeps its
 * measurement kind (observed / reported / modeled / forecast / estimated /
 * simulated) and provenance.
 */
import regionsJson from './data-foundation/regions.json' with { type: 'json' };
import osmJson from './data-foundation/osm-features.json' with { type: 'json' };
import seriesJson from './data-foundation/series.json' with { type: 'json' };
import catalogJson from './data-foundation/catalog.json' with { type: 'json' };
import conflictsJson from './data-foundation/conflicts.json' with { type: 'json' };
import { waterSources } from './water-sources.ts';

export type FoundationFeature = {
  id: string; sourceDataset: string; category: string; kind: string;
  nameEn: string | null; nameSource: string | null;
  geometry: { type: 'Point'; coordinates: [number, number] } | { type: 'LineString'; coordinates: [number, number][]; simplifiedFromPoints?: number } | null;
  region: string | null; regionAssignment: string | null; basin: string | null;
  osm: { type: string; id: number; url: string } | null;
  connectivity: { status: string; note: string };
  designTotalMillionM3?: number | null;
};
export type FoundationSeries = {
  id: string; sourceDataset: string; country?: string; geography: string; region?: string;
  point?: { latitude: number; longitude: number };
  indicator: string; unit: string; measurementKind: string;
  values: Record<string, unknown>[]; provenance: Record<string, unknown>;
};
export type RegionInfo = {
  id: string; osmType: string; osmId: number; nameEn: string | null; nameSource: string; nameRu: string | null;
  adminLevel: string; centre: { latitude: number; longitude: number } | null;
  bbox: [number, number, number, number] | null; bboxSource: string | null; wikidata: string | null;
  polygon?: [number, number][][] | null; polygonSourcePoints?: number;
};
const REGION_ALIASES: Record<string, string> = {
  Samarkand: 'Samarqand Region', Surkhandarya: 'Surxondaryo Region', Khorezm: 'Xorazm Region', Navoi: 'Navoiy Region',
  Kashkadarya: 'Qashqadaryo Region', Fergana: 'Fergana Region', Jizzakh: 'Jizzakh Region', Bukhara: 'Bukhara Region', Tashkent: 'Tashkent Region',
};

export const foundationRegions = (regionsJson as unknown as { regions: RegionInfo[] }).regions;
export const foundationCatalog = catalogJson as unknown as { datasets: Record<string, unknown>[]; measurementKinds: string[] };
export const foundationConflicts = conflictsJson as unknown as { entries: Record<string, unknown>[] };
export const foundationSeries = (seriesJson as unknown as { series: FoundationSeries[] }).series;

type OsmFeature = FoundationFeature & { tags?: unknown };
const osmFeatures = (osmJson as unknown as { features: OsmFeature[] }).features;

export const foundationFeatures: FoundationFeature[] = [
  ...waterSources.map((r): FoundationFeature => ({
    id: r.id, sourceDataset: 'cawater-reservoirs-uz', category: r.kind === 'reservoir' ? 'water-body' : 'waterway', kind: r.kind,
    nameEn: r.nameEn, nameSource: r.nameSource,
    geometry: r.location ? { type: 'Point', coordinates: [r.location.longitude, r.location.latitude] } : null,
    region: r.region ? REGION_ALIASES[r.region] ?? r.region : null, regionAssignment: r.region ? `source-stated-region (source spelling: ${r.region})` : null, basin: r.basin,
    osm: r.osm, connectivity: { status: 'basin-assigned-from-named-water-source', note: 'Basin label derives from the water source named by CAWater. It is not a surveyed upstream/downstream trace.' },
    designTotalMillionM3: r.storage?.designTotalMillionM3 ?? null,
  })),
  ...osmFeatures.map((f): FoundationFeature => ({
    id: f.id, sourceDataset: f.sourceDataset, category: f.category, kind: f.kind,
    nameEn: f.nameEn, nameSource: f.nameSource, geometry: f.geometry,
    region: f.region, regionAssignment: f.regionAssignment, basin: f.basin,
    osm: f.osm, connectivity: f.connectivity,
  })),
].sort((a, b) => a.id < b.id ? -1 : 1);

// ------------------------------------------------------------- spatial index
/** Uniform grid index over feature anchor points (Point location, or LineString bbox centre). Bbox queries check indexed candidates against exact geometry bounds, so results equal a brute-force scan. */
export class GridIndex {
  readonly cellDeg: number;
  private cells = new Map<string, FoundationFeature[]>();
  constructor(features: FoundationFeature[], cellDeg = 0.5) {
    this.cellDeg = cellDeg;
    for (const f of features) {
      const box = geometryBbox(f);
      if (!box) continue;
      const [x0, y0, x1, y1] = box;
      for (let cx = Math.floor(x0 / cellDeg); cx <= Math.floor(x1 / cellDeg); cx++) {
        for (let cy = Math.floor(y0 / cellDeg); cy <= Math.floor(y1 / cellDeg); cy++) {
          const key = `${cx},${cy}`;
          const list = this.cells.get(key) ?? [];
          list.push(f); this.cells.set(key, list);
        }
      }
    }
  }
  bboxQuery(bbox: [number, number, number, number]): FoundationFeature[] {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const seen = new Set<string>(), out: FoundationFeature[] = [];
    for (let cx = Math.floor(minLon / this.cellDeg); cx <= Math.floor(maxLon / this.cellDeg); cx++) {
      for (let cy = Math.floor(minLat / this.cellDeg); cy <= Math.floor(maxLat / this.cellDeg); cy++) {
        for (const f of this.cells.get(`${cx},${cy}`) ?? []) {
          if (seen.has(f.id)) continue;
          seen.add(f.id);
          const box = geometryBbox(f);
          if (box && box[0] <= maxLon && box[2] >= minLon && box[1] <= maxLat && box[3] >= minLat) out.push(f);
        }
      }
    }
    return out.sort((a, b) => a.id < b.id ? -1 : 1);
  }
  get size(): number { return this.cells.size; }
}
const geometryBounds = new WeakMap<FoundationFeature, [number, number, number, number]>();
export function geometryBbox(f: FoundationFeature): [number, number, number, number] | null {
  if (!f.geometry) return null;
  const cached = geometryBounds.get(f); if (cached) return cached;
  if (f.geometry.type === 'Point') { const [x, y] = f.geometry.coordinates; return [x, y, x, y]; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of f.geometry.coordinates) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const bounds: [number, number, number, number] = [x0, y0, x1, y1];
  geometryBounds.set(f, bounds);
  return bounds;
}
export const foundationIndex = new GridIndex(foundationFeatures);

const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
};
/** Nearest Point features by haversine distance. This is geographic proximity only; it does not imply hydraulic connectivity. */
export function nearestFeatures(latitude: number, longitude: number, k = 5): { feature: FoundationFeature; distanceKm: number }[] {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Invalid coordinates');
  if (!Number.isInteger(k) || k < 1 || k > 100) throw new Error('k must be an integer in 1..100');
  return foundationFeatures
    .filter(f => f.geometry?.type === 'Point')
    .map(f => { const c = f.geometry!.coordinates as unknown as [number, number]; return { feature: f, distanceKm: haversineKm(latitude, longitude, c[1], c[0]) }; })
    .sort((a, b) => a.distanceKm - b.distanceKm || (a.feature.id < b.feature.id ? -1 : 1))
    .slice(0, k);
}

/** Distance from a point to a lon/lat segment, in km, via a local equirectangular frame centred on the query point. */
export function pointToSegmentKm(latitude: number, longitude: number, a: [number, number], b: [number, number], kx = 111.32 * Math.cos((latitude * Math.PI) / 180)): number {
  const ky = 110.57;
  const px = 0, py = 0;
  const ax = (a[0] - longitude) * kx, ay = (a[1] - latitude) * ky;
  const bx = (b[0] - longitude) * kx, by = (b[1] - latitude) * ky;
  const vx = bx - ax, vy = by - ay;
  const t = vx * vx + vy * vy === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/**
 * Nearest water features including rivers/canals as lines (audit G03).
 * `distanceKind` distinguishes a point structure from the closest point on a
 * mapped line. Proximity only — never hydraulic connectivity or water access.
 */
export function nearestWaterFeatures(latitude: number, longitude: number, k = 5): { feature: FoundationFeature; distanceKm: number; distanceKind: 'point' | 'line-segment' }[] {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('Invalid coordinates');
  if (!Number.isInteger(k) || k < 1 || k > 100) throw new Error('k must be an integer in 1..100');
  const out: { feature: FoundationFeature; distanceKm: number; distanceKind: 'point' | 'line-segment' }[] = [];
  const kx = 111.32 * Math.cos((latitude * Math.PI) / 180);
  const order = (a: typeof out[number], b: typeof out[number]) => a.distanceKm - b.distanceKm || (a.feature.id < b.feature.id ? -1 : 1);
  for (const f of foundationFeatures) {
    if (!f.geometry) continue;
    if (f.geometry.type === 'Point') {
      const c = f.geometry.coordinates;
      out.push({ feature: f, distanceKm: haversineKm(latitude, longitude, c[1], c[0]), distanceKind: 'point' });
    } else {
      const coords = f.geometry.coordinates;
      // A line cannot be closer than its bounding rectangle in the SAME local
      // projection used below. Strict > preserves exact ties and ordering.
      if (coords.length > 1 && out.length === k) {
        const box = geometryBbox(f)!;
        const dx = Math.max(box[0] - longitude, 0, longitude - box[2]) * Math.abs(kx);
        const dy = Math.max(box[1] - latitude, 0, latitude - box[3]) * 110.57;
        if (Math.hypot(dx, dy) > out[k - 1].distanceKm) continue;
      }
      let best = Infinity;
      for (let i = 0; i < coords.length - 1; i++) best = Math.min(best, pointToSegmentKm(latitude, longitude, coords[i], coords[i + 1], kx));
      if (coords.length === 1) best = haversineKm(latitude, longitude, coords[0][1], coords[0][0]);
      out.push({ feature: f, distanceKm: best, distanceKind: 'line-segment' });
    }
    out.sort(order); if (out.length > k) out.length = k;
  }
  return out;
}

// ------------------------------------------------------------------- queries
export type FeatureQuery = { q?: string; category?: string; kind?: string; region?: string; basin?: string; sourceDataset?: string; bbox?: [number, number, number, number]; limit?: number; offset?: number };
const norm = (s: string): string => s.toLowerCase().replace(/['’`]/g, '').replace(/\s+/g, ' ').trim();
function validateLimitOffset(limit?: number, offset?: number): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) throw new Error('limit must be an integer in 1..1000');
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) throw new Error('offset must be a non-negative integer');
}
export function searchFeatures(query: FeatureQuery = {}): { total: number; results: FoundationFeature[] } {
  validateLimitOffset(query.limit, query.offset);
  let results = query.bbox ? foundationIndex.bboxQuery(validateBbox(query.bbox)) : [...foundationFeatures];
  if (query.q) { const n = norm(query.q); results = results.filter(f => (f.nameEn && norm(f.nameEn).includes(n)) || (f.nameSource && norm(f.nameSource).includes(n)) || norm(f.id).includes(n)); }
  if (query.category) results = results.filter(f => f.category === query.category);
  if (query.kind) results = results.filter(f => f.kind === query.kind);
  if (query.sourceDataset) results = results.filter(f => f.sourceDataset === query.sourceDataset);
  if (query.region) results = results.filter(f => f.region !== null && norm(f.region) === norm(query.region!));
  if (query.basin) results = results.filter(f => f.basin !== null && norm(f.basin) === norm(query.basin!));
  const total = results.length, offset = query.offset ?? 0;
  return { total, results: results.slice(offset, offset + (query.limit ?? 200)) };
}
export function validateBbox(b: [number, number, number, number]): [number, number, number, number] {
  if (!Array.isArray(b) || b.length !== 4 || b.some(v => typeof v !== 'number' || !Number.isFinite(v)) || b[0] > b[2] || b[1] > b[3] || b[0] < -180 || b[2] > 180 || b[1] < -90 || b[3] > 90) throw new Error('bbox must be [minLon, minLat, maxLon, maxLat] within valid ranges');
  return b;
}
export function featuresGeoJson(query: FeatureQuery = {}): { type: 'FeatureCollection'; total: number; returned: number; offset: number; limit: number; nextOffset: number | null; truncated: boolean; features: { type: 'Feature'; geometry: FoundationFeature['geometry']; properties: Record<string, unknown> }[]; excludedWithoutGeometry: string[] } {
  // Honest pagination (audit G01): the caller's limit/offset are honoured
  // (page size capped at 1000) and completeness is explicit via total/nextOffset.
  const limit = Math.min(1000, query.limit ?? 1000), offset = query.offset ?? 0;
  const { total, results } = searchFeatures({ ...query, limit, offset });
  const withGeometry = results.filter(f => f.geometry !== null);
  const nextOffset = offset + results.length < total ? offset + results.length : null;
  return {
    type: 'FeatureCollection', total, returned: withGeometry.length, offset, limit, nextOffset, truncated: nextOffset !== null,
    features: withGeometry.map(f => ({
      type: 'Feature', geometry: f.geometry,
      properties: { id: f.id, sourceDataset: f.sourceDataset, category: f.category, kind: f.kind, name: f.nameEn ?? f.nameSource, region: f.region, basin: f.basin, connectivityStatus: f.connectivity.status, osmUrl: f.osm?.url ?? null, designTotalMillionM3: f.designTotalMillionM3 ?? null },
    })),
    excludedWithoutGeometry: results.filter(f => f.geometry === null).map(f => f.id),
  };
}
export type SeriesQuery = { sourceDataset?: string; country?: string; region?: string; geography?: string; measurementKind?: string; q?: string };
export function searchSeries(query: SeriesQuery = {}): FoundationSeries[] {
  let results = [...foundationSeries];
  if (query.sourceDataset) results = results.filter(s => s.sourceDataset === query.sourceDataset);
  if (query.country) results = results.filter(s => s.country !== undefined && norm(s.country) === norm(query.country!));
  if (query.region) results = results.filter(s => s.region !== undefined && norm(s.region) === norm(query.region!));
  if (query.geography) results = results.filter(s => s.geography === query.geography);
  if (query.measurementKind) results = results.filter(s => s.measurementKind === query.measurementKind);
  if (query.q) { const n = norm(query.q); results = results.filter(s => norm(s.indicator).includes(n) || norm(s.id).includes(n)); }
  return results.sort((a, b) => a.id < b.id ? -1 : 1);
}
export function regionSummary(): { region: RegionInfo; featureCount: number; byKind: Record<string, number> }[] {
  const grouped = new Map<string, FoundationFeature[]>();
  for (const feature of foundationFeatures) {
    if (feature.region === null) continue;
    const key = norm(feature.region), group = grouped.get(key);
    if (group) group.push(feature); else grouped.set(key, [feature]);
  }
  return foundationRegions.map(region => {
    const name = region.nameEn ?? region.nameSource;
    const inRegion = grouped.get(norm(name)) ?? [];
    const byKind: Record<string, number> = {};
    for (const f of inRegion) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    return { region, featureCount: inRegion.length, byKind };
  });
}
