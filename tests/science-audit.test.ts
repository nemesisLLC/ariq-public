import test from 'node:test';
import assert from 'node:assert/strict';
import { penmanMonteithDetails, penmanMonteithET0, calculateFieldOutlook } from '../lib/irrigation/scheduler.ts';
import { simulateSeason, yieldByCropId, fao33RelativeYield } from '../lib/irrigation/season.ts';
import { fetchAnalogYear } from '../lib/irrigation/season-weather.ts';
import { ForecastCache, ForecastUnavailableError, recommend } from '../lib/irrigation/recommendation.ts';
import { featuresGeoJson, nearestWaterFeatures, foundationFeatures } from '../lib/data-foundation.ts';
import { lonLatToWorld, validateFarmPolygon, interiorPoint, pointInRing } from '../app/atlas/geo.ts';

const provider = (dates: string[]) => ({
  latitude: 39.68, longitude: 66.98, timezone: 'Asia/Samarkand',
  daily_units: { rain_sum: 'mm', showers_sum: 'mm', et0_fao_evapotranspiration: 'mm' },
  daily: { time: dates, temperature_2m_max: dates.map(() => 34), temperature_2m_min: dates.map(() => 20), precipitation_sum: dates.map(() => 0), rain_sum: dates.map(() => 0), showers_sum: dates.map(() => 0), et0_fao_evapotranspiration: dates.map(() => 6) },
});
const fetcherFor = (payload: unknown) => (async () => Response.json(payload)) as unknown as typeof fetch;

test('M02: FAO-56 Eq.39 relative radiation is capped at 1', () => {
  const d = penmanMonteithDetails({ date: '2026-01-15', latitudeDeg: 45, elevationM: 300, tmaxC: 2, tminC: -4, windMPerS: 2, solarRadiationMJm2Day: 50, dewpointC: -6 });
  assert.ok(Number.isFinite(d.et0MmPerDay) && d.et0MmPerDay >= 0);
  // With Rs >> Rso the longwave factor uses the capped ratio (1.35*1-0.35 = 1.0), so net radiation stays bounded.
  assert.ok(d.netRadiationMJm2Day < 39, `net radiation ${d.netRadiationMJm2Day}`);
});

test('FAO-56 published benchmark: Uccle 6 July ET0 ~3.88 mm/day (FAO-56 Example 18)', () => {
  const et0 = penmanMonteithET0({ date: '2026-07-06', latitudeDeg: 50.8, elevationM: 100, tmaxC: 21.5, tminC: 12.3, windMPerS: 2.078, solarRadiationMJm2Day: 22.07, rhMaxPct: 84, rhMinPct: 63 });
  assert.ok(Math.abs(et0 - 3.88) < 0.05, `ET0 ${et0}`);
});

test('M01: actual ET is bounded by available water and daily mass conserves exactly', () => {
  const field = {
    id: 'tiny', nodeId: 'tiny', areaHa: 1, applicationEfficiency: 0.8, priority: 1, kc: 1,
    soil: { fieldCapacity: 0.12, wiltingPoint: 0.05, rootDepthM: 0.1, depletionFraction: 0.5, initialDepletionMm: 5.5, targetDepletionFraction: 0 },
  };
  const outlook = calculateFieldOutlook(field as never, [{ date: '2026-07-01', rainMm: 0, et0Mm: 6 }], 0.8);
  const d = outlook.dailyNoIrrigation[0];
  // TAW = 7 mm, start Dr 5.5 -> only 1.5 mm can evaporate.
  assert.ok(Math.abs(d.etCropMm - 1.5) < 1e-9, `ETa ${d.etCropMm}`);
  assert.equal(d.etLimitedByAvailableWater, true);
  const residual = d.startDepletionMm + d.etCropMm - d.effectiveRainMm - d.irrigationRootZoneMm + d.drainageMm - d.endDepletionMm;
  assert.ok(Math.abs(residual) < 1e-9, `residual ${residual}`);
});

test('M01/M09 season: daily conservation holds and stage-product factors are clamped', () => {
  const days = 180;
  const weather = Array.from({ length: days }, (_, i) => ({ date: new Date(Date.parse('2026-04-01T00:00:00Z') + i * 86400000).toISOString().slice(0, 10), et0Mm: 6, rainMm: 0 }));
  const r = simulateSeason({
    cropId: 'cotton', areaHa: 1, applicationEfficiency: 0.8, soilKind: 'user-supplied',
    soil: { fieldCapacity: 0.30, wiltingPoint: 0.10, rootDepthM: 0.5, depletionFraction: 0.5, targetDepletionFraction: 0.2, initialDepletionMm: 99 },
    weather, weatherKind: 'user-supplied', strategy: { seasonSupplyM3: 0 }, kyByStage: [3, 3, 0, 0],
  });
  for (const d of r.daily) {
    const residual = d.startDepletionMm + d.etCropAdjMm - d.effectiveRainMm - d.irrigationNetMm + d.drainageMm - d.endDepletionMm;
    assert.ok(Math.abs(residual) < 1e-9, `day ${d.date} residual ${residual}`);
  }
  assert.ok(r.yieldImpact.relativeYieldRetained >= 0 && r.yieldImpact.relativeYieldRetained <= 1);
  assert.equal(r.yieldImpact.relativeYieldRetained, 0); // full deficit in stages 1-2 with Ky 3 clamps to 0, never negative or >1 via product
});

test('M06: winter wheat Ky is the FAO-66 Table 1 value 1.05', () => {
  assert.equal(yieldByCropId.get('winter-wheat')!.kySeasonal, 1.05);
  assert.ok(Math.abs(fao33RelativeYield(1.05, 80, 100) - 0.79) < 1e-12);
});

test('M04/M05: analog seasons preserve provider calendar across New Year and reject missing rain', async () => {
  const dates = ['2020-12-30', '2020-12-31', '2021-01-01'];
  let seenUrl = '';
  const fetcher = (async (url: unknown) => { seenUrl = String(url); return Response.json(provider(dates)); }) as unknown as typeof fetch;
  const out = await fetchAnalogYear(39.65, 66.96, '2026-12-30', 3, 2020, fetcher);
  assert.deepEqual(out.weather.map(w => w.date), dates);
  assert.match(seenUrl, /models=era5/);
  const missing = provider(dates) as never as { daily: { rain_sum: unknown[] } };
  (missing.daily as { rain_sum: unknown[] }).rain_sum = [null, 0, 0];
  await assert.rejects(fetchAnalogYear(39.65, 66.96, '2026-12-30', 3, 2020, fetcherFor(missing)), /Missing rainfall/);
});

test('M07: minimum farmer inputs work without applicationEfficiency; gross volumes stay null', async () => {
  const dates = Array.from({ length: 7 }, (_, i) => `2026-07-0${i + 1}`);
  const r = await recommend(
    { latitude: 39.65, longitude: 66.96, cropId: 'cotton', areaHa: 2, plantingDate: '2026-07-01' },
    { fetcher: fetcherFor(provider(dates)), cache: new ForecastCache() },
  );
  assert.equal(r.calculationTier, 'demand-only');
  assert.ok(r.missingInputs.some(m => m.field === 'applicationEfficiency'));
  assert.ok((r.demand?.totalEtCropMm ?? 0) > 0);
});

test('M08: stale forecast older than the hard cutoff or fully expired is rejected', async () => {
  const dates = Array.from({ length: 7 }, (_, i) => `2026-07-0${i + 1}`);
  const cache = new ForecastCache();
  const down = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
  const input = { latitude: 39.65, longitude: 66.96, cropId: 'cotton', areaHa: 2, plantingDate: '2026-07-01', applicationEfficiency: 0.75 };
  const t0 = Date.parse('2026-07-01T00:00:00Z');
  await recommend(input, { fetcher: fetcherFor(provider(dates)), cache, nowMs: t0 });
  // 5h later, provider down: stale allowed
  const stale = await recommend(input, { fetcher: down, cache, nowMs: t0 + 5 * 3600000 });
  assert.equal(stale.provenance.weather.cacheStatus, 'stale-after-failure');
  assert.equal(stale.provenance.weather.validThrough, '2026-07-07');
  // 7h later: beyond hard cutoff
  await assert.rejects(recommend(input, { fetcher: down, cache, nowMs: t0 + 7 * 3600000 }), ForecastUnavailableError);
});

test('G01: GeoJSON pagination is complete and non-overlapping', () => {
  const page1 = featuresGeoJson({ kind: 'river', limit: 1000, offset: 0 });
  assert.ok(page1.total > 1000, `total ${page1.total}`);
  assert.equal(page1.nextOffset, 1000);
  assert.equal(page1.truncated, true);
  const page2 = featuresGeoJson({ kind: 'river', limit: 1000, offset: page1.nextOffset! });
  const ids1 = new Set(page1.features.map(f => f.properties.id));
  assert.ok(page2.features.every(f => !ids1.has(f.properties.id as string)));
  assert.ok(page1.features.length + page2.features.length <= page1.total);
});

test('G03: nearest water includes line features with segment distance', () => {
  const line = foundationFeatures.find(f => f.geometry?.type === 'LineString' && (f.geometry.coordinates as [number, number][]).length >= 4)!;
  const coords = line.geometry!.coordinates as unknown as [number, number][];
  const mid = coords[Math.floor(coords.length / 2)];
  const results = nearestWaterFeatures(mid[1] + 0.01, mid[0], 5);
  assert.ok(results[0].distanceKm < 2, `distance ${results[0].distanceKm}`);
  assert.ok(results.some(r => r.distanceKind === 'line-segment'));
});

test('G02: projection east/north scale ratio equals cos(centre latitude)', () => {
  const [x0, z0] = lonLatToWorld(64.62, 41.32);
  const [x1] = lonLatToWorld(65.62, 41.32);
  const [, z1] = lonLatToWorld(64.62, 42.32);
  const ratio = Math.abs(x1 - x0) / Math.abs(z1 - z0);
  assert.ok(Math.abs(ratio - Math.cos((41.32 * Math.PI) / 180)) < 0.01, `ratio ${ratio}`);
});

test('G05: bow-tie polygons are rejected and concave fields get an interior point', () => {
  const bowtie: [number, number][] = [[66.9, 39.6], [67.0, 39.7], [66.9, 39.7], [67.0, 39.6]];
  assert.equal(validateFarmPolygon(bowtie).ok, false);
  const square: [number, number][] = [[66.9, 39.6], [67.0, 39.6], [67.0, 39.7], [66.9, 39.7]];
  assert.equal(validateFarmPolygon(square).ok, true);
  const uShape: [number, number][] = [[66.9, 39.6], [67.0, 39.6], [67.0, 39.7], [66.97, 39.7], [66.97, 39.64], [66.93, 39.64], [66.93, 39.7], [66.9, 39.7]];
  const p = interiorPoint(uShape);
  assert.equal(pointInRing(p[0], p[1], [...uShape, uShape[0]]), true, `interior ${p}`);
});
