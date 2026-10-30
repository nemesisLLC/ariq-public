import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCards, proactiveSuggestions } from '../app/copilot/cards.ts';

test('waterway cards carry name, kind and distance untouched from tool output', () => {
  const cards = buildCards({ nearby_water_sources: { results: [{ name: 'Zarafshan River', kind: 'river', distanceKm: 3.14159, region: 'Samarqand' }] } }, 'en');
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0], { kind: 'waterway', name: 'Zarafshan River', type: 'river', distanceKm: 3.14159, region: 'Samarqand' });
});

test('drought comparison card shows modified vs baseline retained yield', () => {
  const cards = buildCards({ compare_drought_strategies: { analogYear: 2021, droughtVsBaseline: { modifiedYieldRetained: 0.82, baselineYieldRetained: 0.95 } } }, 'ru');
  assert.equal(cards[0].kind, 'scenario');
  if (cards[0].kind === 'scenario') { assert.equal(cards[0].retainedPct, 82); assert.match(cards[0].note ?? '', /95/); }
});

test('recommendation card surfaces missing inputs instead of inventing values', () => {
  const cards = buildCards({ irrigation_recommendation: { demand: null, outlook: { firstStressDateWithoutIrrigation: null }, missingInputs: [{ field: 'soil' }, { field: 'canalCapacity' }] } }, 'en');
  assert.equal(cards[0].kind, 'demand');
  if (cards[0].kind === 'demand') { assert.equal(cards[0].etCropMm, undefined); assert.deepEqual(cards[0].missing, ['soil', 'canalCapacity']); }
});

test('proactive suggestions follow real workflow state and cost nothing', () => {
  const atlas = proactiveSuggestions({ view: 'atlas' }, 'en');
  assert.ok(atlas.every(s => !s.action));
  const ready = proactiveSuggestions({ view: 'farm', analysisStatus: 'ready', step: 3 }, 'uz');
  assert.equal(ready[1].action, 'futures'); // real navigation action, no model call
  const draw = proactiveSuggestions({ view: 'farm', step: 1, hasBoundary: false }, 'ru');
  assert.match(draw[0].q, /границ/);
  const futures = proactiveSuggestions({ view: 'farm', tool: 'futures', analysisStatus: 'ready' }, 'en');
  assert.match(futures[0].q, /30%/);
});
