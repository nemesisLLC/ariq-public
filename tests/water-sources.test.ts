import test from 'node:test';
import assert from 'node:assert/strict';
import { getWaterSource, searchWaterSources, waterDataset, waterSources, waterSourcesGeoJson, waterStatistics } from '../lib/water-sources.ts';
import { GET as listGET } from '../app/api/water-sources/route.ts';
import { GET as oneGET } from '../app/api/water-sources/[id]/route.ts';

const reservoirs = waterSources.filter(r => r.kind === 'reservoir');
const rivers = waterSources.filter(r => r.kind === 'river');

test('dataset contains the full CAWater reservoir inventory plus named rivers, Samarkand/Zarafshan first-class', () => {
  assert.equal(reservoirs.length, 24);
  assert.ok(rivers.length >= 8);
  const samarkand = reservoirs.filter(r => r.region === 'Samarkand');
  assert.deepEqual(samarkand.map(r => r.id).sort(), ['akdarya-reservoir', 'kattakurgan-reservoir']);
  assert.ok(samarkand.every(r => r.basin === 'Zarafshan'));
  // Hand-checked against the CAWater page: Kattakurgan 900 / Akdarya 112.5 million m3 design total.
  assert.equal(getWaterSource('kattakurgan-reservoir')!.storage!.designTotalMillionM3, 900);
  assert.equal(getWaterSource('akdarya-reservoir')!.storage!.designTotalMillionM3, 112.5);
  assert.equal(getWaterSource('charvak-reservoir')!.hydropowerDesignMW, 600);
});

test('no duplicate ids, names, or OSM elements; ids are stable slugs', () => {
  const ids = waterSources.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => /^[a-z0-9-]+$/.test(id)));
  const osmKeys = waterSources.filter(r => r.osm).map(r => `${r.osm!.type}/${r.osm!.id}`);
  assert.equal(new Set(osmKeys).size, osmKeys.length);
});

test('coordinates are valid Uzbekistan-area points or honestly null', () => {
  for (const r of waterSources) {
    if (r.location === null) {
      // A null location may still cite a verified OSM element only when it points at held geometry, never at a guessed point.
      if (r.osm !== null) assert.ok(r.geometryRef, `${r.id}: OSM element cited without either location or geometry`);
      continue;
    }
    const { latitude, longitude } = r.location;
    assert.ok(latitude >= 37 && latitude <= 46 && longitude >= 55 && longitude <= 74, `${r.id}: ${latitude},${longitude}`);
    assert.ok(r.osm && r.osm.url === `https://www.openstreetmap.org/${r.osm.type}/${r.osm.id}`);
  }
  // Aktepa is ambiguous in OSM (two nearby Oqtepa bodies): coordinates must stay null.
  assert.equal(getWaterSource('aktepa-reservoir')!.location, null);
  assert.ok(getWaterSource('aktepa-reservoir')!.quality.notes.some(n => n.includes('ambiguous')));
  assert.ok(waterSources.filter(r => r.location).length >= 23);
});

test('units and capacity semantics: design only, measured always null, sums checked with source discrepancies noted', () => {
  for (const r of reservoirs) {
    const s = r.storage!;
    assert.equal(s.kind, 'design-capacity');
    assert.equal(s.measuredStorageMillionM3, null, `${r.id}: design data must not masquerade as measured storage`);
    assert.equal(s.measuredAsOf, null);
    for (const v of [s.designTotalMillionM3, s.activeMillionM3, s.deadMillionM3]) assert.ok(v === null || (Number.isFinite(v) && v > 0));
    if (s.designTotalMillionM3 !== null && s.activeMillionM3 !== null && s.deadMillionM3 !== null) {
      const sum = s.activeMillionM3 + s.deadMillionM3;
      if (Math.abs(sum - s.designTotalMillionM3) > 0.11) {
        assert.ok(r.quality.notes.some(n => n.includes('Source inconsistency')), `${r.id}: sum ${sum} vs total ${s.designTotalMillionM3} must be flagged`);
      }
    }
  }
  for (const r of rivers) {
    assert.equal(r.discharge!.observedMeanM3S, null);
    assert.equal(r.discharge!.modeledMeanM3S, null);
    assert.match(r.discharge!.modeledKind, /not-extracted/);
  }
  // Kattakurgan normal level was an inconsistent source value and is stored null, with the reason kept.
  assert.equal(getWaterSource('kattakurgan-reservoir')!.storage!.normalLevelM, null);
  assert.ok(getWaterSource('kattakurgan-reservoir')!.quality.notes.some(n => n.includes('31.5')));
});

test('every record carries resolvable provenance with URLs and retrieval dates', () => {
  for (const r of waterSources) {
    assert.ok(r.provenance.length >= 1, r.id);
    for (const p of r.provenance) {
      assert.ok(/^https:\/\//.test(p.url), `${r.id}: ${p.url}`);
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(p.retrievedAt));
      assert.ok(p.sourceId.length > 0);
    }
  }
  const sourceIds = new Set(waterSources.flatMap(r => r.provenance.map(p => p.sourceId)));
  for (const id of ['cawater-reservoirs-uz', 'hydrosheds-hydrorivers']) assert.ok([...sourceIds].some(s => s.startsWith(id)), id);
  assert.ok(waterDataset.sources.some(s => s.sourceId === 'siat-3506'));
  assert.ok(waterDataset.sources.some(s => s.sourceId === 'fao-aquastat-2012'));
});

test('statistics keep official units, years and kinds distinct from source records', () => {
  const siat = waterStatistics.find(s => s.id === 'uz-irrigation-withdrawal-siat')!;
  assert.equal(siat.unit, 'million m3/year');
  assert.equal(siat.values.length, 13);
  assert.deepEqual(siat.values[0], { year: 2013, value: 48912.32 });
  assert.deepEqual(siat.values.at(-1), { year: 2025, value: 40681.0 });
  const aquastat = waterStatistics.find(s => s.id === 'uz-total-dam-capacity-aquastat')!;
  assert.equal(aquastat.unit, 'km3');
  assert.deepEqual(aquastat.values, [{ year: 2012, value: 22.2 }]);
});

test('search, region, basin, bbox and pagination behave deterministically', () => {
  assert.equal(searchWaterSources({ q: 'kattakurgan' }).results[0].id, 'kattakurgan-reservoir');
  assert.equal(searchWaterSources({ q: 'Zarafshan' }).results.some(r => r.id === 'zarafshan-river'), true);
  assert.ok(searchWaterSources({ region: 'Samarkand' }).results.every(r => r.region === 'Samarkand'));
  assert.ok(searchWaterSources({ basin: 'Zarafshan', kind: 'reservoir' }).total >= 4);
  // Samarkand-area bbox contains both Samarkand reservoirs but not Tudakul (Navoi).
  const bbox = searchWaterSources({ bbox: [66.0, 39.5, 67.0, 40.2] });
  assert.ok(bbox.results.some(r => r.id === 'kattakurgan-reservoir'));
  assert.ok(!bbox.results.some(r => r.id === 'tudakul-reservoir'));
  assert.equal(searchWaterSources({ q: 'no-such-water-body' }).total, 0);
  const page1 = searchWaterSources({ limit: 5, offset: 0 }), page2 = searchWaterSources({ limit: 5, offset: 5 });
  assert.equal(page1.results[0].id, 'akdarya-reservoir');
  assert.ok(page1.results.every(r => !page2.results.includes(r)));
  assert.throws(() => searchWaterSources({ bbox: [70, 40, 60, 41] }));
  assert.throws(() => searchWaterSources({ limit: 0 }));
});

test('GeoJSON output is MapLibre/Three-ready: Point features in [lon, lat], no guessed positions', () => {
  const geo = waterSourcesGeoJson();
  assert.equal(geo.type, 'FeatureCollection');
  for (const f of geo.features) {
    assert.equal(f.geometry.type, 'Point');
    const [lon, lat] = f.geometry.coordinates;
    assert.ok(lon >= 55 && lon <= 74 && lat >= 37 && lat <= 46);
    assert.equal(f.properties.storageKind, f.properties.kind === 'reservoir' ? 'design-capacity' : null);
  }
  assert.ok(geo.excludedWithoutCoordinates.includes('aktepa-reservoir'));
  assert.ok(geo.excludedWithoutCoordinates.includes('amu-darya-river'));
  const zar = waterSourcesGeoJson({ basin: 'Zarafshan' });
  assert.ok(zar.features.length >= 4);
});

test('API routes: list, search, geojson, single record, 404 and 400', async () => {
  const list = await listGET(new Request('http://127.0.0.1/api/water-sources?region=Samarkand'));
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.equal(listBody.total, 2);
  assert.equal(listBody.kind, 'compiled-from-cited-sources');
  const geo = await (await listGET(new Request('http://127.0.0.1/api/water-sources?format=geojson&basin=Zarafshan'))).json();
  assert.equal(geo.type, 'FeatureCollection');
  const one = await oneGET(new Request('http://127.0.0.1/api/water-sources/kattakurgan-reservoir'), { params: Promise.resolve({ id: 'kattakurgan-reservoir' }) });
  assert.equal(one.status, 200);
  assert.equal((await one.json()).storage.designTotalMillionM3, 900);
  const missing = await oneGET(new Request('http://127.0.0.1/api/water-sources/nope'), { params: Promise.resolve({ id: 'nope' }) });
  assert.equal(missing.status, 404);
  const bad = await listGET(new Request('http://127.0.0.1/api/water-sources?bbox=1,2,3'));
  assert.equal(bad.status, 400);
  const stats = await (await listGET(new Request('http://127.0.0.1/api/water-sources?include=statistics'))).json();
  assert.equal(stats.statistics.length, 2);
});
