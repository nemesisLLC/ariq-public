import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_REGISTRY, memoryStore, refreshSource, refreshAll, freshnessReport, contentHash } from '../lib/data-refresh.ts';

const forecastPayload = { daily: { time: ['2026-10-27'], et0_fao_evapotranspiration: [3] } };
const jsonFetcher = (payload: unknown, counter?: { calls: number }) => (async () => { if (counter) counter.calls++; return Response.json(payload); }) as unknown as typeof fetch;
const forecast = SOURCE_REGISTRY.find((s) => s.id === 'open-meteo-forecast-uz')!;

test('refresh stores a validated snapshot with provenance; identical content is unchanged (deduped)', async () => {
  const store = memoryStore();
  const counter = { calls: 0 };
  const first = await refreshSource(forecast, { store, fetcher: jsonFetcher(forecastPayload, counter), nowMs: 1000000 });
  assert.equal(first.status, 'updated');
  const second = await refreshSource(forecast, { store, fetcher: jsonFetcher(forecastPayload, counter), nowMs: 2000000 });
  assert.equal(second.status, 'unchanged');
  if (first.status === 'updated') {
    assert.equal(first.snapshot.measurementKind, 'forecast');
    assert.match(first.snapshot.sourceUrl, /open-meteo/);
    assert.equal(first.snapshot.contentHash, contentHash(JSON.stringify(forecastPayload)));
  }
});

test('failure keeps the last verified snapshot; schema failure counts as failure', async () => {
  const store = memoryStore();
  await refreshSource(forecast, { store, fetcher: jsonFetcher(forecastPayload), nowMs: 1000000 });
  const down = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  const kept = await refreshSource(forecast, { store, fetcher: down, nowMs: 3000000 });
  assert.equal(kept.status, 'kept-last-verified');
  const badSchema = await refreshSource(forecast, { store, fetcher: jsonFetcher({ nope: 1 }), nowMs: 4000000 });
  assert.equal(badSchema.status, 'kept-last-verified');
  const fresh = memoryStore();
  const unavailable = await refreshSource(forecast, { store: fresh, fetcher: down });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.snapshot, null);
});

test('non-automated sources never fetch; freshness states are honest', async () => {
  const store = memoryStore();
  const counter = { calls: 0 };
  const outcomes = await refreshAll({ store, fetcher: jsonFetcher(forecastPayload, counter), nowMs: Date.parse('2026-10-27T00:00:00Z') });
  const manual = outcomes.filter((o) => o.status === 'unavailable' && /manual review/.test('error' in o ? o.error : ''));
  assert.ok(manual.length >= 2, 'SIAT and IGRAC remain manual-review');
  const report = freshnessReport(store, Date.parse('2026-10-27T03:00:00Z'));
  assert.equal(report.find((r) => r.sourceId === forecast.id)?.state, 'live');
  assert.equal(report.find((r) => r.sourceId === 'siat-uzstat-water')?.state, 'manual-review');
  const later = freshnessReport(store, Date.parse('2026-10-29T00:00:00Z'));
  assert.equal(later.find((r) => r.sourceId === forecast.id)?.state, 'stale');
});
