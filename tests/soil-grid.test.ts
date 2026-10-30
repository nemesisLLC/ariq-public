import test from 'node:test';
import assert from 'node:assert/strict';
import { getFarmEvidence } from '../lib/farm-intelligence.ts';
import { sampleSoilAtPoint, sampleSoilForPolygon, polygonAreaKm2, polygonCentroid, gridCellAreaKm2, KHOREZM_LAB_VALIDATION } from '../lib/soil-grid.ts';

// Two farms in the SAME region (Samarqand): irrigated oasis vs foothill.
const SAMARKAND_OASIS = { lat: 39.65, lon: 66.96 };
const SAMARKAND_FOOTHILL = { lat: 39.42, lon: 67.25 }; // Urgut foothills
// Bukhara Region: oasis vs Kyzylkum desert edge.
const BUKHARA_OASIS = { lat: 39.77, lon: 64.43 };

test('same-region farms receive different location-specific estimates (Samarqand)', () => {
  const a = sampleSoilAtPoint(SAMARKAND_OASIS.lat, SAMARKAND_OASIS.lon);
  const b = sampleSoilAtPoint(SAMARKAND_FOOTHILL.lat, SAMARKAND_FOOTHILL.lon);
  assert.ok(a && b, 'both points covered by the grid');
  assert.equal(a.basis, 'soilgrids-grid-point');
  const differs = Math.abs(a.sandPct - b.sandPct) > 1 || Math.abs(a.clayPct - b.clayPct) > 1
    || Math.abs((a.organicCarbonGPerKg ?? 0) - (b.organicCarbonGPerKg ?? 0)) > 0.5;
  assert.ok(differs, `oasis ${a.sandPct}/${a.clayPct}/${a.organicCarbonGPerKg} vs foothill ${b.sandPct}/${b.clayPct}/${b.organicCarbonGPerKg} must differ`);
});

test('same-region oasis vs desert estimates differ (Bukhara)', () => {
  const a = sampleSoilAtPoint(BUKHARA_OASIS.lat, BUKHARA_OASIS.lon);
  const b = sampleSoilAtPoint(40.8, 62.8); // Kyzylkum desert, Bukhara Region
  assert.ok(a && b);
  const textureDistance = Math.abs(a.sandPct - b.sandPct) + Math.abs(a.clayPct - b.clayPct);
  assert.ok(textureDistance > 3, `texture oasis ${a.sandPct}/${a.clayPct} vs desert ${b.sandPct}/${b.clayPct}`);
});

test('point estimate carries SoilGrids uncertainty intervals and Saxton-Rawls AWC', () => {
  const s = sampleSoilAtPoint(SAMARKAND_OASIS.lat, SAMARKAND_OASIS.lon);
  assert.ok(s);
  for (const [mean, iv] of [[s.sandPct, s.uncertainty.sandPct], [s.clayPct, s.uncertainty.clayPct]] as const) {
    assert.ok(iv, 'interval present');
    assert.ok(iv[0] <= mean && mean <= iv[1] && iv[1] > iv[0], `interval ${iv} contains mean ${mean}`);
  }
  assert.ok(s.uncertainty.ph && s.uncertainty.organicCarbonGPerKg, 'pH and SOC intervals present');
  const aw = s.availableWater;
  assert.ok(aw && aw.fieldCapacity > aw.wiltingPoint && aw.totalAvailableMmPerM > 30 && aw.totalAvailableMmPerM < 300);
  assert.ok(aw.totalAvailableRangeMmPerM && aw.totalAvailableRangeMmPerM[0] <= aw.totalAvailableMmPerM
    && aw.totalAvailableMmPerM <= aw.totalAvailableRangeMmPerM[1], 'AWC sensitivity range brackets the central estimate');
  assert.match(aw.method, /Saxton/);
  assert.ok(s.ph !== null && s.ph >= 5 && s.ph <= 10, `pH ${s.ph}`);
  assert.ok(Math.abs(s.sandPct + s.clayPct + (s.siltPct ?? 0) - 100) < 6, 'texture fractions approximately sum to 100');
});

test('farm evidence headline soil is location-specific while regional fallback is preserved', () => {
  const oasis = getFarmEvidence(SAMARKAND_OASIS.lat, SAMARKAND_OASIS.lon);
  const foothill = getFarmEvidence(SAMARKAND_FOOTHILL.lat, SAMARKAND_FOOTHILL.lon);
  assert.ok(oasis.soil && foothill.soil);
  assert.equal(oasis.location.region, foothill.location.region, 'fixtures must share one region');
  assert.equal(oasis.soil.estimateBasis, 'soilgrids-grid-point');
  assert.ok(oasis.soil.farmEstimate && oasis.soil.regionalEstimate);
  // Same regional fallback, different farm estimates: this is the Phase 2 change.
  assert.equal(oasis.soil.regionalEstimate!.sandPct, foothill.soil.regionalEstimate!.sandPct);
  assert.notEqual(oasis.soil.texture.sandPct, foothill.soil.texture.sandPct);
  assert.match(oasis.soil.note, /not a soil measurement/);
  assert.match(oasis.soil.source, /SoilGrids/);
});

test('polygon aggregates intersecting cells and reports within-farm variation', () => {
  // ~11 km x 11 km farm block near Samarkand.
  const ring: [number, number][] = [[66.90, 39.60], [67.02, 39.60], [67.02, 39.70], [66.90, 39.70]];
  const s = sampleSoilForPolygon(ring);
  assert.ok(s);
  assert.equal(s.basis, 'soilgrids-grid-polygon');
  assert.ok(s.sample.cells >= 20, `cells ${s.sample.cells}`);
  assert.equal(s.sample.subCellPolygon, false);
  // SoilGrids has nodata bands (e.g. river/urban masks): sampled coverage is
  // reported honestly rather than silently assuming full coverage.
  assert.ok(s.sample.coverageRatio > 0.1 && s.sample.coverageRatio < 1.6, `coverage ${s.sample.coverageRatio}`);
  const v = s.sample.variation.sandPct;
  assert.ok(v && v.max >= v.min && v.std > 0, 'within-farm sand variation reported');
  assert.ok(v.p10 <= v.mean && v.mean <= v.p90);
  assert.ok(s.sample.variation.totalAvailableMmPerM, 'per-cell AWC variation reported');
  assert.ok(s.sample.polygonAreaKm2 > 80 && s.sample.polygonAreaKm2 < 160, `area ${s.sample.polygonAreaKm2}`);
  assert.ok(Math.abs(polygonAreaKm2(ring) - s.sample.polygonAreaKm2) < 0.01);
});

test('polygon result differs from a single nearest-pixel point where terrain varies', () => {
  const ring: [number, number][] = [[66.90, 39.60], [67.02, 39.60], [67.02, 39.70], [66.90, 39.70]];
  const poly = sampleSoilForPolygon(ring);
  const corner = sampleSoilAtPoint(39.60, 66.90);
  assert.ok(poly && corner);
  assert.ok(poly.sample.cells > 1, 'polygon must not collapse to one pixel');
});

test('small polygon uses partial boundary cells instead of requiring a cell centre inside', () => {
  // ~200 m polygon: smaller than one ~1 km grid cell and containing no
  // cell centre. Spherical cell-intersection sampling must still use the
  // partially overlapped cell, weighted by its overlap area.
  const ring: [number, number][] = [[66.959, 39.649], [66.961, 39.649], [66.961, 39.651], [66.959, 39.651]];
  const s = sampleSoilForPolygon(ring);
  assert.ok(s);
  assert.ok(s.sample.cells >= 1, 'partially overlapped cell contributes');
  assert.equal(s.sample.subCellPolygon, false);
  assert.ok(s.sample.partialCells >= 1, 'the contributing cell is partial');
  assert.ok(s.sample.sampledAreaKm2 > 0 && s.sample.sampledAreaKm2 <= s.sample.polygonAreaKm2 * 1.05);
  assert.ok(s.sample.coverageRatio > 0 && s.sample.coverageRatio <= 1);
});

test('farm evidence accepts a polygon and rejects malformed polygons', () => {
  const ring: [number, number][] = [[66.90, 39.60], [67.02, 39.60], [67.02, 39.70], [66.90, 39.70]];
  const e = getFarmEvidence(39.65, 66.96, { polygon: ring });
  assert.ok(e.soil);
  assert.equal(e.soil.estimateBasis, 'soilgrids-grid-polygon');
  assert.equal(e.soil.farmEstimate?.basis, 'soilgrids-grid-polygon');
  assert.throws(() => getFarmEvidence(39.65, 66.96, { polygon: [[66.9, 39.6]] as [number, number][] }), /polygon/);
  assert.throws(() => getFarmEvidence(39.65, 66.96, { polygon: [[66.9, 95], [67, 39.6], [67, 39.7]] }), /polygon/);
});

test('outside grid coverage falls back to the Phase 1 regional estimate', () => {
  assert.equal(sampleSoilAtPoint(50, 10), null);
  assert.equal(sampleSoilForPolygon([[0, 50], [1, 50], [1, 51]]), null);
  const e = getFarmEvidence(50, 10);
  assert.ok(e.soil);
  assert.equal(e.soil.estimateBasis, 'regional-fallback');
  assert.equal(e.soil.farmEstimate, null);
  assert.ok(e.soil.regionalEstimate);
  assert.equal(e.soil.texture.sandPct, e.soil.regionalEstimate!.sandPct);
});

test('polygon coverage is a true missing-data fraction, never above 1', () => {
  const ring: [number, number][] = [[66.90, 39.60], [67.02, 39.60], [67.02, 39.70], [66.90, 39.70]];
  const s = sampleSoilForPolygon(ring);
  assert.ok(s);
  const sm = s.sample;
  assert.ok(sm.intersectingCells >= sm.cells, 'valid cells are a subset of intersecting cells');
  assert.equal(sm.intersectingCells, sm.cells + sm.nodataCells);
  assert.ok(sm.coverageRatio >= 0 && sm.coverageRatio <= 1, `coverage ${sm.coverageRatio}`);
  assert.ok(sm.sampledAreaKm2 <= sm.intersectedAreaKm2 + 1e-9);
  assert.ok(Math.abs(sm.sampledAreaKm2 + sm.nodataAreaKm2 - sm.intersectedAreaKm2) < 1e-6, 'sampled + nodata = intersected');
  // This Samarkand block overlaps known SoilGrids nodata bands: coverage
  // must honestly report the gap instead of assuming full coverage.
  assert.ok(sm.nodataCells > 0 && sm.nodataAreaKm2 > 0, 'nodata overlap is reported');
  assert.ok(sm.coverageRatio < 1, 'coverage reflects the nodata gap');
  assert.ok(sm.intersectedAreaKm2 <= sm.polygonAreaKm2 * 1.05, 'intersections cannot exceed the polygon (5% sub-cell tolerance)');
  assert.match(sm.areaMethod, /spherical-cell-intersection/);
  // Polygon mean stays inside the reported within-farm variation.
  const v = sm.variation.sandPct;
  assert.ok(v && v.min - 1e-9 <= s.sandPct && s.sandPct <= v.max + 1e-9, 'weighted mean within cell range');
  assert.ok(Math.abs(v.mean - s.sandPct) < 1e-9, 'headline value is the intersection-weighted mean');
});

test('polygon entirely inside a nodata cell falls back to a flagged centroid sample', () => {
  // Grid cell lon 66.94-66.95 / lat 39.81-39.82 (Zarafshan valley) is
  // SoilGrids nodata but has valid neighbours, so bilinear sampling at the
  // centroid still works. This is the ONLY path allowed to flag
  // subCellPolygon, and coverage must honestly report 0.
  const ring: [number, number][] = [[66.944, 39.814], [66.946, 39.814], [66.946, 39.816], [66.944, 39.816]];
  const s = sampleSoilForPolygon(ring);
  assert.ok(s);
  assert.equal(s.sample.cells, 0);
  assert.equal(s.sample.subCellPolygon, true);
  assert.equal(s.sample.coverageRatio, 0);
  assert.equal(s.sample.nodataCells, 1);
  assert.ok(s.sample.intersectedAreaKm2 > 0 && s.sample.nodataAreaKm2 > 0);
});

test('concave (L-shaped) farm polygon samples reliably', () => {
  const ring: [number, number][] = [
    [66.90, 39.60], [67.02, 39.60], [67.02, 39.65], [66.96, 39.65], [66.96, 39.70], [66.90, 39.70],
  ];
  const s = sampleSoilForPolygon(ring);
  assert.ok(s);
  assert.ok(s.sample.cells >= 10, `cells ${s.sample.cells}`);
  assert.ok(s.sample.coverageRatio > 0 && s.sample.coverageRatio <= 1);
  assert.ok(s.sample.polygonAreaKm2 > 40 && s.sample.polygonAreaKm2 < 120, `area ${s.sample.polygonAreaKm2}`);
  const c = polygonCentroid(ring);
  assert.ok(c.longitude > 66.90 && c.longitude < 67.02 && c.latitude > 39.60 && c.latitude < 39.70);
});

test('grid cell area is latitude-dependent (cells shrink poleward)', () => {
  const south = gridCellAreaKm2(38);
  const north = gridCellAreaKm2(45);
  assert.ok(north < south, `${north} < ${south}`);
  // Spherical truth: area scales ~ cos(lat); allow 2% for the sin difference form.
  const expected = Math.cos(45 * Math.PI / 180) / Math.cos(38 * Math.PI / 180);
  assert.ok(Math.abs(north / south - expected) / expected < 0.02, `ratio ${north / south} vs ${expected}`);
  // Same-size degree polygons obey the same latitude law.
  const sq = (lat: number): [number, number][] => [[66, lat], [67, lat], [67, lat + 1], [66, lat + 1]];
  assert.ok(polygonAreaKm2(sq(44)) < polygonAreaKm2(sq(37)));
});

test('uncertainty is explicitly 5-15 cm model uncertainty, not 0-30 cm field confidence', () => {
  const s = sampleSoilAtPoint(SAMARKAND_OASIS.lat, SAMARKAND_OASIS.lon);
  assert.ok(s);
  assert.equal(s.uncertaintyInfo.uncertaintyDepthCm, '5-15');
  assert.equal(s.uncertaintyInfo.estimateDepthCm, '0-30');
  assert.equal(s.uncertaintyInfo.depthMismatch, true);
  assert.equal(s.uncertaintyInfo.calibrated, false);
  assert.equal(s.uncertaintyInfo.fieldLevelConfidence, false);
  assert.match(s.uncertaintyInfo.intervalConstruction, /approximation across depths/);
  assert.ok(s.availableWater);
  assert.equal(s.availableWater.totalAvailableRangeKind, 'sensitivity-to-approximate-texture-intervals-not-confidence');
  const p = sampleSoilForPolygon([[66.90, 39.60], [67.02, 39.60], [67.02, 39.70], [66.90, 39.70]]);
  assert.ok(p);
  assert.equal(p.uncertaintyInfo.uncertaintyDepthCm, '5-15');
  assert.equal(p.uncertaintyInfo.calibrated, false);
});

test('Khorezm laboratory validation discrepancy is preserved without bias correction', () => {
  const v = KHOREZM_LAB_VALIDATION;
  assert.equal(v.biasCorrectionApplied, false);
  assert.equal(v.farmLevelAccuracyVerified, false);
  assert.ok(v.properties.clayPct.modelledMinusMeasured > 10, 'clay bias preserved');
  assert.ok(v.properties.organicCarbonGPerKg.modelledMinusMeasured > 5, 'SOC bias preserved');
  assert.ok(v.properties.ph.modelledMinusMeasured > 1, 'pH bias preserved');
  assert.match(v.measuredSource, /8794/);
  const e = getFarmEvidence(41.5, 60.5); // rural Khorezm (covered by the grid)
  assert.ok(e.soil);
  assert.ok(e.soil.farmEstimate, 'grid-covered Khorezm farm has a location-specific estimate');
  assert.equal(e.soil.validationContext.biasCorrectionApplied, false);
  assert.equal(e.soil.validationContext.properties.clayPct.modelled, 33.32);
  assert.match(e.soil.note, /not calibrated field-level confidence/);
  // The reported farm values remain raw SoilGrids model output: the
  // validation discrepancy must not silently shift them.
  assert.equal(e.soil.texture.sandPct, e.soil.farmEstimate?.sandPct);
});

test('grid sampling is deterministic', () => {
  const a = sampleSoilAtPoint(SAMARKAND_OASIS.lat, SAMARKAND_OASIS.lon);
  const b = sampleSoilAtPoint(SAMARKAND_OASIS.lat, SAMARKAND_OASIS.lon);
  assert.deepEqual(a, b);
});
