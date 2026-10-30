import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFarmProfile } from '../lib/farm-profile.ts';
import { ForecastCache } from '../lib/irrigation/recommendation.ts';

function provider(et0 = 6, rain = 0, lat = 39.68, lon = 66.98) {
  return {
    latitude: lat, longitude: lon, timezone: 'Asia/Samarkand',
    daily_units: { rain_sum: 'mm', showers_sum: 'mm', et0_fao_evapotranspiration: 'mm' },
    daily: {
      time: Array.from({ length: 7 }, (_, i) => `2026-07-0${i + 1}`),
      temperature_2m_max: Array(7).fill(34), temperature_2m_min: Array(7).fill(20),
      precipitation_sum: Array(7).fill(rain), rain_sum: Array(7).fill(rain), showers_sum: Array(7).fill(0),
      et0_fao_evapotranspiration: Array(7).fill(et0),
    },
  };
}
const fetcherFor = (payload: unknown) => (async () => Response.json(payload)) as unknown as typeof fetch;
const down = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
// Soil-moisture archive is offline-mocked as unavailable in these tests;
// Phase 3 scenario behaviour is covered in tests/soil-moisture.test.ts.
const opts = (payload: unknown = provider()) => ({ fetcher: fetcherFor(payload), cache: new ForecastCache(), soilMoistureFetcher: down });

// Farm block south-west of Samarkand with full SoilGrids coverage
// (16 valid cells, coverage 1.0; verified against the Phase 2 grid).
const POLYGON: [number, number][] = [[66.80, 39.55], [66.84, 39.55], [66.84, 39.59], [66.80, 39.59]];
const BASE = { latitude: 39.57, longitude: 66.82, cropId: 'cotton', plantingDate: '2026-07-01' };

test('unified profile: polygon farm gets evidence, auto soil, irrigation demand and seeding rate', async () => {
  const p = await buildFarmProfile({ ...BASE, polygon: POLYGON, seedQuantityKg: 90000 }, opts());
  assert.equal(p.kind, 'unified-farm-profile');
  // Area from the drawn polygon, not invented.
  assert.equal(p.area.source, 'polygon-geodesic');
  assert.ok(p.area.areaHa! > 1400 && p.area.areaHa! < 1700, `areaHa ${p.area.areaHa}`);
  assert.match(p.area.note, /NOT an officially surveyed cadastral parcel/);
  // Phase 2 soil evidence is connected, labelled modelled.
  assert.ok(p.evidence.soil);
  assert.equal(p.evidence.soil.estimateBasis, 'soilgrids-grid-polygon');
  assert.equal(p.evidence.groundwater.depthToWaterM, null);
  // Automatic soil fed to the existing engine: modelled FC/WP + FAO-56 Table 22 references.
  assert.ok(p.autoSoilForIrrigation);
  assert.equal(p.autoSoilForIrrigation.kind, 'modeled-soil-plus-crop-reference');
  assert.equal(p.autoSoilForIrrigation.measured, false);
  assert.equal(p.autoSoilForIrrigation.rootDepthM, 1.35); // cotton FAO-56 Table 22 midpoint
  assert.equal(p.autoSoilForIrrigation.depletionFraction, 0.65);
  // Irrigation comes from the existing Feature 4/1 engine on forecast weather.
  assert.equal(p.irrigationStatus, 'calculated');
  assert.ok(p.irrigation);
  assert.ok((p.irrigation.demand?.totalEtCropMm ?? 0) > 0);
  // Current depletion is honestly unknown, so the engine stays demand-tier.
  assert.ok(p.irrigation.missingInputs.some((m) => m.field === 'soil.initialDepletionMm'));
  // Crop calendar + FAO-33 sensitivity from existing references.
  assert.equal(p.planting.stageCalendar.length, 4);
  assert.equal(p.planting.stageCalendar[0].startDate, '2026-07-01');
  assert.equal(p.planting.seasonLengthDays, 180); // cotton 30+50+55+45
  assert.equal(p.crop.yieldSensitivity?.kySeasonal, 0.85);
  // Seeding rate is pure arithmetic against the polygon area.
  const s = p.planting.seeding;
  assert.equal(s.quantityKg, 90000);
  assert.ok(Math.abs(s.seedingRateKgPerHa! - 90000 / p.area.areaHa!) < 1e-9);
  assert.deepEqual(s.referenceRangeKgPerHa, [40, 80]);
  assert.equal(s.assessment, 'within-reference-range');
  assert.equal(s.affectsIrrigationCalculations, false);
});

test('seed quantity never changes irrigation calculations', async () => {
  const withSeed = await buildFarmProfile({ ...BASE, polygon: POLYGON, seedQuantityKg: 10000 }, opts());
  const withoutSeed = await buildFarmProfile({ ...BASE, polygon: POLYGON }, opts());
  const heavySeed = await buildFarmProfile({ ...BASE, polygon: POLYGON, seedQuantityKg: 99999 }, opts());
  // Compare the calculated content (provenance timestamps legitimately differ).
  const calc = (p: Awaited<ReturnType<typeof buildFarmProfile>>) => p.irrigation && {
    tier: p.irrigation.calculationTier, demand: p.irrigation.demand, forecastDays: p.irrigation.forecastDays,
    outlook: p.irrigation.outlook, schedule: p.irrigation.schedule, missingInputs: p.irrigation.missingInputs,
  };
  assert.deepEqual(calc(withSeed), calc(withoutSeed));
  assert.deepEqual(calc(heavySeed), calc(withoutSeed));
  assert.notEqual(withSeed.planting.seeding.seedingRateKgPerHa, heavySeed.planting.seeding.seedingRateKgPerHa);
});

test('point-only farm: area, volumes and seeding rate stay honestly unknown', async () => {
  const p = await buildFarmProfile({ ...BASE, seedQuantityKg: 500 }, opts());
  assert.equal(p.area.areaHa, null);
  assert.equal(p.area.source, 'unknown-point-only');
  assert.equal(p.planting.seeding.assessment, 'area-unknown');
  assert.equal(p.planting.seeding.seedingRateKgPerHa, null);
  assert.ok(p.irrigation, 'millimetre demand still calculated without area');
  assert.equal(p.irrigation.demand?.totalGrossDemandM3 ?? null, null);
  assert.ok(p.unknowns.some((u) => u.field === 'farm.areaHa'));
  assert.ok(p.unknowns.some((u) => u.field === 'groundwater.depthToWaterM'));
  assert.ok(p.unknowns.some((u) => u.field === 'water.supplyAndConnectivity'));
});

test('different crops change calendar, soil references and sensitivity — not just the label', async () => {
  const cotton = await buildFarmProfile({ ...BASE, polygon: POLYGON }, opts());
  const wheat = await buildFarmProfile({ ...BASE, cropId: 'winter-wheat', plantingDate: '2026-07-01', polygon: POLYGON }, opts());
  assert.notDeepEqual(cotton.planting.stageCalendar, wheat.planting.stageCalendar);
  assert.equal(wheat.planting.stageCalendar[0].days, 20); // wheat initial stage vs cotton 30
  assert.equal(wheat.autoSoilForIrrigation?.rootDepthM, 1.65);
  assert.equal(wheat.autoSoilForIrrigation?.depletionFraction, 0.55);
  assert.equal(wheat.crop.yieldSensitivity?.kySeasonal, 1.05);
  assert.equal(wheat.crop.yieldSensitivity?.band, 'moderate');
  assert.notDeepEqual(cotton.irrigation?.forecastDays, wheat.irrigation?.forecastDays);
});

test('forecast failure degrades to evidence-only profile without invented weather', async () => {
  const p = await buildFarmProfile({ ...BASE, polygon: POLYGON }, { fetcher: down, cache: new ForecastCache() });
  assert.equal(p.irrigationStatus, 'forecast-unavailable');
  assert.equal(p.irrigation, null);
  assert.ok(p.evidence.soil, 'evidence still assembled');
  assert.ok(p.warnings.includes('warning.forecast-unavailable-no-weather-invented'));
  assert.equal(p.connectedSystems.find((s) => s.id === 'feature4-recommendation')?.status, 'unavailable');
});

test('farmer-supplied initial depletion unlocks stress outlook through the same engine', async () => {
  const p = await buildFarmProfile({ ...BASE, polygon: POLYGON, initialDepletionMm: 50, applicationEfficiency: 0.75 }, opts());
  assert.ok(p.irrigation);
  assert.equal(p.irrigation.calculationTier, 'demand-and-stress-no-schedule');
  assert.ok(p.irrigation.outlook, 'stress outlook present with an assumed initial depletion');
  // Supply still unknown: no feasible schedule is claimed.
  assert.equal(p.irrigation.schedule, null);
  assert.ok(p.irrigation.missingInputs.some((m) => m.field === 'supply'));
});

test('polygon-only selection derives the representative point from the area centroid', async () => {
  const p = await buildFarmProfile({ cropId: 'maize', plantingDate: '2026-07-01', polygon: POLYGON }, opts());
  assert.equal(p.location.representativePointSource, 'polygon-area-centroid');
  assert.ok(Math.abs(p.location.latitude - 39.57) < 0.001 && Math.abs(p.location.longitude - 66.82) < 0.001);
  assert.equal(p.evidence.location.latitude, p.location.latitude);
});

test('invalid unified-profile inputs are rejected', async () => {
  await assert.rejects(buildFarmProfile({ ...BASE, cropId: 'quinoa' }, opts()), /cropId/);
  await assert.rejects(buildFarmProfile({ ...BASE, plantingDate: '2026-02-30' }, opts()), /plantingDate/);
  await assert.rejects(buildFarmProfile({ ...BASE, seedQuantityKg: -5 }, opts()), /seedQuantityKg/);
  await assert.rejects(buildFarmProfile({ cropId: 'cotton', plantingDate: '2026-07-01' }, opts()), /latitude\/longitude or a polygon/);
  await assert.rejects(buildFarmProfile({ ...BASE, polygon: [[66.9, 39.6]] as [number, number][] }, opts()), /polygon/);
});

test('water impact converts engine demand to farmer volumes without inventing savings', async () => {
  const p = await buildFarmProfile({ ...BASE, polygon: POLYGON, seedQuantityKg: 90000 }, opts());
  const w = p.waterImpact;
  assert.equal(w.windowDays, 7);
  // Mock forecast: ET0 6 mm/day x cotton initial Kc 0.35 = 2.1 mm/day ETc.
  assert.ok(Math.abs(w.etCropMm! - 14.7) < 0.6, `ETc ${w.etCropMm}`);
  assert.equal(w.forecastRainMm, 0);
  assert.ok(w.netDemandMm! > 0);
  assert.ok(Math.abs(w.netDemandM3PerHa! - w.netDemandMm! * 10) < 1e-9, '1 mm/ha = 10 m3 conversion');
  assert.ok(Math.abs(w.farmNetDemandM3! - w.netDemandM3PerHa! * p.area.areaHa!) < 1e-6);
  assert.match(w.basis, /No water-saving claim/);
  // Rainy forecast triggers the delay-irrigation advisory; dry does not.
  const rainy = await buildFarmProfile({ ...BASE, polygon: POLYGON }, opts(provider(6, 3)));
  assert.equal(rainy.waterImpact.forecastRainMm, 21);
  assert.ok(rainy.advisories.some((a) => a.id === 'advisory.rain-in-forecast-delay-irrigation-check'));
  assert.ok(!p.advisories.some((a) => a.id === 'advisory.rain-in-forecast-delay-irrigation-check'));
  assert.ok(p.advisories.some((a) => a.id === 'advisory.groundwater-and-supply-unverified'));
});

test('stale planting date (season already completed) is flagged, not silently modelled', async () => {
  const p = await buildFarmProfile({ ...BASE, plantingDate: '2025-01-01', polygon: POLYGON }, opts());
  assert.ok(p.advisories.some((a) => a.id === 'advisory.planting-date-season-already-completed'));
  const current = await buildFarmProfile({ ...BASE, polygon: POLYGON }, opts());
  assert.ok(!current.advisories.some((a) => a.id === 'advisory.planting-date-season-already-completed'));
});

test('TerraPulse-populated depletion keeps its modelled provenance through the profile', async () => {
  const p = await buildFarmProfile({ ...BASE, polygon: POLYGON, initialDepletionMm: 120, initialDepletionSource: 'terraPulse-modelled-scenario', applicationEfficiency: 0.75 }, opts());
  const unknown = p.unknowns.find((u) => u.field === 'soil.initialDepletionMm');
  assert.match(unknown!.effect, /NOT measured soil moisture/);
  assert.match(unknown!.effect, /TerraPulse/);
  assert.ok(p.assumptions.some((a) => /TerraPulse ERA5-Land modelled scenario/.test(a) && /not measured soil moisture/.test(a)));
  const userEntered = await buildFarmProfile({ ...BASE, polygon: POLYGON, initialDepletionMm: 120, applicationEfficiency: 0.75 }, opts());
  assert.doesNotMatch(userEntered.unknowns.find((u) => u.field === 'soil.initialDepletionMm')!.effect, /automatically populated TerraPulse/);
});

test('tomato seeding has no fabricated reference rate', async () => {
  const p = await buildFarmProfile({ ...BASE, cropId: 'tomato', polygon: POLYGON, seedQuantityKg: 10 }, opts());
  assert.equal(p.planting.seeding.referenceRangeKgPerHa, null);
  assert.equal(p.planting.seeding.assessment, 'no-reference-range');
  assert.ok(p.planting.seeding.seedingRateKgPerHa! > 0, 'the farmer rate itself is still arithmetic');
  assert.match(p.planting.seeding.note, /transplanted/);
});
