import test from 'node:test';
import assert from 'node:assert/strict';
import { getFarmEvidence } from '../lib/farm-intelligence.ts';

const FARMS = [
  { name: 'Samarkand cotton area', lat: 39.65, lon: 66.96, region: 'Samarqand' },
  { name: 'Bukhara oasis', lat: 39.77, lon: 64.43, region: 'Bukhara' },
  { name: 'Nukus, Karakalpakstan', lat: 42.46, lon: 59.61, region: 'Karakalpakstan' },
  { name: 'Fergana Valley (Margilan area)', lat: 40.47, lon: 71.72, region: 'Fergana' },
  { name: 'Urgench, Khorezm', lat: 41.55, lon: 60.63, region: 'Xorazm' },
  { name: 'Tashkent peri-urban', lat: 41.31, lon: 69.24, region: 'Tashkent' },
];

for (const farm of FARMS) {
  test(`farm evidence: ${farm.name}`, () => {
    const e = getFarmEvidence(farm.lat, farm.lon);
    assert.equal(e.location.insideUzbekistanBbox, true);
    assert.ok(e.location.region && e.location.region.includes(farm.region.split(' ')[0]), `region ${e.location.region} should match ${farm.region}`);
    // Soil: modelled regional estimate with physical ranges and a retention scenario
    assert.ok(e.soil, 'soil evidence present');
    assert.equal(e.soil!.kind, 'modeled-estimate');
    const t = e.soil!.texture;
    assert.ok(t.sandPct > 0 && t.sandPct < 80 && t.clayPct > 0 && t.clayPct < 80, `texture ${t.sandPct}/${t.clayPct}`);
    assert.ok((e.soil!.ph ?? 0) >= 6 && (e.soil!.ph ?? 0) <= 9, `pH ${e.soil!.ph}`);
    const wr = e.soil!.waterRetentionScenario;
    assert.ok(wr && wr.fieldCapacity > wr.wiltingPoint && wr.totalAvailableMmPerM > 30 && wr.totalAvailableMmPerM < 300, `TAW/m ${wr?.totalAvailableMmPerM}`);
    // Uncertainty is reported, not hidden
    assert.ok(t.sandRangePct && t.sandRangePct[0] < t.sandRangePct[1], 'sand prediction range present');
    // Water: documented proximity with distances, never connectivity
    assert.ok(e.water.nearest.length > 0 && e.water.nearest[0].distanceKm >= 0);
    assert.match(e.water.note, /does not imply hydraulic connectivity/);
    // Groundwater: explicitly unknown, never fabricated
    assert.equal(e.groundwater.depthToWaterM, null);
    assert.equal(e.groundwater.status, 'no-farm-measurement-available');
    // National context: reported SIAT with a recent year
    assert.ok(e.nationalWaterContext.latestIrrigationWithdrawalMillionM3);
    assert.ok(e.nationalWaterContext.latestIrrigationWithdrawalMillionM3!.year >= 2024, `SIAT year ${e.nationalWaterContext.latestIrrigationWithdrawalMillionM3!.year}`);
    assert.ok(e.nationalWaterContext.latestIrrigationWithdrawalMillionM3!.value > 30000);
  });
}

test('climate context returns real ERA5 monthly means for the region (audit regression)', () => {
  // Regression: the climate block previously searched with the region
  // suffix stripped and read a {year, value} shape the ERA5 series never
  // had, so `climate.series` was silently [] for every farm.
  const e = getFarmEvidence(39.65, 66.96);
  assert.ok(e.climate, 'climate present');
  assert.equal(e.climate.series.length, 3);
  const [precip, et0, temp] = e.climate.series;
  assert.equal(precip.unit, 'mm/month');
  assert.ok(precip.recentMean !== null && precip.recentMean > 0 && precip.recentMean < 60, `precip ${precip.recentMean}`);
  assert.ok(et0.recentMean !== null && et0.recentMean > 40 && et0.recentMean < 160, `ET0 ${et0.recentMean}`);
  assert.ok(temp.recentMean !== null && temp.recentMean > 5 && temp.recentMean < 25, `temp ${temp.recentMean}`);
  assert.deepEqual(precip.years, [2015, 2024]);
  assert.deepEqual(et0.years, [2015, 2024]);
});

test('evidence layer rejects invalid coordinates and flags outside coverage', () => {
  assert.throws(() => getFarmEvidence(91, 0), /latitude\/longitude/);
  const outside = getFarmEvidence(50, 10);
  assert.equal(outside.location.insideUzbekistanBbox, false);
  assert.ok(outside.warnings.includes('warning.location-outside-uzbekistan-coverage'));
  assert.equal(outside.groundwater.depthToWaterM, null);
});
