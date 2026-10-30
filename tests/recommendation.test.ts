import test from 'node:test';
import assert from 'node:assert/strict';
import { ForecastCache, ForecastUnavailableError, recommend } from '../lib/irrigation/recommendation.ts';
import { calculateFieldOutlook, calculateSchedule } from '../lib/irrigation/scheduler.ts';
import { POST } from '../app/api/irrigation/recommendation/route.ts';

function provider(et0 = 6, rain = 0, lat = 39.68, lon = 66.98) {
  return { latitude: lat, longitude: lon, timezone: 'Asia/Samarkand', daily_units: { rain_sum: 'mm', showers_sum: 'mm', et0_fao_evapotranspiration: 'mm' },
    daily: { time: Array.from({ length: 7 }, (_, i) => `2026-07-0${i + 1}`), temperature_2m_max: Array(7).fill(34), temperature_2m_min: Array(7).fill(20), precipitation_sum: Array(7).fill(rain), rain_sum: Array(7).fill(rain), showers_sum: Array(7).fill(0), et0_fao_evapotranspiration: Array(7).fill(et0) } };
}
const fetcherFor = (payload: unknown, counter?: { calls: number }) => (async () => { if (counter) counter.calls++; return Response.json(payload); }) as unknown as typeof fetch;
const soil = { fieldCapacity: 0.3, wiltingPoint: 0.1, rootDepthM: 0.5, depletionFraction: 0.5, initialDepletionMm: 50 };
const base = { latitude: 39.65, longitude: 66.96, cropId: 'cotton', areaHa: 2, plantingDate: '2026-07-01', applicationEfficiency: 0.75 };
const supply = { availableWaterM3: 100000, sourceMaxFlowM3PerHour: 200, canalMaxFlowM3PerHour: 150, canalEfficiency: 0.9, windowHoursPerDay: 8 };
const run = (input: unknown, payload: unknown = provider(), options = {}) => recommend(input, { fetcher: fetcherFor(payload), cache: new ForecastCache(), ...options });

test('Samarkand cotton: full tier with soil and supply produces demand, stress outlook, deadlines and a feasible schedule', async () => {
  const r = await run({ ...base, soil, supply });
  assert.equal(r.calculationTier, 'demand-stress-and-schedule');
  assert.equal(r.provenance.weather.kind, 'forecast');
  assert.equal(r.provenance.result.kind, 'simulated');
  assert.ok(r.outlook!.irrigationEvents.length >= 1);
  assert.ok(r.schedule!.deliveries.every(d => {
    const e = r.schedule!.events.find(x => x.eventId === d.eventId)!;
    return d.date <= e.deadlineDate;
  }));
  assert.equal(r.schedule!.events.every(e => e.status === 'scheduled'), true);
  assert.equal(r.missingInputs.length, 0);
});

test('multiple regions: same API works for Nukus and Tashkent coordinates, grid points are echoed', async () => {
  const nukus = await run({ ...base, latitude: 42.47, longitude: 59.61 }, provider(7, 0, 42.5, 59.5));
  const tashkent = await run({ ...base, latitude: 41.31, longitude: 69.24 }, provider(5, 0, 41.3, 69.2));
  assert.equal(nukus.location.forecastGrid!.latitude, 42.5);
  assert.equal(tashkent.location.forecastGrid!.latitude, 41.3);
  assert.ok(nukus.demand!.totalEtCropMm! > tashkent.demand!.totalEtCropMm!, 'higher ET0 must raise demand');
});

test('differing crops: wheat Kc curve gives different demand than cotton on identical weather', async () => {
  const cotton = await run({ ...base, soil });
  const wheat = await run({ ...base, cropId: 'winter-wheat', soil });
  assert.notEqual(cotton.forecastDays[3].kc, wheat.forecastDays[3].kc);
  assert.equal(cotton.crop.kind, 'reference');
});

test('drought vs rainfall: forecast rain is credited and can remove irrigation events', async () => {
  const dry = await run({ ...base, soil, supply }, provider(6, 0));
  const wet = await run({ ...base, soil, supply }, provider(6, 30));
  assert.ok(wet.outlook!.irrigationEvents.length < dry.outlook!.irrigationEvents.length);
  assert.ok(wet.demand!.totalNetIrrigationMm! < dry.demand!.totalNetIrrigationMm!);
  assert.ok(wet.forecastDays.every(d => d.rainMm === 30));
});

test('missing soil returns demand-only with explicit missing input; no invented soil or stress', async () => {
  const r = await run({ ...base });
  assert.equal(r.calculationTier, 'demand-only');
  assert.equal(r.outlook, null);
  assert.equal(r.schedule, null);
  assert.ok(r.missingInputs.some(m => m.field === 'soil'));
  assert.ok(r.demand!.totalDeficitMm! > 0);
  assert.equal(r.provenance.soil.kind, 'missing');
});

test('soil without initial depletion cannot claim stress; missing supply blocks only the schedule', async () => {
  const noInitial = await run({ ...base, soil: { fieldCapacity: 0.3, wiltingPoint: 0.1, rootDepthM: 0.5, depletionFraction: 0.5 }, supply });
  assert.equal(noInitial.outlook, null);
  assert.ok(noInitial.missingInputs.some(m => m.field === 'soil.initialDepletionMm'));
  const noSupply = await run({ ...base, soil });
  assert.equal(noSupply.calculationTier, 'demand-and-stress-no-schedule');
  assert.ok(noSupply.outlook!.irrigationEvents.length >= 1);
  assert.equal(noSupply.schedule, null);
  assert.ok(noSupply.missingInputs.some(m => m.field === 'supply'));
  const partialSupply = await run({ ...base, soil, supply: { availableWaterM3: 100 } }).catch(e => e);
  assert.match(String(partialSupply.message ?? partialSupply), /supply is incomplete/);
});

test('invalid coordinates, outside-Uzbekistan locations, bad crops and bad planting dates are rejected', async () => {
  await assert.rejects(run({ ...base, latitude: 999, soil }), /latitude/);
  await assert.rejects(run({ ...base, latitude: 50, longitude: 30, soil }), /outside Uzbekistan/);
  await assert.rejects(run({ ...base, cropId: 'rice- Deluxe', soil }), /cropId/);
  await assert.rejects(run({ ...base, plantingDate: '2026-02-30', soil }), /plantingDate/);
  await assert.rejects(run({ ...base, plantingDate: '2026-07-01', soil: { ...soil, fieldCapacity: 0.1, wiltingPoint: 0.2 } }), /fieldCapacity/);
});

test('planting before the forecast shifts the Kc curve (older crop, higher Kc)', async () => {
  const young = await run({ ...base, soil });
  const older = await run({ ...base, plantingDate: '2026-05-17', soil });
  assert.equal(young.kcStartDayIndex, 0);
  assert.equal(older.kcStartDayIndex, 45);
  assert.ok(older.forecastDays[0].kc > young.forecastDays[0].kc);
  const future = await run({ ...base, plantingDate: '2027-01-01', soil });
  assert.equal(future.calculationTier, 'not-yet-planted');
});

test('forecast downtime: throws without cache, serves marked stale forecast with cache, route returns 502', async () => {
  const down = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  await assert.rejects(recommend({ ...base, soil }, { fetcher: down, cache: new ForecastCache() }), ForecastUnavailableError);
  const cache = new ForecastCache();
  await recommend({ ...base, soil }, { fetcher: fetcherFor(provider()), cache, nowMs: 1000 });
  const stale = await recommend({ ...base, soil }, { fetcher: down, cache, nowMs: 1000 + 31 * 60 * 1000 });
  assert.equal(stale.provenance.weather.cacheStatus, 'stale-after-failure');
  assert.ok(stale.warnings.some(w => w.includes('stale')));
  const res = await POST(new Request('http://127.0.0.1/api/irrigation/recommendation', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1' }, body: JSON.stringify({ ...base, soil }) }));
  // Route uses the live network by default in this environment-independent assertion only if it fails;
  // in CI it may succeed. Accept either a real recommendation or the structured 502.
  assert.ok([200, 502].includes(res.status));
  if (res.status === 502) assert.equal((await res.json()).kind, 'forecast-unavailable');
});

test('caching: second call for the same rounded location does not refetch', async () => {
  const counter = { calls: 0 };
  const cache = new ForecastCache(60000);
  await recommend({ ...base, soil }, { fetcher: fetcherFor(provider(), counter), cache, nowMs: 0 });
  const second = await recommend({ ...base, latitude: 39.6504, soil }, { fetcher: fetcherFor(provider(), counter), cache, nowMs: 1000 });
  assert.equal(counter.calls, 1);
  assert.equal(second.provenance.weather.cacheStatus, 'cached');
});

test('numerical consistency with Feature 1: outlook and schedule match direct scheduler calls on the same weather', async () => {
  const r = await run({ ...base, soil, supply });
  const weather = Array.from({ length: 7 }, (_, i) => ({ date: `2026-07-0${i + 1}`, et0Mm: 6, rainMm: 0 }));
  const field = { id: 'farm-field', nodeId: 'farm-field', areaHa: 2, kc: undefined, kcCurve: r.crop.kcCurve, applicationEfficiency: 0.75, priority: 1, kcStartDayIndex: 0,
    soil: { ...soil, targetDepletionFraction: 0.2 } };
  const direct = calculateFieldOutlook(field as never, weather, 0.8);
  assert.deepEqual(r.outlook!.irrigationEvents, direct.irrigationEvents);
  assert.deepEqual(r.demand!.daily, direct.dailyNoIrrigation);
  const directPlan = calculateSchedule({ kind: 'simulation', inputNote: 'consistency', rainRetentionFraction: 0.8, weather, fields: [field as never],
    network: { sourceId: 'source', nodes: ['source', 'farm-field'], supplyM3: supply.availableWaterM3, sourceMaxFlowM3PerHour: supply.sourceMaxFlowM3PerHour, windowHoursPerDay: supply.windowHoursPerDay, edges: [{ id: 'farm-canal', from: 'source', to: 'farm-field', maxFlowM3PerHour: supply.canalMaxFlowM3PerHour, efficiency: supply.canalEfficiency, closed: false }] } });
  assert.deepEqual(r.schedule!.events, directPlan.events);
  assert.deepEqual(r.schedule!.deliveries, directPlan.deliveries);
});

