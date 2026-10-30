/**
 * Farm-specific SoilGrids sampling (Phase 2).
 *
 * Phase 1 exposed 14 regional SoilGrids aggregates. This module samples the
 * national grid persisted by scripts/acquire-phase2-soil-grid.py (same ISRIC
 * SoilGrids 2.0 WCS pipeline, 0.01-degree requested grid resampled by WCS
 * from the 250 m source models; 0-30 cm depth-weighted) for a farm point or
 * polygon, so two farms in the same region no longer share one average.
 * SoilGrids Q0.05-Q0.95 uncertainty widths are stored on a coarser 0.02°
 * grid (they are spatially smooth) to fit Cloudflare Free size limits.
 * Farm silt is derived as the texture residual (100 - sand - clay) so
 * texture always closes; the independent SoilGrids silt mean remains in
 * the Phase 1 regional estimate.
 *
 * Honesty rules (unchanged from Phase 1):
 * - Every value is a MODELED prediction (`kind: 'modeled-estimate'`), never
 *   a laboratory measurement.
 * - DEPTH DISCIPLINE: headline estimates are 0-30 cm depth-weighted means.
 *   The SoilGrids Q0.05/Q0.95 uncertainty layers describe 5-15 cm ONLY.
 *   Returned `uncertainty` intervals are the 0-30 cm estimate +/- half the
 *   5-15 cm width — an approximation across depths, labelled as such in
 *   `uncertaintyInfo`, never calibrated field-level confidence.
 * - Available water capacity is derived ONLY through the validated
 *   Saxton–Rawls pedotransfer in lib/soil-fertility.ts. Its range is a
 *   sensitivity span over those approximated intervals, not confidence.
 * - Polygons aggregate every intersecting grid cell weighted by true
 *   spherical overlap area (partial boundary cells count partially, cell
 *   area is latitude-dependent), with explicit missing-data coverage —
 *   never just the nearest pixel, never silently full coverage.
 * - The Khorezm laboratory validation discrepancy is preserved verbatim
 *   (KHOREZM_LAB_VALIDATION); no bias correction is applied.
 * - Callers fall back to the Phase 1 regional estimate when the grid has no
 *   valid cell (outside coverage, nodata, water/desert mask gaps).
 */
import gridJson from './data-intelligence/soil-grid.json' with { type: 'json' };
import { estimateWaterRetention } from './soil-fertility.ts';

type Layer = { dataB64: string; scale: number; offset: number; unit: string };
type GridSection = {
  cellDeg: number; width: number; height: number; landCells: number;
  landBitmapB64: string; layers: Record<string, Layer>;
};
type GridDoc = GridSection & {
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  noData: number; retrievedAt: string; widthGrid: GridSection;
};

const grid = gridJson as unknown as GridDoc;
const { minLon, maxLat } = grid.bbox;

function decodeB64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Lazily decoded quantized layer grid (means or uncertainty widths). */
class DecodedGrid {
  readonly cellDeg: number;
  private readonly width: number;
  private readonly height: number;
  private readonly section: GridSection;
  private landIndex: Int32Array | null = null;
  private layerData: Record<string, Uint8Array> | null = null;

  constructor(section: GridSection) {
    this.section = section;
    this.cellDeg = section.cellDeg;
    this.width = section.width;
    this.height = section.height;
  }

  ensureDecoded(): void {
    if (this.landIndex && this.layerData) return;
    const bits = decodeB64(this.section.landBitmapB64);
    this.landIndex = new Int32Array(this.width * this.height).fill(-1);
    let next = 0;
    for (let cell = 0; cell < this.width * this.height; cell++) {
      const byte = bits[cell >> 3] ?? 0;
      if (byte & (1 << (7 - (cell & 7)))) this.landIndex[cell] = next++;
    }
    this.layerData = {};
    for (const [name, layer] of Object.entries(this.section.layers)) this.layerData[name] = decodeB64(layer.dataB64);
  }

  /** Decoded value at (row, col); null for nodata / off-land / outside. */
  value(layerName: string, row: number, col: number): number | null {
    this.ensureDecoded();
    if (row < 0 || col < 0 || row >= this.height || col >= this.width) return null;
    const idx = this.landIndex![row * this.width + col];
    if (idx < 0) return null;
    const raw = this.layerData![layerName][idx];
    if (raw === grid.noData) return null;
    const layer = this.section.layers[layerName];
    return raw * layer.scale + layer.offset;
  }

  /** Fractional grid-centre coordinates for a lon/lat. */
  coords(latitude: number, longitude: number): { fx: number; fy: number } {
    return { fx: (longitude - minLon) / this.cellDeg - 0.5, fy: (maxLat - latitude) / this.cellDeg - 0.5 };
  }

  centre(row: number, col: number): { latitude: number; longitude: number } {
    return { latitude: maxLat - (row + 0.5) * this.cellDeg, longitude: minLon + (col + 0.5) * this.cellDeg };
  }

  /** Row/col bounds covering a lon/lat bbox, clamped to the grid. */
  bounds(minLat: number, maxLatIn: number, minLonIn: number, maxLonIn: number): { rowMin: number; rowMax: number; colMin: number; colMax: number } {
    return {
      colMin: Math.max(0, Math.floor((minLonIn - minLon) / this.cellDeg)),
      colMax: Math.min(this.width - 1, Math.ceil((maxLonIn - minLon) / this.cellDeg)),
      rowMin: Math.max(0, Math.floor((maxLat - maxLatIn) / this.cellDeg)),
      rowMax: Math.min(this.height - 1, Math.ceil((maxLat - minLat) / this.cellDeg)),
    };
  }

  /** Bilinear sample; falls back to the nearest valid cell centre. */
  bilinear(layerName: string, latitude: number, longitude: number): number | null {
    const { fx, fy } = this.coords(latitude, longitude);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    let sum = 0, wsum = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const v = this.value(layerName, y0 + dy, x0 + dx);
      if (v === null) continue;
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
      sum += v * w; wsum += w;
    }
    if (wsum === 0) return this.value(layerName, Math.round(fy), Math.round(fx));
    return sum / wsum;
  }
}

const meanGrid = new DecodedGrid(grid);
const widthGrid = new DecodedGrid(grid.widthGrid);

/** Prepare immutable dataset buffers once during Worker startup, not a farm request. */
export function initializeSoilGrid(): void {
  meanGrid.ensureDecoded();
  widthGrid.ensureDecoded();
}

export type SoilPropertyEstimate = {
  sandPct: number; clayPct: number; siltPct: number | null;
  organicCarbonGPerKg: number | null; ph: number | null;
  /**
   * Approximated intervals (see `uncertaintyInfo`): the 0–30 cm estimate
   * plus/minus half the 5–15 cm SoilGrids Q0.05–Q0.95 width. Field names are
   * kept for backward compatibility; they are NOT calibrated field-level
   * confidence intervals and must not be presented as such.
   */
  uncertainty: {
    sandPct: [number, number] | null; clayPct: [number, number] | null;
    organicCarbonGPerKg: [number, number] | null; ph: [number, number] | null;
  };
  /** Provenance of the uncertainty numbers above — read before quoting them. */
  uncertaintyInfo: {
    kind: 'soilgrids-model-uncertainty-not-field-confidence';
    /** Depth the SoilGrids Q0.05/Q0.95 layers actually describe. */
    uncertaintyDepthCm: '5-15';
    /** Depth the headline soil estimates describe. */
    estimateDepthCm: '0-30';
    depthMismatch: true;
    intervalConstruction: 'estimate (0-30 cm) +/- half the 5-15 cm Q0.05-Q0.95 width; an approximation across depths, not a calibrated interval for the 0-30 cm estimate';
    calibrated: false;
    fieldLevelConfidence: false;
    note: 'SoilGrids model uncertainty at 5-15 cm, reused approximately for the 0-30 cm estimate. It is not a laboratory error bar and not a calibrated field-level confidence interval; Khorezm lab validation found regional biases larger than these widths for some properties (see validationContext).';
  };
  availableWater: {
    fieldCapacity: number; wiltingPoint: number; totalAvailableMmPerM: number;
    /** Sensitivity range: Saxton–Rawls re-evaluated at texture interval corners. */
    totalAvailableRangeMmPerM: [number, number] | null;
    /** What the range above is — and is not. Null when no range was computed. */
    totalAvailableRangeKind: 'sensitivity-to-approximate-texture-intervals-not-confidence' | null;
    method: string;
  } | null;
};

function interval(mean: number | null, widthValue: number | null, lo: number, hi: number): [number, number] | null {
  if (mean === null || widthValue === null) return null;
  return [Math.max(lo, mean - widthValue / 2), Math.min(hi, mean + widthValue / 2)];
}

function retention(sand: number, clay: number, socGPerKg: number | null): SoilPropertyEstimate['availableWater'] {
  if (socGPerKg === null) return null;
  try {
    // SOC g/kg -> organic matter % (Van Bemmelen 1.724 on carbon %), as Phase 1.
    const omPct = Math.min(10, (socGPerKg / 10) * 1.724);
    const est = estimateWaterRetention({ sandPct: sand, clayPct: clay, organicMatterPct: omPct });
    return {
      fieldCapacity: est.fieldCapacity, wiltingPoint: est.wiltingPoint,
      totalAvailableMmPerM: est.totalAvailableMmPerM, totalAvailableRangeMmPerM: null,
      totalAvailableRangeKind: null,
      method: est.method,
    };
  } catch { return null; }
}

function retentionWithRange(
  sand: number, clay: number, soc: number | null,
  sandIv: [number, number] | null, clayIv: [number, number] | null,
): SoilPropertyEstimate['availableWater'] {
  const base = retention(sand, clay, soc);
  if (!base || !sandIv || !clayIv || soc === null) return base;
  const omPct = Math.min(10, (soc / 10) * 1.724);
  const taws: number[] = [];
  for (const s of sandIv) for (const c of clayIv) {
    if (s + c > 100) continue;
    try { taws.push(estimateWaterRetention({ sandPct: s, clayPct: c, organicMatterPct: omPct }).totalAvailableMmPerM); } catch { /* skip invalid corner */ }
  }
  if (taws.length) {
    base.totalAvailableRangeMmPerM = [Math.min(...taws), Math.max(...taws)];
    base.totalAvailableRangeKind = 'sensitivity-to-approximate-texture-intervals-not-confidence';
  }
  return base;
}

function assemble(
  sand: number | null, clay: number | null, soc: number | null, ph: number | null,
  sandW: number | null, clayW: number | null, socW: number | null, phW: number | null,
): SoilPropertyEstimate | null {
  if (sand === null || clay === null) return null;
  const sandIv = interval(sand, sandW, 0, 100);
  const clayIv = interval(clay, clayW, 0, 100);
  return {
    sandPct: sand, clayPct: clay,
    // Derived residual so texture closes to 100% (see module header).
    siltPct: Math.max(0, Math.min(100, 100 - sand - clay)),
    organicCarbonGPerKg: soc, ph,
    uncertainty: {
      sandPct: sandIv, clayPct: clayIv,
      organicCarbonGPerKg: interval(soc, socW, 0, Number.POSITIVE_INFINITY),
      ph: interval(ph, phW, 0, 14),
    },
    uncertaintyInfo: {
      kind: 'soilgrids-model-uncertainty-not-field-confidence',
      uncertaintyDepthCm: '5-15',
      estimateDepthCm: '0-30',
      depthMismatch: true,
      intervalConstruction: 'estimate (0-30 cm) +/- half the 5-15 cm Q0.05-Q0.95 width; an approximation across depths, not a calibrated interval for the 0-30 cm estimate',
      calibrated: false,
      fieldLevelConfidence: false,
      note: 'SoilGrids model uncertainty at 5-15 cm, reused approximately for the 0-30 cm estimate. It is not a laboratory error bar and not a calibrated field-level confidence interval; Khorezm lab validation found regional biases larger than these widths for some properties (see validationContext).',
    },
    availableWater: retentionWithRange(sand, clay, soc, sandIv, clayIv),
  };
}

const MEAN = { sand: 'sandPct', clay: 'clayPct', soc: 'socGPerKg', ph: 'ph' } as const;
const WIDTH = { sand: 'sandWidthPct', clay: 'clayWidthPct', soc: 'socWidthGPerKg', ph: 'phWidth' } as const;

export type SoilGridPointResult = SoilPropertyEstimate & {
  basis: 'soilgrids-grid-point';
  cell: { row: number; col: number; centreLatitude: number; centreLongitude: number };
  gridCellDeg: number; sourceRetrievedAt: string;
};

/** Location-specific modelled soil for one farm point; null when uncovered. */
export function sampleSoilAtPoint(latitude: number, longitude: number): SoilGridPointResult | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (longitude < grid.bbox.minLon || longitude > grid.bbox.maxLon || latitude < grid.bbox.minLat || latitude > grid.bbox.maxLat) return null;
  const est = assemble(
    meanGrid.bilinear(MEAN.sand, latitude, longitude), meanGrid.bilinear(MEAN.clay, latitude, longitude),
    meanGrid.bilinear(MEAN.soc, latitude, longitude), meanGrid.bilinear(MEAN.ph, latitude, longitude),
    widthGrid.bilinear(WIDTH.sand, latitude, longitude), widthGrid.bilinear(WIDTH.clay, latitude, longitude),
    widthGrid.bilinear(WIDTH.soc, latitude, longitude), widthGrid.bilinear(WIDTH.ph, latitude, longitude),
  );
  if (!est) return null;
  const { fx, fy } = meanGrid.coords(latitude, longitude);
  const col = Math.round(fx), row = Math.round(fy);
  const centre = meanGrid.centre(row, col);
  return {
    ...est, basis: 'soilgrids-grid-point', gridCellDeg: meanGrid.cellDeg, sourceRetrievedAt: grid.retrievedAt,
    cell: { row, col, centreLatitude: centre.latitude, centreLongitude: centre.longitude },
  };
}

type LonLat = [number, number];
function pointInRing(lon: number, lat: number, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Approximate geodesic polygon area (km2), spherical shoelace. */
export function polygonAreaKm2(ring: LonLat[]): number {
  const R = 6371.0088;
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lonI, latI] = ring[i]; const [lonJ, latJ] = ring[j];
    sum += (lonI - lonJ) * (Math.PI / 180) * (2 + Math.sin(latJ * Math.PI / 180) + Math.sin(latI * Math.PI / 180));
  }
  return Math.abs((sum * R * R) / 2);
}

export type CellStat = { mean: number; min: number; max: number; std: number; p10: number; p90: number };

/**
 * Intersection-area-weighted cell statistics. Each cell contributes in
 * proportion to the spherical area where it actually overlaps the farm
 * polygon, so partial boundary cells count partially — never as whole
 * cells and never dropped merely for straddling the boundary.
 */
function weightedCellStat(entries: { v: number; w: number }[]): CellStat | null {
  const valid = entries.filter((e) => e.w > 0);
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => a.v - b.v);
  const wsum = sorted.reduce((a, e) => a + e.w, 0);
  const mean = sorted.reduce((a, e) => a + e.v * e.w, 0) / wsum;
  const variance = sorted.reduce((a, e) => a + e.w * (e.v - mean) ** 2, 0) / wsum;
  const quantile = (p: number) => {
    let acc = 0;
    for (const e of sorted) { acc += e.w; if (acc >= p * wsum) return e.v; }
    return sorted[sorted.length - 1].v;
  };
  return {
    mean, min: sorted[0].v, max: sorted[sorted.length - 1].v,
    std: Math.sqrt(variance), p10: quantile(0.1), p90: quantile(0.9),
  };
}

const EARTH_RADIUS_KM = 6371.0088;

/** Exact spherical area (km2) of a lon/lat rectangle. */
export function sphericalRectAreaKm2(lonMin: number, lonMax: number, latMin: number, latMax: number): number {
  const dLon = (lonMax - lonMin) * Math.PI / 180;
  return EARTH_RADIUS_KM * EARTH_RADIUS_KM * dLon
    * (Math.sin(latMax * Math.PI / 180) - Math.sin(latMin * Math.PI / 180));
}

/** Spherical area (km2) of one grid cell at a latitude (cells shrink poleward). */
export function gridCellAreaKm2(centreLatitude: number, cellDeg: number = meanGrid.cellDeg): number {
  return sphericalRectAreaKm2(0, cellDeg, centreLatitude - cellDeg / 2, centreLatitude + cellDeg / 2);
}

type CellIntersection = {
  row: number; col: number;
  centreLatitude: number; centreLongitude: number;
  /** Fraction of the cell's spherical area inside the polygon, in (0, 1]. */
  fraction: number;
  /** Spherical overlap area (km2): fraction x the cell's true spherical area. */
  areaKm2: number;
};

/** Does segment a-b enter rectangle [x0,x1]x[y0,y1]? (Slab clip test.) */
function segmentEntersRect(a: LonLat, b: LonLat, x0: number, y0: number, x1: number, y1: number): boolean {
  let tMin = 0, tMax = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]] as const) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) tMin = Math.max(tMin, t); else tMax = Math.min(tMax, t);
    if (tMin > tMax) return false;
  }
  return true;
}

/**
 * Every cell of `g` intersecting `ring`, with spherical overlap areas.
 * Fully-inside cells take fraction 1 (no ring edge crosses them and all
 * corners are inside). Boundary/irregular cells are integrated on an
 * 8x8 sub-cell lattice of spherical sub-rectangles, which handles
 * concave and small polygons without assuming the cell centre is inside.
 * Sub-cell integration error is bounded by the sub-cell size (~125 m at
 * 0.01°); fractions are therefore estimates of overlap, not cadastral area.
 */
function intersectingCells(g: DecodedGrid, ring: LonLat[]): CellIntersection[] {
  const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
  const b = g.bounds(Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons));
  const candidateCount = (b.rowMax - b.rowMin + 1) * (b.colMax - b.colMin + 1);
  const sub = candidateCount > 20000 ? 4 : 8; // bound work on very large polygons
  const out: CellIntersection[] = [];
  const edges: [LonLat, LonLat][] = ring.map((p, i) => [p, ring[(i + 1) % ring.length]]);
  for (let row = b.rowMin; row <= b.rowMax; row++) {
    for (let col = b.colMin; col <= b.colMax; col++) {
      const centre = g.centre(row, col);
      const lon0 = centre.longitude - g.cellDeg / 2, lon1 = centre.longitude + g.cellDeg / 2;
      const lat0 = centre.latitude - g.cellDeg / 2, lat1 = centre.latitude + g.cellDeg / 2;
      const corners: LonLat[] = [[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1]];
      const cornersIn = corners.map(([x, y]) => pointInRing(x, y, ring));
      const vertexInside = ring.some(([x, y]) => x >= lon0 && x <= lon1 && y >= lat0 && y <= lat1);
      const edgeCrosses = edges.some(([a, bb]) => segmentEntersRect(a, bb, lon0, lat0, lon1, lat1));
      const cellArea = sphericalRectAreaKm2(lon0, lon1, lat0, lat1);
      if (cornersIn.every(Boolean) && !edgeCrosses) {
        out.push({ row, col, centreLatitude: centre.latitude, centreLongitude: centre.longitude, fraction: 1, areaKm2: cellArea });
        continue;
      }
      if (!cornersIn.some(Boolean) && !vertexInside && !edgeCrosses) continue;
      let insideArea = 0;
      const dLon = (lon1 - lon0) / sub, dLat = (lat1 - lat0) / sub;
      for (let sy = 0; sy < sub; sy++) {
        for (let sx = 0; sx < sub; sx++) {
          const cx = lon0 + (sx + 0.5) * dLon, cy = lat0 + (sy + 0.5) * dLat;
          if (pointInRing(cx, cy, ring)) insideArea += sphericalRectAreaKm2(cx - dLon / 2, cx + dLon / 2, cy - dLat / 2, cy + dLat / 2);
        }
      }
      if (insideArea > 0) {
        out.push({
          row, col, centreLatitude: centre.latitude, centreLongitude: centre.longitude,
          fraction: Math.min(1, insideArea / cellArea), areaKm2: insideArea,
        });
      }
    }
  }
  return out;
}

/** Area-weighted (shoelace) polygon centroid; vertex mean if degenerate. */
export function polygonCentroid(ring: LonLat[]): { latitude: number; longitude: number } {
  let cross = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j]; const [x1, y1] = ring[i];
    const f = x0 * y1 - x1 * y0;
    cross += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(cross) < 1e-12) {
    return { latitude: ring.reduce((a, p) => a + p[1], 0) / ring.length, longitude: ring.reduce((a, p) => a + p[0], 0) / ring.length };
  }
  return { longitude: cx / (3 * cross), latitude: cy / (3 * cross) };
}

export type SoilGridPolygonResult = SoilPropertyEstimate & {
  basis: 'soilgrids-grid-polygon';
  gridCellDeg: number; sourceRetrievedAt: string;
  sample: {
    /** Legacy name: count of VALID cells intersecting the polygon (partial cells included). */
    cells: number;
    polygonAreaKm2: number;
    /** Spherical area (km2) where valid grid data overlaps the polygon. */
    sampledAreaKm2: number;
    /**
     * Missing-data coverage: sampledAreaKm2 / polygonAreaKm2, in [0, 1].
     * Below 1 means part of the farm overlaps SoilGrids nodata / off-land
     * cells; that part contributed NOTHING to the estimate. Never exceeds 1:
     * overlap areas are true spherical intersections, not cell counts.
     */
    coverageRatio: number;
    /** All cells intersecting the polygon, valid or not. */
    intersectingCells: number;
    /** Intersecting cells with no valid sand/clay (SoilGrids nodata or off-land). */
    nodataCells: number;
    /** Intersecting valid cells only partly inside the polygon (fraction < 1). */
    partialCells: number;
    /** Spherical area (km2) of all intersections, valid + nodata. */
    intersectedAreaKm2: number;
    /** Spherical area (km2) overlapping nodata/off-land cells: intersected - sampled. */
    nodataAreaKm2: number;
    /** True when no intersecting cell had valid data and a centroid point sample was used. */
    subCellPolygon: boolean;
    /** How every weight and coverage figure above was computed. */
    areaMethod: 'spherical-cell-intersection (8x8 sub-cell integration for boundary cells)';
    variation: { sandPct: CellStat | null; clayPct: CellStat | null; organicCarbonGPerKg: CellStat | null; ph: CellStat | null; totalAvailableMmPerM: CellStat | null };
  };
};

/**
 * Location-specific modelled soil for a farm polygon ([lon, lat] ring).
 * Aggregates every grid cell that intersects the polygon, weighted by the
 * cell's true spherical overlap area (partial boundary cells count
 * partially; cell area is latitude-dependent). Reports within-farm
 * variation and explicit missing-data coverage. Only when NO intersecting
 * cell has valid data does it fall back to a bilinear point sample at the
 * polygon's area centroid, flagged `subCellPolygon`.
 */
export function sampleSoilForPolygon(ring: LonLat[]): SoilGridPolygonResult | null {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  for (const p of ring) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[1]) > 90 || Math.abs(p[0]) > 180) return null;
  }
  const areaKm2 = polygonAreaKm2(ring);
  const centroid = polygonCentroid(ring);

  const intersections = intersectingCells(meanGrid, ring);
  const intersectedAreaKm2 = intersections.reduce((a, c) => a + c.areaKm2, 0);
  const cells: { sand: number; clay: number; soc: number | null; ph: number | null; w: number; taw: number | null }[] = [];
  let nodataCells = 0;
  let partialCells = 0;
  for (const cell of intersections) {
    const sand = meanGrid.value(MEAN.sand, cell.row, cell.col);
    const clay = meanGrid.value(MEAN.clay, cell.row, cell.col);
    if (sand === null || clay === null) { nodataCells++; continue; }
    if (cell.fraction < 0.999) partialCells++;
    const soc = meanGrid.value(MEAN.soc, cell.row, cell.col);
    const ret = retention(sand, clay, soc);
    cells.push({
      sand, clay, soc, ph: meanGrid.value(MEAN.ph, cell.row, cell.col),
      w: cell.areaKm2, taw: ret?.totalAvailableMmPerM ?? null,
    });
  }
  // Uncertainty widths: same spherical intersection weighting on the
  // coarser width grid. Still 5-15 cm model uncertainty (see
  // uncertaintyInfo) — the weighting changes, the depth basis does not.
  const widthIntersections = intersectingCells(widthGrid, ring);
  const widthAcc: Record<'sand' | 'clay' | 'soc' | 'ph', { s: number; w: number }> = {
    sand: { s: 0, w: 0 }, clay: { s: 0, w: 0 }, soc: { s: 0, w: 0 }, ph: { s: 0, w: 0 },
  };
  for (const cell of widthIntersections) {
    const add = (key: 'sand' | 'clay' | 'soc' | 'ph', layer: string) => {
      const v = widthGrid.value(layer, cell.row, cell.col);
      if (v !== null) { widthAcc[key].s += v * cell.areaKm2; widthAcc[key].w += cell.areaKm2; }
    };
    add('sand', WIDTH.sand); add('clay', WIDTH.clay); add('soc', WIDTH.soc); add('ph', WIDTH.ph);
  }
  const widthMean = (key: 'sand' | 'clay' | 'soc' | 'ph') => (widthAcc[key].w > 0 ? widthAcc[key].s / widthAcc[key].w : null);

  const sampledAreaKm2 = cells.reduce((a, c) => a + c.w, 0);
  const emptySample = {
    cells: 0, polygonAreaKm2: areaKm2, sampledAreaKm2: 0, coverageRatio: 0,
    intersectingCells: intersections.length, nodataCells, partialCells: 0,
    intersectedAreaKm2, nodataAreaKm2: intersectedAreaKm2, subCellPolygon: true,
    areaMethod: 'spherical-cell-intersection (8x8 sub-cell integration for boundary cells)' as const,
    variation: { sandPct: null, clayPct: null, organicCarbonGPerKg: null, ph: null, totalAvailableMmPerM: null },
  };
  if (!cells.length) {
    const point = sampleSoilAtPoint(centroid.latitude, centroid.longitude);
    if (!point) return null;
    return { ...point, basis: 'soilgrids-grid-polygon', gridCellDeg: meanGrid.cellDeg, sourceRetrievedAt: grid.retrievedAt, sample: emptySample };
  }

  const wmean = (pick: (c: typeof cells[number]) => number | null): number | null => {
    let s = 0, w = 0;
    for (const c of cells) { const v = pick(c); if (v !== null) { s += v * c.w; w += c.w; } }
    return w ? s / w : null;
  };
  const est = assemble(
    wmean((c) => c.sand), wmean((c) => c.clay), wmean((c) => c.soc), wmean((c) => c.ph),
    widthMean('sand'), widthMean('clay'), widthMean('soc'), widthMean('ph'),
  );
  if (!est) return null;
  const entries = (pick: (c: typeof cells[number]) => number | null) =>
    cells.map((c) => ({ v: pick(c), w: c.w })).filter((e): e is { v: number; w: number } => e.v !== null);
  return {
    ...est, basis: 'soilgrids-grid-polygon', gridCellDeg: meanGrid.cellDeg, sourceRetrievedAt: grid.retrievedAt,
    sample: {
      cells: cells.length, polygonAreaKm2: areaKm2, sampledAreaKm2,
      coverageRatio: areaKm2 > 0 ? Math.min(1, sampledAreaKm2 / areaKm2) : 0,
      intersectingCells: intersections.length, nodataCells, partialCells,
      intersectedAreaKm2, nodataAreaKm2: Math.max(0, intersectedAreaKm2 - sampledAreaKm2),
      subCellPolygon: false,
      areaMethod: 'spherical-cell-intersection (8x8 sub-cell integration for boundary cells)',
      variation: {
        sandPct: weightedCellStat(entries((c) => c.sand)), clayPct: weightedCellStat(entries((c) => c.clay)),
        organicCarbonGPerKg: weightedCellStat(entries((c) => c.soc)),
        ph: weightedCellStat(entries((c) => c.ph)),
        totalAvailableMmPerM: weightedCellStat(entries((c) => c.taw)),
      },
    },
  };
}

/** Grid provenance for API/docs consumers. */
export function soilGridProvenance(): { source: string; retrievedAt: string; gridCellDeg: number; landCells: number } {
  return {
    source: 'ISRIC SoilGrids 2.0 via WCS 1.0 (maps.isric.org), CC BY 4.0',
    retrievedAt: grid.retrievedAt, gridCellDeg: meanGrid.cellDeg, landCells: grid.landCells,
  };
}

/**
 * Independent laboratory validation — PRESERVED DISCREPANCY, NO CORRECTION.
 *
 * The only openly obtainable Uzbekistan lab soil dataset with texture/SOC/pH
 * is regional (Khorezm): Int. J. Environ. Res. Public Health 2022, 19, 8794,
 * Table 1 (Khiva/Kushkupir/Shavat districts; Research Institute of Soil
 * Science and Agrochemistry; samples from 20 points x 5 depths, published
 * layer means depth-weighted to 0-30 cm here; published fractions sum to
 * ~105% as printed). Compared against this grid's mean over the Khorezm
 * ADM1 polygon (scripts/validate-phase2-soil.py), SoilGrids is materially
 * biased in this irrigated arid region — notably clay and SOC high.
 *
 * NO bias correction has been applied: one regional dataset is not a
 * calibration, and inventing one would fabricate precision. Farm-level
 * empirical accuracy therefore CANNOT be verified; these farm values are
 * modelled priors, and a lab test is the only field truth. Any consumer
 * quoting farm soil values should surface this context.
 */
export const KHOREZM_LAB_VALIDATION = {
  kind: 'independent-laboratory-validation' as const,
  region: 'Khorezm (Xorazm) Region',
  measuredSource: 'Int. J. Environ. Res. Public Health 2022, 19, 8794, Table 1 (Research Institute of Soil Science and Agrochemistry laboratory analyses)',
  measuredBasis: 'District sample mean (Khiva/Kushkupir/Shavat, 20 points x 5 depths), published layer means depth-weighted to 0-30 cm; fractions sum to ~105% as printed',
  modelledBasis: 'Phase 2 SoilGrids grid mean over the Khorezm ADM1 polygon (6,708 valid cells; 6,791 for SOC)',
  depthCm: '0-30',
  properties: {
    sandPct: { measured: 28.33, modelled: 18.91, modelledMinusMeasured: -9.42, unit: '%' },
    siltPct: { measured: 58.33, modelled: 47.77, modelledMinusMeasured: -10.56, unit: '%' },
    clayPct: { measured: 18.0, modelled: 33.32, modelledMinusMeasured: 15.32, unit: '%' },
    organicCarbonGPerKg: { measured: 3.67, modelled: 9.73, modelledMinusMeasured: 6.07, unit: 'g/kg' },
    ph: { measured: 6.19, modelled: 7.59, modelledMinusMeasured: 1.4, unit: 'pH' },
  },
  biasCorrectionApplied: false as const,
  farmLevelAccuracyVerified: false as const,
  interpretation: 'Regional plausibility/bias check only — the measured mean is a district-sample mean, not a whole-region or farm population. The discrepancy is preserved and reported; it is not corrected, because one regional dataset cannot calibrate farm predictions. Treat farm values as modelled priors with wide, uncalibrated uncertainty; use a laboratory soil test for field decisions.',
};
