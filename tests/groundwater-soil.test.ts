import test from 'node:test';
import assert from 'node:assert/strict';
import { capillaryRise, groundwaterRisks, simulateGroundwaterBalance, groundwaterTrend, assessGroundwaterScenario } from '../lib/groundwater.ts';
import { estimateWaterRetention, classifySoilTest, nutrientBalance, leachingRisk } from '../lib/soil-fertility.ts';

test('capillary rise: zero beyond extinction, max inside fringe, monotone decreasing', () => {
  const shallow = capillaryRise({ depthToWaterM: 0.8, rootDepthM: 0.6, texture: 'loam' });
  const mid = capillaryRise({ depthToWaterM: 1.8, rootDepthM: 0.6, texture: 'loam' });
  const deep = capillaryRise({ depthToWaterM: 6, rootDepthM: 0.6, texture: 'loam' });
  assert.ok(shallow.rateMmDay.mid > mid.rateMmDay.mid && mid.rateMmDay.mid > deep.rateMmDay.mid);
  assert.equal(deep.rateMmDay.mid, 0);
  assert.ok(shallow.rateMmDay.low <= shallow.rateMmDay.mid && shallow.rateMmDay.mid <= shallow.rateMmDay.high);
  assert.equal(shallow.kind, 'modeled-estimate');
});

test('groundwater balance conserves mass with capillary rise and bounds CR', () => {
  const days = Array.from({ length: 5 }, (_, i) => ({ date: `2026-07-0${i + 1}`, etAdjMm: 6, effectiveRainMm: 0, irrigationNetMm: 0 }));
  const out = simulateGroundwaterBalance({ days, totalAvailableMm: 100, initialDepletionMm: 90, capillaryRateMmDay: 2 });
  for (const d of out) {
    const residual = d.startDepletionMm + d.etAdjMm - 0 - 0 - d.capillaryRiseMm + d.drainageMm - d.endDepletionMm;
    assert.ok(Math.abs(residual) < 1e-9, `residual ${residual}`);
    assert.ok(d.endDepletionMm >= 0 && d.endDepletionMm <= 100);
  }
  assert.ok(out[0].capillaryRiseMm > 0);
});

test('risks: water table in roots is high waterlogging risk; EC classes follow FAO-29', () => {
  const r = groundwaterRisks({ depthToWaterM: 0.4, rootDepthM: 0.6, groundwaterEcDsM: 4 });
  assert.equal(r.waterlogging.level, 'high');
  assert.equal(r.salinity.level, 'severe');
  const unknown = groundwaterRisks({ depthToWaterM: 3, rootDepthM: 0.6 });
  assert.equal(unknown.salinity.level, 'unknown');
  assert.equal(unknown.waterlogging.level, 'none');
});

test('trend: least squares over supplied observations only, needs 3 points', () => {
  const obs = [
    { depthToWaterM: 2.0, observedAt: '2020-01-01', kind: 'observed' as const, source: 'well A log' },
    { depthToWaterM: 2.5, observedAt: '2022-01-01', kind: 'observed' as const, source: 'well A log' },
    { depthToWaterM: 3.0, observedAt: '2024-01-01', kind: 'observed' as const, source: 'well A log' },
  ];
  const t = groundwaterTrend(obs);
  assert.ok(Math.abs((t.trendMPerYear ?? 0) - 0.25) < 0.01, `trend ${t.trendMPerYear}`);
  assert.equal(groundwaterTrend(obs.slice(0, 2)).trendMPerYear, null);
  const s = assessGroundwaterScenario({ depthToWaterM: 2, depthKind: 'historical', rootDepthM: 0.6, texture: 'loam' });
  assert.ok(s.warnings.includes('warning.groundwater-dated-source-not-current'));
});

test('Saxton-Rawls: loam estimate in published range, sand holds less water', () => {
  const loam = estimateWaterRetention({ sandPct: 40, clayPct: 20, organicMatterPct: 2 });
  assert.ok(loam.fieldCapacity > 0.22 && loam.fieldCapacity < 0.36, `FC ${loam.fieldCapacity}`);
  assert.ok(loam.wiltingPoint > 0.08 && loam.wiltingPoint < 0.2, `WP ${loam.wiltingPoint}`);
  const sand = estimateWaterRetention({ sandPct: 90, clayPct: 5, organicMatterPct: 0.5 });
  assert.ok(sand.totalAvailableMmPerM < loam.totalAvailableMmPerM);
});

test('soil test classification: salinity and pH classes, missing data warns', () => {
  const c = classifySoilTest({ kind: 'soil-test', measuredAt: '2026-05-01', ecDsM: 6, pH: 8.1 });
  assert.equal(c.salinity?.level, 'moderately saline');
  assert.match(c.acidity?.level ?? '', /alkaline/);
  const empty = classifySoilTest({ kind: 'soil-test', measuredAt: '2026-05-01' });
  assert.equal(empty.salinity, null);
  assert.ok(empty.warnings.length >= 2);
});

test('nutrient balance: arithmetic exact, irrigation N credited, no prescription language', () => {
  const b = nutrientBalance({
    cropId: 'winter-wheat', yieldTPerHa: 5,
    fertilizers: [{ name: 'urea', rateKgPerHa: 200, nFraction: 0.46, p2o5Fraction: 0, k2oFraction: 0 }],
    irrigationWater: { volumeM3PerHa: 5000, nitrateNMgL: 10 },
  });
  // inputs N = 200*0.46 + 10*5000/1000 = 92 + 50 = 142; removal N = 21*5 = 105
  assert.equal(b.inputsKgHa.n, 142);
  assert.equal(b.removalKgHa.n, 105);
  assert.equal(b.balanceKgHa.n, 37);
  assert.equal(b.reading.find(r => r.nutrient === 'N')?.tendency, 'surplus');
  assert.ok(b.warnings.includes('warning.nutrient-balance-not-prescription'));
});

test('leaching risk rises with drainage and sand', () => {
  const low = leachingRisk({ drainageMmSeason: 20, sandPct: 20, nitrogenInputKgHa: 100 });
  const high = leachingRisk({ drainageMmSeason: 300, sandPct: 85, nitrogenInputKgHa: 250 });
  assert.equal(low.level, 'low');
  assert.equal(high.level, 'high');
  assert.ok(high.score > low.score);
});
