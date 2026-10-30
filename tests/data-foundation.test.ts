import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GridIndex, foundationCatalog, foundationConflicts, foundationFeatures, foundationIndex, foundationRegions,
  foundationSeries, featuresGeoJson, geometryBbox, nearestFeatures, regionSummary, searchFeatures, searchSeries,
} from '../lib/data-foundation.ts';
import { GET as featuresGET } from '../app/api/water-data/route.ts';
import { GET as regionsGET } from '../app/api/water-data/regions/route.ts';
import { GET as catalogGET } from '../app/api/water-data/catalog/route.ts';
import { GET as seriesGET } from '../app/api/water-data/series/route.ts';
import { GET as nearestGET } from '../app/api/water-data/nearest/route.ts';

test('nationwide coverage: all 14 first-level regions including Karakalpakstan and Tashkent city', () => {
  assert.equal(foundationRegions.length, 14);
  const names = foundationRegions.map(r => r.nameEn);
  for (const expected of ['Republic of Karakalpakstan', 'Tashkent', 'Samarqand Region', 'Xorazm Region', 'Navoiy Region']) assert.ok(names.includes(expected), expected);
  assert.ok(foundationRegions.every(r => r.centre && r.bbox));
  const summary = regionSummary();
  assert.equal(summary.length, 14);
  assert.ok(summary.find(s => (s.region.nameEn ?? '').includes('Samarqand'))!.featureCount > 0);
});

test('ingested feature volume and kinds: OSM nationwide plus Feature 2 sources, no duplicates', () => {
  assert.ok(foundationFeatures.length > 5900, `got ${foundationFeatures.length}`);
  const ids = foundationFeatures.map(f => f.id);
  assert.equal(new Set(ids).size, ids.length);
  const kinds = new Set(foundationFeatures.map(f => f.kind));
  for (const k of ['river', 'canal', 'drain', 'reservoir', 'dam', 'pumping-station']) assert.ok(kinds.has(k), k);
  assert.ok(foundationFeatures.filter(f => f.category === 'waterway').length > 4000);
  assert.ok(foundationFeatures.some(f => f.id === 'kattakurgan-reservoir'));
});

test('geographic validity: every geometry lies in/near Uzbekistan bounds, lines simplified honestly', () => {
  for (const f of foundationFeatures) {
    const box = geometryBbox(f);
    if (!box) continue;
    // Border waterways (e.g. Amu Darya boundary segments) legitimately reach ~36.96 latitude.
    assert.ok(box[0] >= 54 && box[2] <= 74.5 && box[1] >= 36.5 && box[3] <= 46, `${f.id}: ${box}`);
    if (f.geometry?.type === 'LineString') {
      assert.ok(f.geometry.coordinates.length >= 2 && f.geometry.coordinates.length <= 45);
      assert.ok((f.geometry.simplifiedFromPoints ?? 0) >= f.geometry.coordinates.length);
    }
  }
});

test('grid index bbox results equal brute-force scan (index correctness)', () => {
  const boxes: [number, number, number, number][] = [[66, 39.5, 67.5, 40.5], [55.9, 41, 62.5, 45.6], [69, 41.1, 69.6, 41.5], [60, 38, 74, 46]];
  for (const bbox of boxes) {
    const indexed = foundationIndex.bboxQuery(bbox).map(f => f.id);
    const brute = foundationFeatures.filter(f => {
      const b = geometryBbox(f);
      return b && b[0] <= bbox[2] && b[2] >= bbox[0] && b[1] <= bbox[3] && b[3] >= bbox[1];
    }).map(f => f.id).sort();
    assert.deepEqual(indexed, brute, `bbox ${bbox}`);
  }
  const fresh = new GridIndex(foundationFeatures.slice(0, 50), 1);
  assert.ok(fresh.size > 0);
});

test('proximity is not connectivity: nearest works and every feature declares connectivity status', () => {
  const near = nearestFeatures(39.79, 66.24, 3);
  assert.ok(near.length === 3 && near[0].distanceKm <= near[1].distanceKm);
  assert.ok(near.some(n => n.feature.id === 'kattakurgan-reservoir'));
  assert.ok(foundationFeatures.every(f => typeof f.connectivity.status === 'string' && f.connectivity.status.length > 0));
  assert.ok(foundationFeatures.filter(f => f.sourceDataset === 'openstreetmap-uzbekistan').every(f => f.connectivity.status === 'not-verified'));
});

test('catalog records ingested and attempted sources with licenses and reasons for gaps', () => {
  const datasets = foundationCatalog.datasets as { id: string; status: string; license: string }[];
  const byStatus = (s: string) => datasets.filter(d => d.status === s).map(d => d.id);
  assert.ok(byStatus('ingested').length >= 5);
  for (const gap of ['fao-wapor', 'jrc-global-surface-water', 'uzhydromet-monitoring', 'grdc']) assert.ok(byStatus('attempted-not-ingested').includes(gap), gap);
  assert.ok(datasets.every(d => d.license && d.license.length > 3));
  assert.ok(datasets.find(d => d.id === 'openstreetmap-uzbekistan')!.license.includes('ODbL'));
});

test('series integrity: kinds are honest, ERA5 is modeled (never observed), yearbook/WB are reported', () => {
  assert.ok(foundationSeries.length >= 45);
  const kinds = new Set(foundationSeries.map(s => s.measurementKind));
  assert.ok(kinds.has('modeled-reanalysis') && kinds.has('reported-basin-statistic') && kinds.has('reported-country-statistic'));
  assert.ok(!foundationSeries.some(s => s.measurementKind === 'observed'), 'no series may claim observed without a gauging source');
  const era5 = foundationSeries.filter(s => s.sourceDataset === 'open-meteo-era5-archive');
  assert.equal(era5.length, 14);
  assert.ok(era5.every(s => s.values.length === 120));
  const samarqand = era5.find(s => s.region === 'Samarqand Region')!;
  const jan2015 = samarqand.values.find(v => (v as { month: string }).month === '2015-01') as unknown as { precipitationMm: number; temperatureMeanC: number };
  assert.ok(jan2015.precipitationMm >= 0 && jan2015.temperatureMeanC < 15);
  const yb = searchSeries({ sourceDataset: 'icwc-cawater-yearbook' });
  assert.equal(yb.length, 7);
  assert.equal((yb.find(s => s.id.endsWith('amu-kerki-flow'))!.values[0] as { value: number }).value, 64.42);
  const wb = searchSeries({ sourceDataset: 'world-bank-api', q: 'Renewable internal freshwater' });
  assert.ok(wb.some(s => s.country === 'Uzbekistan') && wb.some(s => (s.country ?? '').includes('upstream')));
  assert.ok(foundationSeries.every(s => typeof (s.provenance as { url: string }).url === 'string' && (s.provenance as { license: string }).license.length > 0));
});

test('conflicts register reconciles without discarding evidence', () => {
  const entries = foundationConflicts.entries as { id: string; status: string }[];
  assert.ok(entries.length >= 7);
  assert.ok(entries.some(e => e.id === 'cawater-sum-vs-aquastat-national' && e.status === 'explained-not-a-conflict'));
  assert.ok(entries.some(e => e.id === 'osm-shared-waterway-names'));
  assert.ok(entries.every(e => e.status !== 'discarded' && e.status !== 'merged-silently'));
});

test('feature search, basin/region filters and GeoJSON shape', () => {
  assert.ok(searchFeatures({ basin: 'Zarafshan' }).total >= 4);
  assert.ok(searchFeatures({ region: 'Samarqand Region', kind: 'canal' }).total > 0);
  assert.ok(searchFeatures({ region: 'Samarqand Region', kind: 'reservoir' }).total >= 2);
  assert.equal(searchFeatures({ q: 'kattakurgan' }).results[0].id, 'kattakurgan-reservoir');
  assert.throws(() => searchFeatures({ bbox: [70, 40, 60, 41] }));
  const geo = featuresGeoJson({ bbox: [66, 39.5, 67.5, 40.5] });
  assert.equal(geo.type, 'FeatureCollection');
  assert.ok(geo.features.length > 10);
  assert.ok(geo.features.every(f => f.properties.connectivityStatus));
});

test('APIs: features, geojson, regions, catalog, series, nearest, validation errors', async () => {
  const list = await (await featuresGET(new Request('http://127.0.0.1/api/water-data?region=Samarqand%20Region&kind=reservoir'))).json();
  assert.ok(list.total >= 2, `Samarkand reservoirs via unified region name, got ${list.total}`);
  const geoRes = await featuresGET(new Request('http://127.0.0.1/api/water-data?format=geojson&bbox=66,39.5,67.5,40.5'));
  assert.equal((await geoRes.json()).type, 'FeatureCollection');
  const regions = await (await regionsGET()).json();
  assert.equal(regions.count, 14);
  const catalog = await (await catalogGET()).json();
  assert.ok(catalog.conflicts.entries.length >= 7);
  const series = await (await seriesGET(new Request('http://127.0.0.1/api/water-data/series?measurementKind=modeled-reanalysis'))).json();
  assert.equal(series.total, 14);
  const near = await (await nearestGET(new Request('http://127.0.0.1/api/water-data/nearest?lat=39.79&lon=66.24&k=2'))).json();
  assert.match(near.note, /does not imply hydraulic connectivity/);
  assert.equal((await featuresGET(new Request('http://127.0.0.1/api/water-data?bbox=1,2,3'))).status, 400);
  assert.equal((await nearestGET(new Request('http://127.0.0.1/api/water-data/nearest?lat=999&lon=66'))).status, 400);
});
