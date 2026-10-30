import test from 'node:test';
import assert from 'node:assert/strict';
import { geodesicAreaM2, lonLatToWorld, worldToLonLat, representativePoint, rectangleRing, pointInRing, scanlineMask, fillInteriorHoles, UZ_BBOX } from '../app/atlas/geo.ts';

test('projection round-trips lon/lat across Uzbekistan', () => {
  for (const [lon, lat] of [[56.0, 45.5], [73.2, 40.8], [64.62, 41.32], [59.0, 37.2]] as const) {
    const [x, z] = lonLatToWorld(lon, lat);
    const [lon2, lat2] = worldToLonLat(x, z);
    assert.ok(Math.abs(lon2 - lon) < 1e-9, `lon ${lon2} != ${lon}`);
    assert.ok(Math.abs(lat2 - lat) < 1e-9, `lat ${lat2} != ${lat}`);
  }
  // North must be -z, east +x
  const [xEast] = lonLatToWorld(70, 41.32);
  const [, zNorth] = lonLatToWorld(64.62, 44);
  assert.ok(xEast > 0 && zNorth < 0);
});

test('geodesic area: 1km x 1km square near Tashkent is ~1,000,000 m2', () => {
  // 0.01 deg lat ~ 1111.95 m; 0.01 deg lon at 41.3N ~ 835.6 m -> area ~929,000 m2
  const ring = rectangleRing([69.24, 41.30], [69.25, 41.31]);
  const area = geodesicAreaM2(ring);
  assert.ok(area > 900_000 && area < 960_000, `area ${area}`);
  // Known check: a 1x1 degree cell at the equator is ~ (111319.5 m)^2 = 1.239e10 m2
  const eq = geodesicAreaM2(rectangleRing([0, 0], [1, 1]));
  assert.ok(eq > 1.22e10 && eq < 1.26e10, `equator cell ${eq}`);
  assert.equal(geodesicAreaM2([[0, 0], [1, 1]]), 0);
});

test('representative point of a square is its centre', () => {
  const [lon, lat] = representativePoint(rectangleRing([66.9, 39.6], [67.0, 39.7]));
  assert.ok(Math.abs(lon - 66.95) < 0.01 && Math.abs(lat - 39.65) < 0.01, `${lon},${lat}`);
});

test('pointInRing and scanline mask agree on a synthetic country', () => {
  const square: [number, number][] = [[60, 38], [70, 38], [70, 44], [60, 44], [60, 38]];
  assert.equal(pointInRing(65, 41, square), true);
  assert.equal(pointInRing(57, 41, square), false);
  // Temporarily mask over the real bbox grid: square spans lon 60-70, lat 38-44
  const W = 88, H = 45;
  const mask = scanlineMask([square], W, H);
  const dx = (UZ_BBOX.maxLon - UZ_BBOX.minLon) / (W - 1);
  const dy = (UZ_BBOX.maxLat - UZ_BBOX.minLat) / (H - 1);
  let insideCount = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const lon = UZ_BBOX.minLon + c * dx;
    const lat = UZ_BBOX.maxLat - r * dy;
    const expected = lon > 60.2 && lon < 69.8 && lat > 38.2 && lat < 43.8 ? 1 : 0;
    if (Math.abs(lon - 60) > 0.3 && Math.abs(lon - 70) > 0.3 && Math.abs(lat - 38) > 0.3 && Math.abs(lat - 44) > 0.3) {
      assert.equal(mask[r * W + c], expected, `mask mismatch at ${lon},${lat}`);
    }
    insideCount += mask[r * W + c];
  }
  assert.ok(insideCount > 1200 && insideCount < 1800, `inside ${insideCount}`);
});

test('fillInteriorHoles fills enclosed gaps but keeps the exterior empty', () => {
  const W = 7, H = 7;
  const m = new Uint8Array(W * H);
  for (let r = 2; r <= 4; r++) for (let c = 2; c <= 4; c++) m[r * W + c] = 1;
  m[3 * W + 3] = 0; // enclosed gap
  const filled = fillInteriorHoles(m, W, H);
  assert.equal(filled[3 * W + 3], 1);
  assert.equal(filled[0], 0);
  assert.equal(filled[3 * W + 0], 0);
});
