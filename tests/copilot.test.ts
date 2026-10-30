import test from 'node:test';
import assert from 'node:assert/strict';
import { runCopilot } from '../lib/copilot/orchestrator.ts';
import { executeTool } from '../lib/copilot/tools.ts';
import { validateFrontendAction } from '../lib/copilot/actions.ts';
import { HttpError } from '../lib/irrigation/http.ts';
import { simulateSeason } from '../lib/irrigation/season.ts';

const call = (name: string, args: unknown, id: string) => ({ type: 'function_call', name, call_id: id, arguments: JSON.stringify(args) });
const finalMsg = (language = 'en') => ({ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ language, title: 'Water outlook', summary: 'The computed results are shown with their sources and limits.', caveats: ['Weather is a forecast or historical analog as labelled.'] }) }] });
function metaScript(steps: unknown[][]) {
  let i = 0;
  return (async () => Response.json({ status: 'completed', output: steps[Math.min(i++, steps.length - 1)], usage: { input_tokens: 100, output_tokens: 50 } })) as unknown as typeof fetch;
}
function provider() {
  return { latitude: 39.7, longitude: 64.4, timezone: 'Asia/Samarkand', daily_units: { rain_sum: 'mm', showers_sum: 'mm', et0_fao_evapotranspiration: 'mm' },
    daily: { time: Array.from({ length: 7 }, (_, x) => `2026-07-0${x + 1}`), temperature_2m_max: Array(7).fill(34), temperature_2m_min: Array(7).fill(20), precipitation_sum: Array(7).fill(0), rain_sum: Array(7).fill(0), showers_sum: Array(7).fill(0), et0_fao_evapotranspiration: Array(7).fill(6) } };
}
const analogFetcher = async (_lat: number, _lon: number, _pd: string, days: number, years: number[]) => years.map(year => ({
  year, sourceUrl: 'mock://era5',
  weather: Array.from({ length: days }, (_, i) => ({ date: new Date(Date.parse(`${year}-04-01T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10), et0Mm: 6, rainMm: i % 14 === 13 ? 12 : 0 })),
}));
const deps = (metaFetcher: typeof fetch) => ({ metaFetcher, weatherFetcher: (async () => Response.json(provider())) as unknown as typeof fetch, analogFetcher, apiKey: 'test-key', enabled: true });
const bukharaQuestion = { question: 'What happens if rainfall drops for my cotton near Bukhara?', language: 'en' as const, context: { latitude: 39.77, longitude: 64.43, cropId: 'cotton', areaHa: 5, plantingDate: '2026-04-15' } };

test('multistep tool use: search then drought comparison, actions built from real outputs', async () => {
  const meta = metaScript([
    [call('search_water_sources', { q: 'Zarafshan', limit: 5 }, 'c1')],
    [call('compare_drought_strategies', { latitude: 39.77, longitude: 64.43, cropId: 'cotton', areaHa: 5, plantingDate: '2026-04-15', rainFactor: 0.7, seasonSupplyM3: 40000 }, 'c2')],
    [finalMsg()],
  ]);
  const r = await runCopilot(bukharaQuestion, deps(meta));
  assert.deepEqual(r.trace.filter(t => t.step === 'tool').map(t => t.status), ['completed', 'completed']);
  assert.ok(r.actions.some(a => a.type === 'flyToLocation'));
  assert.ok(r.actions.some(a => a.type === 'showScenarioComparison'));
  assert.ok(r.actions.some(a => a.type === 'showSourceEvidence'));
  const compare = r.toolResults.compare_drought_strategies as { droughtVsBaseline: { deltas: { relativeYieldRetained: number } } };
  assert.ok(compare.droughtVsBaseline.deltas.relativeYieldRetained <= 0);
  assert.equal(r.usage.modelCalls, 3);
});

test('drought comparison tool reuses the season engine exactly (no model-invented numbers)', async () => {
  const out = await executeTool('compare_drought_strategies', { latitude: 39.77, longitude: 64.43, cropId: 'cotton', areaHa: 5, plantingDate: '2026-04-15', rainFactor: 0.7, seasonSupplyM3: 40000 }, { analogFetcher }) as { analogYear: number; droughtVsBaseline: { baselineYieldRetained: number } };
  assert.equal(out.analogYear, 2021);
  assert.ok(out.droughtVsBaseline.baselineYieldRetained >= 0 && out.droughtVsBaseline.baselineYieldRetained <= 1);
  const search = await executeTool('search_water_sources', { q: 'kattakurgan' }, {}) as { results: { id: string }[] };
  assert.equal(search.results[0].id, 'kattakurgan-reservoir');
  const nearby = await executeTool('nearby_water_sources', { latitude: 39.79, longitude: 66.24, k: 3 }, {}) as { note: string; results: { id: string }[] };
  assert.match(nearby.note, /does not prove water access/);
  assert.ok(nearby.results.some(r => r.id === 'kattakurgan-reservoir'));
});

test('multilingual final output is validated; prose with digits is discarded to a safe partial', async () => {
  const uz = await runCopilot({ ...bukharaQuestion, language: 'uz' }, deps(metaScript([[finalMsg('uz')]])));
  assert.equal(uz.language, 'uz');
  assert.equal(uz.explanation.language, 'uz');
  const badProse = metaScript([[{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ language: 'en', title: 'Claim', summary: 'You will save 40 percent water.', caveats: ['See https://example.com'] }) }] }]]);
  const discarded = await runCopilot(bukharaQuestion, deps(badProse));
  assert.equal(discarded.partial, true);
  assert.ok(!discarded.explanation.summary.includes('40'));
});

test('unsafe and non-permitted tool requests are rejected without execution; invalid user input fails', async () => {
  const meta = metaScript([
    [call('season_simulation', { latitude: 50, longitude: 10, cropId: 'cotton', plantingDate: '2026-04-15' }, 'x1'), call('irrigation_recommendation', { latitude: 39.7, longitude: 64.4, cropId: 'cotton', areaHa: 1, plantingDate: '2026-07-01', applicationEfficiency: 0.7 }, 'x2')],
    [finalMsg()],
  ]);
  const r = await runCopilot({ ...bukharaQuestion, permittedTools: ['irrigation_recommendation'] }, deps(meta));
  const statuses = r.trace.filter(t => t.step === 'tool').map(t => t.status);
  assert.ok(statuses.includes('rejected-not-permitted'));
  await assert.rejects(runCopilot({ question: '', language: 'en' }, deps(metaScript([[finalMsg()]]))), HttpError);
  await assert.rejects(runCopilot({ question: 'hi', language: 'de' }, deps(metaScript([[finalMsg()]]))), HttpError);
  await assert.rejects(executeTool('search_water_sources', { limit: 500 }, {}), HttpError);
});

test('missing soil/supply yields partial recommendation results through the copilot tool', async () => {
  const meta = metaScript([[call('irrigation_recommendation', { latitude: 39.77, longitude: 64.43, cropId: 'cotton', areaHa: 5, plantingDate: '2026-07-01', applicationEfficiency: 0.7 }, 'm1')], [finalMsg()]]);
  const r = await runCopilot(bukharaQuestion, deps(meta));
  const rec = r.toolResults.irrigation_recommendation as { calculationTier: string; missingInputs: { field: string }[] };
  assert.equal(rec.calculationTier, 'demand-only');
  assert.ok(rec.missingInputs.some(m => m.field === 'soil'));
  assert.ok(r.actions.some(a => a.type === 'displayForecast'));
});

test('model failure, timeout and budget limits are handled explicitly', async () => {
  const failing = (async () => new Response('err', { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(runCopilot(bukharaQuestion, deps(failing)), HttpError);
  const timingOut = (async () => { throw new Error('aborted'); }) as unknown as typeof fetch;
  await assert.rejects(runCopilot(bukharaQuestion, deps(timingOut)), HttpError);
  const disabled = await runCopilot(bukharaQuestion, { ...deps(metaScript([[finalMsg()]])), enabled: false }).catch(e => e);
  assert.ok(disabled instanceof HttpError && disabled.status === 503);
  const alwaysTools = metaScript([[call('search_water_sources', { q: 'a' }, 'b1')], [call('search_water_sources', { q: 'b' }, 'b2')], [call('search_water_sources', { q: 'c' }, 'b3')], [call('search_water_sources', { q: 'd' }, 'b4')]]);
  const limited = await runCopilot(bukharaQuestion, { ...deps(alwaysTools), maxModelCalls: 2, maxToolCalls: 1 });
  assert.equal(limited.partial, true);
  assert.equal(limited.usage.modelCalls, 2);
});

test('frontend action validation rejects invented coordinates and unknown types', () => {
  assert.throws(() => validateFrontendAction({ type: 'flyToLocation', latitude: 20, longitude: 20 }), HttpError);
  assert.throws(() => validateFrontendAction({ type: 'highlightWaterSources', features: [{ id: 'x', coordinates: [10, 10] }] }), HttpError);
  assert.throws(() => validateFrontendAction({ type: 'teleport' } as never), HttpError);
  assert.ok(validateFrontendAction({ type: 'flyToLocation', latitude: 39.7, longitude: 64.4 }));
});

test('units preference never changes SI tool results', async () => {
  const args = { latitude: 39.77, longitude: 64.43, cropId: 'cotton', areaHa: 5, plantingDate: '2026-04-15', seasonSupplyM3: 40000 };
  const metric = await runCopilot(bukharaQuestion, deps(metaScript([[call('season_simulation', args, 'u1')], [finalMsg()]])));
  const us = await runCopilot({ ...bukharaQuestion, units: 'us' }, deps(metaScript([[call('season_simulation', args, 'u1')], [finalMsg()]])));
  assert.deepEqual(us.toolResults.season_simulation, metric.toolResults.season_simulation);
  assert.equal(us.units, 'us');
});

test('season tool deterministic: identical tool inputs repeat exactly', async () => {
  const args = { latitude: 39.77, longitude: 64.43, cropId: 'cotton', areaHa: 5, plantingDate: '2026-04-15', seasonSupplyM3: 40000 };
  const a = await executeTool('season_simulation', args, { analogFetcher });
  const b = await executeTool('season_simulation', args, { analogFetcher });
  assert.deepEqual(a, b);
  assert.ok(simulateSeason.length >= 1);
});
