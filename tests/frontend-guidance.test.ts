import test from 'node:test';
import assert from 'node:assert/strict';
import { fitWindow } from '../app/copilot/window.ts';
import { workflowGuide } from '../app/copilot/guide.ts';
import { loadMapWater } from '../app/atlas/mapWater.ts';
import { featuresGeoJson, foundationFeatures } from '../lib/data-foundation.ts';

test('saved Copilot positions remain reachable after changing screens', () => {
  const ui = fitWindow({ x: 1900, y: 1000, w: 680, h: 760 }, 1024, 600);
  assert.ok(ui.x >= 8 && ui.x + ui.w <= 1016);
  assert.ok(ui.y >= 8 && ui.y + ui.h <= 592);
  const corrupt = fitWindow({ x: 'offscreen', y: NaN, w: -10, h: Infinity, dock: 'bad', minimized: 'true' }, 1440, 900);
  assert.equal(corrupt.dock, 'none');
  assert.equal(corrupt.minimized, false);
  assert.ok(Object.values(corrupt).filter(v => typeof v === 'number').every(Number.isFinite));
});

test('local guidance follows the actual workflow without a model call', () => {
  assert.equal(workflowGuide({ view: 'atlas' }, 'en').action, 'farm');
  assert.match(workflowGuide({ view: 'farm', step: 1 }, 'en').text, /opposite corners/);
  assert.match(workflowGuide({ view: 'farm', step: 2 }, 'en').text, /date you planted/);
  assert.match(workflowGuide({ view: 'farm', analysisStatus: 'error' }, 'en').text, /Retry/);
  assert.match(workflowGuide({ view: 'farm', analysisStatus: 'ready' }, 'en').text, /Check your soil/);
  for (const lang of ['en', 'uz', 'ru'] as const) {
    const guide = workflowGuide({ view: 'farm', step: 1 }, lang);
    assert.ok(guide.text.length < 260);
    assert.ok(guide.title.length > 5);
  }
});

test('flat map loads every page of waterways, including streams and drains', async () => {
  const calls: URL[] = [];
  const feature = (id: string) => ({ type: 'Feature', properties: { id }, geometry: { type: 'LineString', coordinates: [[66, 39], [67, 40]] } });
  const fetcher: typeof fetch = async url => {
    const u = new URL(String(url), 'https://ariq.test'); calls.push(u);
    const waterway = u.searchParams.get('category') === 'waterway';
    const second = u.searchParams.get('offset') === '1000';
    return Response.json({ type: 'FeatureCollection', features: [feature(waterway ? second ? 'drain' : 'stream' : 'lake')], nextOffset: waterway && !second ? 1000 : null });
  };
  const result = await loadMapWater('66,39,67,40', new AbortController().signal, fetcher);
  assert.deepEqual(result.features.map(f => f.properties?.id).sort(), ['drain', 'lake', 'stream']);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(u => !u.searchParams.has('kind')));
});

test('failed or cancelled water refreshes do not resolve as empty overlays', async () => {
  await assert.rejects(loadMapWater('66,39,67,40', new AbortController().signal, async () => new Response('', { status: 503 })));
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(loadMapWater('66,39,67,40', controller.signal, async () => { calls++; return Response.json({ features: [] }); }));
  assert.equal(calls, 0);
});

test('flat map overlay preserves the complete real water inventory across pages', async () => {
  const result = await loadMapWater('55,36,74,46', new AbortController().signal, async url => {
    const p = new URL(String(url), 'https://ariq.test').searchParams;
    return Response.json(featuresGeoJson({ category:p.get('category')!, bbox:[55,36,74,46], limit:Number(p.get('limit')), offset:Number(p.get('offset')) }));
  });
  const expected = foundationFeatures.filter(f => f.geometry && ['waterway','water-body'].includes(f.category));
  assert.equal(result.features.length, expected.length);
  assert.deepEqual(new Set(result.features.map(f => f.properties?.id)), new Set(expected.map(f => f.id)));
  assert.ok(result.features.some(f => f.properties?.kind === 'stream'));
  assert.ok(result.features.some(f => f.properties?.kind === 'drain'));
});
