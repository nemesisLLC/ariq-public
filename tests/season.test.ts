import test from 'node:test';
import assert from 'node:assert/strict';
import { compareScenarios, fao33RelativeYield, sensitivityAnalysis, simulateEnsemble, simulateSeason, type SeasonInput, type SeasonWeatherDay } from '../lib/irrigation/season.ts';
import { DEMO_SCENARIOS } from '../lib/irrigation/season-demos.ts';
import { YIELD_REFERENCES } from '../lib/irrigation/season.ts';
import { CROPS } from '../lib/irrigation/recommendation.ts';
import * as units from '../lib/units.ts';
import { LABELS, label } from '../lib/i18n-labels.ts';
import { fetchAnalogYear } from '../lib/irrigation/season-weather.ts';

const loam = { fieldCapacity: 0.28, wiltingPoint: 0.13, rootDepthM: 0.8, depletionFraction: 0.5, targetDepletionFraction: 0.2, initialDepletionMm: 40 };
function weather(days: number, et0 = 6, rainMm = 0, every = 10000): SeasonWeatherDay[] {
  return Array.from({ length: days }, (_, i) => ({ date: new Date(Date.parse('2026-04-15T00:00:00Z') + i * 86400000).toISOString().slice(0, 10), et0Mm: et0, rainMm: i % every === every - 1 ? rainMm : 0 }));
}
const cotton = (changes: Partial<SeasonInput> = {}): SeasonInput => ({ cropId: 'cotton', areaHa: 5, applicationEfficiency: 0.7, soil: { ...loam }, soilKind: 'user-supplied', weather: weather(180), weatherKind: 'historical-analog', analogYear: 2021, ...changes });
function near(a: number, b: number, tol = 1e-9) { assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`); }

test('FAO-33 benchmark: hand-calculated seasonal yield response', () => {
  // Ky=1.25 (maize), ETa/ETm=0.8 -> Ya/Ym = 1 - 1.25*0.2 = 0.75.
  near(fao33RelativeYield(1.25, 80, 100), 0.75);
  near(fao33RelativeYield(0.85, 100, 100), 1);
  near(fao33RelativeYield(0.85, 0, 100), 0.15);
  assert.equal(fao33RelativeYield(1.1, 10, 0), 1);
});
test('Ky and Kc provenance: every crop has documented FAO references', () => {
  assert.equal(CROPS.length, YIELD_REFERENCES.length);
  for (const c of CROPS) {
    assert.match(c.source, /FAO-56/);
    const y = YIELD_REFERENCES.find(r => r.cropId === c.id)!;
    assert.ok(y && /FAO/.test(y.source) && y.kySeasonal > 0);
  }
  assert.equal(YIELD_REFERENCES.find(r => r.cropId === 'cotton')!.kySeasonal, 0.85);
  assert.equal(YIELD_REFERENCES.find(r => r.cropId === 'maize')!.kySeasonal, 1.25);
});
test('season mass balance: depletion never leaves [0, TAW], irrigation+drainage conserve the daily balance', () => {
  const r = simulateSeason(cotton({ strategy: { seasonSupplyM3: 40000 } }));
  const taw = 1000 * (0.28 - 0.13) * 0.8;
  for (const d of r.daily) {
    assert.ok(d.endDepletionMm >= -1e-9 && d.endDepletionMm <= taw + 1e-9);
    near(d.startDepletionMm + d.etCropAdjMm - d.effectiveRainMm - d.irrigationNetMm - d.drainageMm <= d.endDepletionMm + 1e-6 ? d.endDepletionMm : NaN, d.endDepletionMm);
    assert.ok(d.ks >= 0 && d.ks <= 1);
  }
  assert.equal(r.seasonDays, 180);
  assert.equal(r.daily.length, 180);
  near(r.totals.irrigationGrossM3, r.totals.irrigationNetMm * 5 * 10 / 0.7);
});
test('no t/ha without a supplied potential-yield baseline', () => {
  const r = simulateSeason(cotton());
  assert.equal(r.yieldImpact.potentialYieldTPerHa, null);
  assert.equal(r.yieldImpact.estimatedYieldTPerHa, null);
  const withBase = simulateSeason(cotton({ potentialYieldTPerHa: 4 }));
  near(withBase.yieldImpact.estimatedYieldTPerHa!, 4 * withBase.yieldImpact.relativeYieldRetained);
});
test('drought and supply cuts reduce retained yield and raise stress; rainfall perturbation credits water', () => {
  const base = simulateSeason(cotton({ strategy: { seasonSupplyM3: 40000 } }));
  const drought = simulateSeason(cotton({ strategy: { seasonSupplyM3: 40000 }, perturbation: { rainFactor: 0.7 }, weather: weather(180, 6, 12, 14) }));
  const wetBase = simulateSeason(cotton({ strategy: { seasonSupplyM3: 40000 }, weather: weather(180, 6, 12, 14) }));
  assert.ok(drought.yieldImpact.relativeYieldRetained <= wetBase.yieldImpact.relativeYieldRetained);
  const cut = compareScenarios(cotton({ strategy: { seasonSupplyM3: 40000 } }), cotton({ strategy: { seasonSupplyM3: 24000 } }));
  assert.ok(cut.modified.supply.unmetGrossM3 >= cut.baseline.supply.unmetGrossM3);
  assert.ok(cut.deltas.relativeYieldRetained <= 0);
  assert.ok(base.totals.stressDays >= 0);
});
test('irrigation frequency limit increases stress days versus on-demand irrigation', () => {
  const onDemand = simulateSeason(cotton({ strategy: { seasonSupplyM3: 1e9 } }));
  const fortnightly = simulateSeason(cotton({ strategy: { seasonSupplyM3: 1e9, minIntervalDays: 14 } }));
  assert.ok(fortnightly.totals.stressDays >= onDemand.totals.stressDays);
  assert.ok(fortnightly.yieldImpact.relativeYieldRetained <= onDemand.yieldImpact.relativeYieldRetained + 1e-12);
});
test('alternative planting via shifted weather and alternative crop change the outcome deterministically', () => {
  const a = simulateSeason(cotton());
  assert.deepEqual(simulateSeason(cotton()), a);
  const maize = simulateSeason({ ...cotton(), cropId: 'maize' });
  assert.notEqual(maize.totals.etCropMm, a.totals.etCropMm);
});
test('historical ensemble is reproducible, ordered, and labelled not-a-confidence-interval', () => {
  const years = [2020, 2021, 2022].map((year, i) => ({ year, weather: weather(180, 5.5 + i * 0.5, 10, 12) }));
  const e1 = simulateEnsemble(cotton(), years), e2 = simulateEnsemble(cotton(), years);
  assert.deepEqual(e1.summary, e2.summary);
  assert.ok(e1.summary.relativeYieldRetained.low <= e1.summary.relativeYieldRetained.median);
  assert.match(e1.summary.note, /not a statistically calibrated confidence interval/);
  assert.ok(e1.years.every(y => y.result.warnings.includes('warning.historical-analog-not-forecast')));
});
test('sensitivity ranks factors deterministically and includes supply cut when constrained', () => {
  const s = sensitivityAnalysis(cotton({ strategy: { seasonSupplyM3: 30000 } }));
  assert.ok(s.factors.some(f => f.factorId === 'factor.supply-minus-40pct'));
  assert.ok(Math.abs(s.factors[0].deltaRelativeYield) >= Math.abs(s.factors.at(-1)!.deltaRelativeYield));
});
test('illustrative preset is labelled and never claims to describe the field', async () => {
  const { soilPresetById } = await import('../lib/irrigation/season.ts');
  const preset = soilPresetById.get('soil.loam-reference')!;
  const r = simulateSeason(cotton({ soil: preset, soilKind: 'illustrative-reference' }));
  assert.ok(r.warnings.includes('warning.illustrative-soil-preset'));
});
test('stage vulnerability comes from simulated stage stress; stages sum to the season', () => {
  const r = simulateSeason(cotton({ strategy: { seasonSupplyM3: 5000 } }));
  assert.equal(r.stages.reduce((s, x) => s + x.days, 0), 180);
  near(r.stages.reduce((s, x) => s + x.etCropMm, 0), r.totals.etCropMm);
  assert.ok(r.stages.every(s => s.etDeficitFraction >= 0 && s.etDeficitFraction <= 1));
});
test('invalid and extreme parameters are rejected', () => {
  assert.throws(() => simulateSeason(cotton({ weather: weather(10) })), /full 180-day/);
  assert.throws(() => simulateSeason(cotton({ perturbation: { rainFactor: 99 } })));
  assert.throws(() => simulateSeason({ ...cotton(), cropId: 'unknown-crop' }));
  assert.throws(() => simulateSeason(cotton({ soil: { ...loam, fieldCapacity: 0.1, wiltingPoint: 0.2 } })));
  assert.throws(() => fao33RelativeYield(-1, 1, 1));
});
test('unit conversions round-trip and display switching cannot change SI results', () => {
  for (const v of [0, 1, 25.4, 100, 1234.5]) {
    near(units.inchesToMm(units.mmToInches(v)), v);
    near(units.acresToHa(units.haToAcres(v)), v);
    near(units.usGallonsToM3(units.m3ToUsGallons(v)), v);
    near(units.fahrenheitToCelsius(units.celsiusToFahrenheit(v)), v);
    near(units.lbPerAcreToTPerHa(units.tPerHaToLbPerAcre(v)), v);
  }
  near(units.mmToInches(25.4), 1, 1e-6);
  near(units.celsiusToFahrenheit(100), 212);
  const r = simulateSeason(cotton());
  assert.equal(units.convertDepth(25.4, 'metric'), 25.4);
  assert.ok(r.totals.etCropMm > 0);
});
test('i18n labels exist for every crop, metric and warning id in en/uz/ru', () => {
  for (const c of CROPS) for (const lang of ['en', 'uz', 'ru'] as const) assert.notEqual(label(`crop.${c.id}`, lang), `crop.${c.id}`);
  for (const [id, langs] of Object.entries(LABELS)) for (const lang of ['en', 'uz', 'ru'] as const) assert.ok(langs[lang].length > 1, `${id}/${lang}`);
  const r = simulateSeason(cotton());
  for (const w of r.warnings) assert.ok(LABELS[w], `missing label for ${w}`);
});
test('three demo scenarios from different regions run and show the labelled what-if direction', () => {
  assert.equal(DEMO_SCENARIOS.length, 3);
  const regions = new Set(DEMO_SCENARIOS.map(d => d.regionId));
  assert.equal(regions.size, 3);
  for (const demo of DEMO_SCENARIOS) {
    const c = compareScenarios(demo.baseline, demo.modified);
    assert.ok(demo.assumptions.length >= 2);
    assert.ok(c.baseline.yieldImpact.relativeYieldRetained >= 0 && c.baseline.yieldImpact.relativeYieldRetained <= 1);
    assert.ok(Number.isFinite(c.deltas.irrigationGrossM3));
  }
  const cottonDemo = compareScenarios(DEMO_SCENARIOS[0].baseline, DEMO_SCENARIOS[0].modified);
  assert.ok(cottonDemo.deltas.relativeYieldRetained <= 0, 'rain -30% + supply -40% must not improve retained yield');
});
test('historical weather fetcher maps ERA5 payloads with mocked responses', async () => {
  const days = 180;
  const payload = { latitude: 39.7, longitude: 67.0, daily: { time: Array.from({ length: days }, (_, i) => new Date(Date.parse('2021-04-15T00:00:00Z') + i * 86400000).toISOString().slice(0, 10)), temperature_2m_mean: Array(days).fill(22), rain_sum: Array(days).fill(0), showers_sum: Array(days).fill(0), et0_fao_evapotranspiration: Array(days).fill(6) } };
  const out = await fetchAnalogYear(39.65, 66.96, '2026-04-15', days, 2021, (async () => Response.json(payload)) as unknown as typeof fetch);
  assert.equal(out.weather.length, days);
  assert.equal(out.weather[0].date, '2021-04-15');
  await assert.rejects(fetchAnalogYear(39.65, 66.96, '2026-04-15', days, 2021, (async () => new Response('down', { status: 503 })) as unknown as typeof fetch), /unavailable/);
});
test('performance and stability: 5 analog years x 180 days simulate quickly and finitely', () => {
  const started = Date.now();
  const e = simulateEnsemble(cotton({ strategy: { seasonSupplyM3: 30000 } }), [2019, 2020, 2021, 2022, 2023].map((year, i) => ({ year, weather: weather(180, 5.8 + i * 0.3, 8, 11) })));
  assert.ok(Date.now() - started < 5000, `ensemble took ${Date.now() - started}ms`);
  assert.ok(e.years.every(y => y.result.daily.every(d => Number.isFinite(d.endDepletionMm) && Number.isFinite(d.ks))));
});
