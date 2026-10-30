/**
 * Verified Uzbekistan water-source database (Feature 2).
 *
 * Compiled from cited public sources (see water-sources-data.json and
 * docs/water-sources.md). Rules enforced here and in tests:
 * - Design capacity is never presented as measured storage.
 * - Modeled discharge is never presented as observed flow.
 * - Unknown values are null; coordinates are stored only where a named
 *   OpenStreetMap element was verified, otherwise null.
 * Outputs are GeoJSON-ready (Point features, [longitude, latitude]) so
 * MapLibre and Three.js can consume them without reshaping.
 */
import datasetJson from './water-sources-data.json' with { type: 'json' };

export type WaterKind = 'reservoir' | 'river';
export type Provenance = {
  sourceId: string; publisher?: string; url: string; retrievedAt: string;
  publicationDate: string | null; updatedAt?: string; license?: string; role?: string;
};
export type WaterSource = {
  id: string; kind: WaterKind; nameEn: string; nameSource: string;
  region: string | null; basin: string | null; waterSourceNames: string[];
  reservoirType: string | null; purposes: string[]; yearCommissioned: number | null;
  location: { latitude: number; longitude: number } | null;
  osm: { type: string; id: number; url: string } | null;
  geometryRef: string | null;
  storage: {
    kind: 'design-capacity'; designTotalMillionM3: number | null; activeMillionM3: number | null;
    deadMillionM3: number | null; measuredStorageMillionM3: number | null; measuredAsOf: string | null;
    normalLevelM: number | null; surfaceKm2: number | null; lengthKm: number | null;
  } | null;
  dam: { type: string | null; heightM: number | null; lengthM: number | null } | null;
  hydropowerDesignMW: number | null;
  discharge: { modeledMeanM3S: number | null; modeledKind: string; observedMeanM3S: number | null; observedAsOf: string | null } | null;
  provenance: Provenance[];
  quality: { coordinateStatus: string; capacityStatus: string; notes: string[] };
};
export type WaterStatistic = {
  id: string; indicator: string; unit: string; kind: string;
  values: { year: number; value: number }[]; provenance: Provenance[]; notes: string[];
};
export type WaterDataset = {
  dataset: string; version: number; generatedAt: string; kind: string; description: string;
  sources: { sourceId: string; publisher: string; url: string; retrievedAt: string; publicationDate: string | null }[];
  records: WaterSource[]; statistics: WaterStatistic[];
};

export const waterDataset = datasetJson as unknown as WaterDataset;
export const waterSources: WaterSource[] = waterDataset.records;
export const waterStatistics: WaterStatistic[] = waterDataset.statistics;

const byId = new Map(waterSources.map(r => [r.id, r]));

export function getWaterSource(id: string): WaterSource | null {
  return byId.get(id) ?? null;
}

export type WaterQuery = {
  q?: string; kind?: WaterKind; region?: string; basin?: string;
  bbox?: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  hasCoordinates?: boolean; limit?: number; offset?: number;
};
const norm = (s: string): string => s.toLowerCase().replace(/['’`]/g, '').replace(/\s+/g, ' ').trim();

export function searchWaterSources(query: WaterQuery = {}): { total: number; results: WaterSource[] } {
  if (query.q !== undefined && typeof query.q !== 'string') throw new Error('q must be a string');
  if (query.kind !== undefined && query.kind !== 'reservoir' && query.kind !== 'river') throw new Error('kind must be reservoir or river');
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500)) throw new Error('limit must be an integer in 1..500');
  if (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0)) throw new Error('offset must be a non-negative integer');
  if (query.bbox !== undefined) {
    const b = query.bbox;
    if (!Array.isArray(b) || b.length !== 4 || b.some(v => typeof v !== 'number' || !Number.isFinite(v)) || b[0] > b[2] || b[1] > b[3] || b[0] < -180 || b[2] > 180 || b[1] < -90 || b[3] > 90) throw new Error('bbox must be [minLon, minLat, maxLon, maxLat] within valid ranges');
  }
  let results = [...waterSources].sort((a, b) => a.id < b.id ? -1 : 1);
  if (query.q) {
    const needle = norm(query.q);
    results = results.filter(r => norm(r.nameEn).includes(needle) || norm(r.nameSource).includes(needle) || norm(r.id).includes(needle) || r.waterSourceNames.some(n => norm(n).includes(needle)));
  }
  if (query.kind) results = results.filter(r => r.kind === query.kind);
  if (query.region) results = results.filter(r => r.region !== null && norm(r.region) === norm(query.region!));
  if (query.basin) results = results.filter(r => r.basin !== null && norm(r.basin) === norm(query.basin!));
  if (query.bbox) {
    const [minLon, minLat, maxLon, maxLat] = query.bbox;
    results = results.filter(r => r.location !== null && r.location.longitude >= minLon && r.location.longitude <= maxLon && r.location.latitude >= minLat && r.location.latitude <= maxLat);
  }
  if (query.hasCoordinates !== undefined) results = results.filter(r => (r.location !== null) === query.hasCoordinates);
  const total = results.length;
  const offset = query.offset ?? 0;
  return { total, results: results.slice(offset, offset + (query.limit ?? 100)) };
}

/** GeoJSON FeatureCollection of Point features for records that have verified coordinates. Records without coordinates are listed in `excludedWithoutCoordinates`, never placed at a guessed position. */
export function waterSourcesGeoJson(query: WaterQuery = {}): {
  type: 'FeatureCollection';
  features: { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: Record<string, unknown> }[];
  excludedWithoutCoordinates: string[];
} {
  const { results } = searchWaterSources({ ...query, limit: 500, offset: 0 });
  const features = results.filter(r => r.location !== null).map(r => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [r.location!.longitude, r.location!.latitude] as [number, number] },
    properties: {
      id: r.id, kind: r.kind, name: r.nameEn, region: r.region, basin: r.basin,
      designTotalMillionM3: r.storage?.designTotalMillionM3 ?? null,
      storageKind: r.storage?.kind ?? null, measuredStorageMillionM3: r.storage?.measuredStorageMillionM3 ?? null,
      coordinateStatus: r.quality.coordinateStatus, osmUrl: r.osm?.url ?? null,
    },
  }));
  return { type: 'FeatureCollection', features, excludedWithoutCoordinates: results.filter(r => r.location === null).map(r => r.id) };
}
