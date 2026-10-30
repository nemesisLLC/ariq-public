import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchEra5LandSoilMoisture, estimateInitialDepletion } from '../lib/irrigation/soil-moisture.ts';
import { buildFarmProfile } from '../lib/farm-profile.ts';
import { ForecastCache } from '../lib/irrigation/recommendation.ts';

function archivePayload(theta = [0.20, 0.18, 0.16], days = ['2026-06-29', '2026-06-30', '2026-07-01']) {
  const time: string[] = [];
  const l1: number[] = [], l2: number[] = [], l3: number[] = [];
  for (const d of days) for (let h = 0; h < 24; h++) {
    time.push(`${d}T${String(h).padStart(2, '0')}:00`);
    l1.push(theta[0]); l2.push(theta[1]); l3.push(theta[2]);
  }
  return {
    latitude: 39.6, longitude: 67.0,
    hourly_units: { soil_moisture_0_to_7cm: 'm³/m³', soil_moisture_7_to_28cm: 'm³/m³', soil_moisture_28_to_100cm: 'm³/m³' },
    hourly: { time, soil_moisture_0_to_7cm: l1, soil_moisture_7_to_28cm: l2, soil_moisture_28_to_100cm: l3 },
  };
}
const fetcherFor = (payload: unknown) => (async () => Response.json(payload)) as unknown as typeof fetch;
const NOW = Date.parse('2026-07-01T12:00:00.000Z');

test('ERA5-Land fetch daily-averages layers and picks the latest complete day', async () => {
  const sm = await fetchEra5LandSoilMoisture(39.57, 66.82, { fetcher: fetcherFor(archivePayload()), nowMs: NOW });
  assert.equal(sm.kind, 'modeled-reanalysis');
  assert.equal(sm.model, 'ERA5-Land (ECMWF)');
  assert.equal(sm.dataDate, '2026-07-01');
  assert.equal(sm.lagDays, 0);
  assert.deepEqual(sm.layers.map((l) => l.depthCm), ['0-7', '7-28', '28-100']);
  assert.ok(Math.abs(sm.layers[0].thetaM3M3 - 0.20) < 1e-9);
  assert.equal(sm.grid.latitude, 39.6);
});

test('ERA5-Land fetch refuses incomplete data instead of treating gaps as zero', async () => {
  const bad = archivePayload();
  bad.hourly.soil_moisture_7_to_28cm = bad.hourly.soil_moisture_7_to_28cm.slice(0, 10);
  await assert.rejects(fetchEra5LandSoilMoisture(39.57, 66.82, { fetcher: fetcherFor(bad), nowMs: NOW }), /missing or incomplete/);
  const down = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
  await assert.rejects(fetchEra5LandSoilMoisture(39.57, 66.82, { fetcher: down, nowMs: NOW }), /down/);
});

const LAYERS = [
  { topCm: 0, bottomCm: 7, thetaM3M3: 0.20 },
  { topCm: 7, bottomCm: 28, thetaM3M3: 0.18 },
  { topCm: 28, bottomCm: 100, thetaM3M3: 0.16 },
];

test('depletion estimator: fraction of TAW between wilting point and field capacity', () => {
  const est = estimateInitialDepletion({ layers: LAYERS, fieldCapacity: 0.30, wiltingPoint: 0.12, rootDepthM: 1.0 });
  // theta_rz = (0.20*7 + 0.18*21 + 0.16*72)/100 = 0.167
  assert.ok(Math.abs(est.rootZoneThetaM3M3 - 0.167) < 1e-9);
  assert.equal(est.totalAvailableMm, 180);
  const f = (0.30 - 0.167) / 0.18;
  assert.ok(Math.abs(est.depletionFraction.central - f) < 1e-9);
  assert.ok(Math.abs(est.depletionMm.central - f * 180) < 1e-6);
  assert.ok(est.depletionMm.low <= est.depletionMm.central && est.depletionMm.central <= est.depletionMm.high);
  assert.equal(est.kind, 'modeled-scenario-not-measurement');
});

test('depletion estimator clamps at field capacity and wilting point', () => {
  const wet = estimateInitialDepletion({ layers: LAYERS.map((l) => ({ ...l, thetaM3M3: 0.45 })), fieldCapacity: 0.30, wiltingPoint: 0.12, rootDepthM: 1.0 });
  assert.equal(wet.depletionMm.central, 0);
  assert.equal(wet.depletionMm.low, 0);
  const dry = estimateInitialDepletion({ layers: LAYERS.map((l) => ({ ...l, thetaM3M3: 0.05 })), fieldCapacity: 0.30, wiltingPoint: 0.12, rootDepthM: 1.0 });
  assert.equal(dry.depletionMm.central, dry.totalAvailableMm);
  assert.equal(dry.depletionMm.high, dry.totalAvailableMm);
  // Shallow crop: only the observed profile above Zr is weighted.
  const shallow = estimateInitialDepletion({ layers: LAYERS, fieldCapacity: 0.30, wiltingPoint: 0.12, rootDepthM: 0.28 });
  assert.equal(shallow.observedDepthM, 0.28);
  assert.ok(Math.abs(shallow.rootZoneThetaM3M3 - (0.20 * 7 + 0.18 * 21) / 28) < 1e-9);
  assert.throws(() => estimateInitialDepletion({ layers: LAYERS, fieldCapacity: 0.10, wiltingPoint: 0.12, rootDepthM: 1 }), /fieldCapacity/);
});

// ---- profile integration ----
function provider(et0 = 6, rain = 0) {
  return {
    latitude: 39.68, longitude: 66.98, timezone: 'Asia/Samarkand',
    daily_units: { rain_sum: 'mm', showers_sum: 'mm', et0_fao_evapotranspiration: 'mm' },
    daily: {
      time: Array.from({ length: 7 }, (_, i) => `2026-07-0${i + 1}`),
      temperature_2m_max: Array(7).fill(34), temperature_2m_min: Array(7).fill(20),
      precipitation_sum: Array(7).fill(rain), rain_sum: Array(7).fill(rain), showers_sum: Array(7).fill(0),
      et0_fao_evapotranspiration: Array(7).fill(et0),
    },
  };
}
const POLYGON: [number, number][] = [[66.80, 39.55], [66.84, 39.55], [66.84, 39.59], [66.80, 39.59]];
const BASE = { latitude: 39.57, longitude: 66.82, cropId: 'cotton', plantingDate: '2026-07-01' };
const profileOpts = (smFetcher: typeof fetch) => ({
  fetcher: fetcherFor(provider()), cache: new ForecastCache(), nowMs: NOW, soilMoistureFetcher: smFetcher,
});

test('profile: ERA5-Land scenario runs the existing engine at three depletions', async () => {
  const p = await buildFarmProfile({ ...BASE, polygon: POLYGON }, profileOpts(fetcherFor(archivePayload())));
  const sm = p.soilMoisture;
  assert.equal(sm.status, 'scenario-available');
  assert.equal(sm.kind, 'modeled-soil-moisture-scenario-not-measurement');
  assert.equal(sm.source?.model, 'ERA5-Land (ECMWF)');
  assert.equal(sm.source?.dataDate, '2026-07-01');
  assert.ok(sm.estimate && sm.estimate.depletionMm.low <= sm.estimate.depletionMm.central
    && sm.estimate.depletionMm.central <= sm.estimate.depletionMm.high);
  assert.equal(sm.scenarios.length, 3);
  assert.deepEqual(sm.scenarios.map((s) => s.id), ['wetter', 'central', 'drier']);
  assert.ok(sm.scenarios[0].initialDepletionMm <= sm.scenarios[1].initialDepletionMm
    && sm.scenarios[1].initialDepletionMm <= sm.scenarios[2].initialDepletionMm);
  // Drier start can only stress earlier or equal, never later.
  const days = sm.scenarios.map((s) => s.stressDaysWithoutIrrigation ?? 0);
  assert.ok(days[2] >= days[1] && days[1] >= days[0], `stress days wetter->drier ${days}`);
  assert.ok(sm.stressTiming);
  assert.ok(sm.limitations.some((l) => /NO irrigation scheme/.test(l)));
  assert.ok(sm.limitations.some((l) => /never a field measurement|not a field measurement|outranks/.test(l)));
  // The main irrigation result is unchanged: no depletion was assumed for it.
  assert.ok(p.irrigation?.missingInputs.some((m) => m.field === 'soil.initialDepletionMm'));
  assert.ok(p.unknowns.some((u) => u.field === 'soil.initialDepletionMm' && /ERA5-Land scenario/.test(u.effect)));
});

test('profile: soil-moisture source failure degrades honestly', async () => {
  const down = (async () => { throw new Error('archive down'); }) as unknown as typeof fetch;
  const p = await buildFarmProfile({ ...BASE, polygon: POLYGON }, profileOpts(down));
  assert.equal(p.soilMoisture.status, 'unavailable-source-failure');
  assert.equal(p.soilMoisture.estimate, null);
  assert.equal(p.soilMoisture.scenarios.length, 0);
  assert.ok(p.irrigation, 'the rest of the profile still calculates');
  assert.ok(p.soilMoisture.limitations.some((l) => /Nothing was substituted/.test(l)));
});

test('profile: farmer-supplied depletion still wins over the satellite scenario', async () => {
  const p = await buildFarmProfile({ ...BASE, polygon: POLYGON, initialDepletionMm: 10, applicationEfficiency: 0.75 },
    profileOpts(fetcherFor(archivePayload())));
  // Main engine used the farmer's 10 mm assumption (near-full soil: no stress expected).
  assert.equal(p.irrigation?.calculationTier, 'demand-and-stress-no-schedule');
  assert.ok(p.irrigation?.outlook);
  // The scenario is still shown for comparison, clearly separate.
  assert.equal(p.soilMoisture.status, 'scenario-available');
  assert.ok(p.soilMoisture.estimate!.depletionMm.central > 10, 'scenario is independent of the farmer assumption');
});
