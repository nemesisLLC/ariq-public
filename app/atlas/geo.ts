/**
 * Geographic math for the ARIQ 3D atlas.
 *
 * Coordinate contract:
 * - All stored / exchanged coordinates are WGS84 longitude/latitude (GeoJSON order).
 * - The relief model uses a local equirectangular projection centred on Uzbekistan:
 *   x grows east, z grows south (so north is -z, matching a map viewed from above),
 *   y is sculptural height. The projection is for display; all measurements
 *   (area, representative point) are computed geodesically on the sphere.
 */

export type LonLat = [number, number]; // [longitude, latitude]

export const UZ_BBOX = { minLon: 55.9, minLat: 36.9, maxLon: 73.35, maxLat: 45.75 };
export const CENTER_LON = 64.62;
export const CENTER_LAT = 41.32;

const COS_CENTER = Math.cos((CENTER_LAT * Math.PI) / 180);
/** World units across the full bounding box (east-west). */
export const WORLD_WIDTH = 34;
const LON_SPAN_SCALED = (UZ_BBOX.maxLon - UZ_BBOX.minLon) * COS_CENTER;
export const WORLD_PER_DEG_LON = WORLD_WIDTH / LON_SPAN_SCALED;
/**
 * Same world units per degree as longitude before the cos(lat) factor is
 * applied to x (audit G02): east displacement = cos * S per degree, north
 * displacement = S per degree, so their ratio is cos(41.32°) as it should be.
 * The previous extra /COS compressed east-west scale by another cos factor.
 */
export const WORLD_PER_DEG_LAT = WORLD_PER_DEG_LON;
/** Sculptural vertical scale: world units per metre of elevation (~18x true scale). */
export const ELEV_WORLD_PER_M = 0.00038;
export const SKIRT_DEPTH = 1.05;

export function lonLatToWorld(lon: number, lat: number): [number, number] {
  return [(lon - CENTER_LON) * COS_CENTER * WORLD_PER_DEG_LON, -(lat - CENTER_LAT) * WORLD_PER_DEG_LAT];
}

export function worldToLonLat(x: number, z: number): LonLat {
  return [x / (COS_CENTER * WORLD_PER_DEG_LON) + CENTER_LON, CENTER_LAT - z / WORLD_PER_DEG_LAT];
}

export function elevationToWorld(metres: number): number {
  return Math.max(0, metres) * ELEV_WORLD_PER_M;
}

/** Ray-casting point-in-ring test. Ring is an open or closed list of [lon, lat]. */
export function pointInRing(lon: number, lat: number, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygons(lon: number, lat: number, polygons: LonLat[][]): boolean {
  return polygons.some((ring) => pointInRing(lon, lat, ring));
}

/** Keep points at least `minDeg` apart (plus the closing point). Cheap ring simplification for masks. */
export function simplifyRing(ring: LonLat[], minDeg = 0.045): LonLat[] {
  const out: LonLat[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= minDeg) out.push(p);
  }
  if (out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) out.push(first);
  }
  return out;
}

/**
 * Scanline mask over a regular lon/lat grid.
 * Each ring is filled independently (even-odd within the ring) and the results
 * are OR-ed: regional rings simplified independently overlap slightly along
 * shared borders, so a single global even-odd pass would cancel the overlaps
 * and punch holes in the country. Extra rings (exclaves) are filled too; any
 * genuine hole that is itself another region is still covered by that region.
 */
export function scanlineMask(polygons: LonLat[][], gridW: number, gridH: number): Uint8Array {
  const mask = new Uint8Array(gridW * gridH);
  const dx = (UZ_BBOX.maxLon - UZ_BBOX.minLon) / (gridW - 1);
  const dy = (UZ_BBOX.maxLat - UZ_BBOX.minLat) / (gridH - 1);
  type Edge = { x1: number; y1: number; x2: number; y2: number; minLat: number; maxLat: number };
  for (const ring of polygons) {
    const edges: Edge[] = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      if (y1 === y2) continue;
      edges.push({ x1, y1, x2, y2, minLat: Math.min(y1, y2), maxLat: Math.max(y1, y2) });
    }
    for (let row = 0; row < gridH; row++) {
      const lat = UZ_BBOX.maxLat - row * dy;
      const crossings: number[] = [];
      for (const e of edges) {
        if (lat >= e.minLat && lat < e.maxLat) crossings.push(e.x1 + ((lat - e.y1) * (e.x2 - e.x1)) / (e.y2 - e.y1));
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const start = Math.max(0, Math.ceil((crossings[k] - UZ_BBOX.minLon) / dx - 1e-9));
        const end = Math.min(gridW - 1, Math.floor((crossings[k + 1] - UZ_BBOX.minLon) / dx + 1e-9));
        for (let col = start; col <= end; col++) mask[row * gridW + col] = 1;
      }
    }
  }
  return mask;
}

/**
 * Fill interior holes in a grid mask: flood-fill the exterior from the grid
 * border; any 0-cell not reached is enclosed land (a gap between simplified
 * neighbouring borders) and becomes 1. Genuine exterior stays 0.
 */
export function fillInteriorHoles(mask: Uint8Array, gridW: number, gridH: number): Uint8Array {
  const exterior = new Uint8Array(gridW * gridH);
  const stack: number[] = [];
  const push = (i: number) => { if (!mask[i] && !exterior[i]) { exterior[i] = 1; stack.push(i); } };
  for (let c = 0; c < gridW; c++) { push(c); push((gridH - 1) * gridW + c); }
  for (let r = 0; r < gridH; r++) { push(r * gridW); push(r * gridW + gridW - 1); }
  while (stack.length) {
    const i = stack.pop()!;
    const r = Math.floor(i / gridW), c = i % gridW;
    if (r > 0) push(i - gridW);
    if (r < gridH - 1) push(i + gridW);
    if (c > 0) push(i - 1);
    if (c < gridW - 1) push(i + 1);
  }
  const out = new Uint8Array(mask);
  for (let i = 0; i < out.length; i++) if (!out[i] && !exterior[i]) out[i] = 1;
  return out;
}

const EARTH_R = 6371008.8; // IUGG mean radius, metres

/**
 * Geodesic polygon area on the sphere (Chamberlain & Duquette 2007,
 * the formula used by Turf/MapLibre): A = |sum (dlon * (2 + sin(lat1) + sin(lat2)))| * R^2 / 2.
 * Accepts an open ring; closure is applied internally.
 */
export function geodesicAreaM2(ring: LonLat[]): number {
  if (ring.length < 3) return 0;
  const pts = ringClosed(ring);
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [lon1, lat1] = pts[i];
    const [lon2, lat2] = pts[i + 1];
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    total += dLon * (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs((total * EARTH_R * EARTH_R) / 2);
}

export function ringClosed(ring: LonLat[]): LonLat[] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

/** Representative point: spherical centroid (mean of unit vectors). Falls back to vertex mean. */
export function representativePoint(ring: LonLat[]): LonLat {
  const pts = ringClosed(ring).slice(0, -1);
  if (pts.length === 0) return [CENTER_LON, CENTER_LAT];
  let x = 0, y = 0, z = 0;
  for (const [lon, lat] of pts) {
    const lo = (lon * Math.PI) / 180;
    const la = (lat * Math.PI) / 180;
    x += Math.cos(la) * Math.cos(lo);
    y += Math.cos(la) * Math.sin(lo);
    z += Math.sin(la);
  }
  const lon = (Math.atan2(y, x) * 180) / Math.PI;
  const lat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
  return [lon, lat];
}

/** Axis-aligned rectangle ring from two opposite corners (GeoJSON order, open ring). */
export function rectangleRing(a: LonLat, b: LonLat): LonLat[] {
  const minLon = Math.min(a[0], b[0]);
  const maxLon = Math.max(a[0], b[0]);
  const minLat = Math.min(a[1], b[1]);
  const maxLat = Math.max(a[1], b[1]);
  return [[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat]];
}

function segmentsIntersect(a: LonLat, b: LonLat, c: LonLat, d: LonLat): boolean {
  const orient = (p: LonLat, q: LonLat, r: LonLat) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
function pointSegmentDistanceDeg(p: LonLat, a: LonLat, b: LonLat): number {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const t = vx * vx + vy * vy === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

export type PolygonValidation = { ok: true } | { ok: false; reason: string };
/**
 * Bounded farm-polygon validation (audit G05): finite in-range coordinates,
 * 3..200 distinct corners, no repeated consecutive corners, no self-intersection
 * (bow-tie), and a positive geodesic area within sane bounds.
 */
export function validateFarmPolygon(ring: LonLat[]): PolygonValidation {
  if (!Array.isArray(ring) || ring.length < 3 || ring.length > 200) return { ok: false, reason: 'polygon must have 3..200 corners' };
  const pts = ringClosed(ring).slice(0, -1);
  for (const [lon, lat] of pts) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) return { ok: false, reason: 'coordinates out of range' };
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (a[0] === b[0] && a[1] === b[1]) return { ok: false, reason: 'repeated consecutive corner' };
  }
  if (new Set(pts.map((p) => `${p[0]},${p[1]}`)).size !== pts.length) return { ok: false, reason: 'repeated corner' };
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 2; j < pts.length; j++) {
      if (i === 0 && j === pts.length - 1) continue;
      if (segmentsIntersect(pts[i], pts[(i + 1) % pts.length], pts[j], pts[(j + 1) % pts.length])) return { ok: false, reason: 'polygon self-intersects (bow-tie)' };
    }
  }
  const area = geodesicAreaM2(pts);
  if (!(area > 1)) return { ok: false, reason: 'polygon area is effectively zero' };
  if (area > 1e11) return { ok: false, reason: 'polygon area exceeds 10,000,000 ha bound' };
  return { ok: true };
}

/**
 * A point guaranteed inside the polygon (audit G05): the spherical centroid
 * when it lies inside, otherwise the inside grid point furthest from the
 * boundary (deterministic 24x24 search over the bbox).
 */
export function interiorPoint(ring: LonLat[]): LonLat {
  const closed = ringClosed(ring);
  const rep = representativePoint(ring);
  if (pointInRing(rep[0], rep[1], closed)) return rep;
  const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons), minLat = Math.min(...lats), maxLat = Math.max(...lats);
  let best: LonLat = rep, bestScore = -Infinity;
  const N = 24;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const p: LonLat = [minLon + ((maxLon - minLon) * i) / N, minLat + ((maxLat - minLat) * j) / N];
      if (!pointInRing(p[0], p[1], closed)) continue;
      let dMin = Infinity;
      for (let k = 0; k < closed.length - 1; k++) dMin = Math.min(dMin, pointSegmentDistanceDeg(p, closed[k], closed[k + 1]));
      if (dMin > bestScore) { bestScore = dMin; best = p; }
    }
  }
  return best;
}

export function formatArea(m2: number, units: 'metric' | 'us'): { primary: string; secondary: string } {
  const ha = m2 / 10000;
  if (units === 'us') {
    const acres = m2 / 4046.8564224;
    return {
      primary: `${acres >= 100 ? acres.toFixed(1) : acres.toFixed(2)} acres`,
      secondary: `${ha.toFixed(2)} ha · ${Math.round(m2).toLocaleString('en-US')} m²`,
    };
  }
  return {
    primary: `${ha >= 100 ? ha.toFixed(1) : ha.toFixed(2)} ha`,
    secondary: `${Math.round(m2).toLocaleString('en-US')} m² · ${(m2 / 4046.8564224).toFixed(2)} acres`,
  };
}
