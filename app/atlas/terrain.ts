import {
  UZ_BBOX, lonLatToWorld, elevationToWorld, scanlineMask, simplifyRing, fillInteriorHoles, SKIRT_DEPTH,
  type LonLat,
} from './geo';

export type WaterFeature = {
  type: 'Feature';
  geometry: { type: string; coordinates: any };
  properties: { id?: string; kind?: string; name?: string; sourceDataset?: string; designTotalMillionM3?: number | null };
};

export type ReliefData = {
  artifactBoundary?: Uint32Array;
  gridW: number; gridH: number;
  elevations: Float32Array; // metres, per grid vertex (row 0 = north)
  mask: Uint8Array;
  positions: Float32Array; colors: Float32Array; indices: Uint32Array;
  rivers: WaterFeature[]; canalsMajor: WaterFeature[]; canalsMinor: WaterFeature[];
  reservoirs: WaterFeature[]; dams: WaterFeature[];
  cities: { name: string; lon: number; lat: number }[];
  elevMin: number; elevMax: number; demSource: string; demTiles: number;
};

const GRID_W = 300;
const GRID_H = 204;
const TILE_Z = 7;

function mercatorY(lat: number, n: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
}

/** Load AWS/Mapzen terrarium tiles (z7) and decode elevation into a Float32Array over the tile canvas. */
async function loadDem(onProgress: (label: string) => void): Promise<{ elev: Float32Array; w: number; h: number; originPx: number; originPy: number; tiles: number }> {
  const n = 2 ** TILE_Z * 256;
  const x0 = Math.floor(((UZ_BBOX.minLon + 180) / 360) * 2 ** TILE_Z);
  const x1 = Math.floor(((UZ_BBOX.maxLon + 180) / 360) * 2 ** TILE_Z);
  const y0 = Math.floor(mercatorY(UZ_BBOX.maxLat, 2 ** TILE_Z));
  const y1 = Math.floor(mercatorY(UZ_BBOX.minLat, 2 ** TILE_Z));
  const cols = x1 - x0 + 1;
  const rows = y1 - y0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = cols * 256;
  canvas.height = rows * 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let done = 0;
  const jobs: Promise<void>[] = [];
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      jobs.push(new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256); done++; onProgress(`Raising the land · ${done}/${cols * rows} elevation tiles`); resolve(); };
        img.onerror = () => reject(new Error(`Elevation tile ${TILE_Z}/${tx}/${ty} failed to load`));
        img.src = `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${TILE_Z}/${tx}/${ty}.png`;
      }));
    }
  }
  await Promise.all(jobs);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const elev = new Float32Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < elev.length; i++, p += 4) {
    elev[i] = data[p] * 256 + data[p + 1] + data[p + 2] / 256 - 32768;
  }
  return { elev, w: canvas.width, h: canvas.height, originPx: x0 * 256, originPy: y0 * 256, tiles: cols * rows };
}

function makeDemSampler(dem: Awaited<ReturnType<typeof loadDem>>) {
  const n = 2 ** TILE_Z * 256;
  return (lon: number, lat: number): number => {
    const px = ((lon + 180) / 360) * n - dem.originPx;
    const py = mercatorY(lat, 2 ** TILE_Z) * 256 - dem.originPy;
    const x = Math.min(dem.w - 2, Math.max(0, px));
    const y = Math.min(dem.h - 2, Math.max(0, py));
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const i = yi * dem.w + xi;
    const a = dem.elev[i], b = dem.elev[i + 1], c = dem.elev[i + dem.w], d = dem.elev[i + dem.w + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

export function gridSampler(elevations: Float32Array, gridW: number, gridH: number) {
  return (lon: number, lat: number): number => {
    const fx = ((lon - UZ_BBOX.minLon) / (UZ_BBOX.maxLon - UZ_BBOX.minLon)) * (gridW - 1);
    const fy = ((UZ_BBOX.maxLat - lat) / (UZ_BBOX.maxLat - UZ_BBOX.minLat)) * (gridH - 1);
    const x = Math.min(gridW - 2, Math.max(0, fx));
    const y = Math.min(gridH - 2, Math.max(0, fy));
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = x - xi, ty = y - yi;
    const i = yi * gridW + xi;
    const a = elevations[i], b = elevations[i + 1], c = elevations[i + gridW], d = elevations[i + gridW + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

type RGB = [number, number, number];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mix(a: RGB, b: RGB, t: number): RGB { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

/** Natural museum-model palette by elevation. Deterministic grain, no invented data. */
function terrainColor(elev: number, lon: number, lat: number): RGB {
  const DESERT: RGB = [0.82, 0.71, 0.53];
  const STEPPE: RGB = [0.67, 0.66, 0.48];
  const VALLEY: RGB = [0.42, 0.58, 0.40];
  const ROCK: RGB = [0.52, 0.50, 0.48];
  const SNOW: RGB = [0.96, 0.97, 0.97];
  let c: RGB;
  if (elev < 350) c = mix(DESERT, STEPPE, elev / 350);
  else if (elev < 900) c = mix(STEPPE, VALLEY, (elev - 350) / 550);
  else if (elev < 1800) c = mix(VALLEY, ROCK, (elev - 900) / 900);
  else if (elev < 3400) c = mix(ROCK, [0.72, 0.70, 0.68], (elev - 1800) / 1600);
  else c = mix([0.72, 0.70, 0.68], SNOW, Math.min(1, (elev - 3400) / 700));
  // The Kyzylkum interior reads sandy even where slightly elevated.
  if (lon > 60 && lon < 67.5 && lat > 40.2 && lat < 44.6 && elev < 700) c = mix(c, DESERT, 0.45);
  const grain = 0.97 + 0.05 * Math.abs(Math.sin(lon * 127.1 + lat * 311.7));
  return [c[0] * grain, c[1] * grain, c[2] * grain];
}

/** Fetch ALL pages of a GeoJSON query (audit G01: pages of 1000, explicit nextOffset). */
async function fetchAllGeoJson(params: string, bbox: string): Promise<{ features: WaterFeature[] }> {
  const features: WaterFeature[] = [];
  let offset = 0;
  for (let page = 0; page < 6; page++) {
    const res = await fetch(`/api/water-data?format=geojson&bbox=${bbox}&${params}&limit=1000&offset=${offset}`).then((r) => r.json()).catch(() => null);
    if (!res) break;
    features.push(...(res.features ?? []));
    if (res.nextOffset === null || res.nextOffset === undefined) break;
    offset = res.nextOffset;
  }
  return { features };
}

type ReliefAsset = { gridW: number; gridH: number; elevations: Float32Array; mask: Uint8Array; elevMin: number; elevMax: number };
/**
 * Precomputed relief asset (public/data/uzbekistan-relief-v1.json, generated
 * from the same terrarium pipeline below): one 245 KB static file instead of
 * 40 elevation-tile requests. Falls back to live tiles when unavailable.
 */
async function loadReliefAsset(): Promise<ReliefAsset | null> {
  try {
    const res = await fetch('/data/uzbekistan-relief-v1.json');
    if (!res.ok) return null;
    const a = await res.json();
    if (a.gridW !== GRID_W || a.gridH !== GRID_H || typeof a.elevationsB64 !== 'string' || typeof a.maskB64 !== 'string') return null;
    const elevBytes = Uint8Array.from(atob(a.elevationsB64), (c) => c.charCodeAt(0));
    const elev16 = new Int16Array(elevBytes.buffer, 0, GRID_W * GRID_H);
    const elevations = new Float32Array(GRID_W * GRID_H);
    for (let i = 0; i < elevations.length; i++) elevations[i] = elev16[i];
    const mask = Uint8Array.from(atob(a.maskB64), (c) => c.charCodeAt(0));
    if (mask.length !== GRID_W * GRID_H) return null;
    return { gridW: GRID_W, gridH: GRID_H, elevations, mask, elevMin: a.elevMin, elevMax: a.elevMax };
  } catch { return null; }
}

let reliefPromise: Promise<ReliefData> | null = null;
const progressListeners = new Set<(label: string) => void>();
let progressLabel = 'Reading Uzbekistan’s boundaries…';
/** Share background preparation with the atlas; failures remain retryable. */
export function loadReliefData(onProgress: (label: string) => void): Promise<ReliefData> {
  progressListeners.add(onProgress); onProgress(progressLabel);
  if (!reliefPromise) {
    reliefPromise = buildReliefData(label => {progressLabel = label;progressListeners.forEach(listener => listener(label));})
      .catch(error => {reliefPromise = null;throw error;});
  }
  return reliefPromise.finally(() => {progressListeners.delete(onProgress);});
}
async function buildReliefData(onProgress: (label: string) => void): Promise<ReliefData> {
  onProgress('Reading Uzbekistan’s boundaries…');
  const bbox = `${UZ_BBOX.minLon},${UZ_BBOX.minLat},${UZ_BBOX.maxLon},${UZ_BBOX.maxLat}`;
  const assetPromise = loadReliefAsset();
  const artifactPromise = loadArtifactAsset();
  const [regionsRes, rivers, canals, waterBodies, infra, asset] = await Promise.all([
    fetch('/api/water-data/regions').then((r) => r.json()),
    fetchAllGeoJson('kind=river', bbox),
    fetchAllGeoJson('kind=canal', bbox),
    fetchAllGeoJson('category=water-body', bbox),
    fetchAllGeoJson('category=infrastructure', bbox),
    assetPromise,
  ]);
  const dem = asset ? null : await loadDem(onProgress);
  onProgress('Sculpting the relief…');
  // region.polygon is a GeoJSON Polygon coordinate set; extra rings are exclaves.
  // scanlineMask fills each ring independently and ORs them (see geo.ts).
  const polygons: LonLat[][] = (regionsRes.regions ?? [])
    .flatMap((r: any) => (Array.isArray(r.region?.polygon) ? r.region.polygon : []))
    .filter((ring: LonLat[]) => Array.isArray(ring) && ring.length > 10)
    .map((ring: LonLat[]) => simplifyRing(ring, 0.04));
  const dx = (UZ_BBOX.maxLon - UZ_BBOX.minLon) / (GRID_W - 1);
  const dy = (UZ_BBOX.maxLat - UZ_BBOX.minLat) / (GRID_H - 1);
  let mask: Uint8Array;
  let elevations: Float32Array;
  let elevMin = Infinity, elevMax = -Infinity;
  if (asset) {
    // Precomputed asset already carries the closed mask and smoothed elevations.
    mask = asset.mask;
    elevations = asset.elevations;
    elevMin = asset.elevMin; elevMax = asset.elevMax;
  } else {
    const rawMask = scanlineMask(polygons, GRID_W, GRID_H);
    // Majority closing: regional rings simplified independently leave 1-cell cracks
    // along shared borders; fill a cell when most of its neighbourhood is inside.
    const closedMask = new Uint8Array(rawMask);
    for (let r = 1; r < GRID_H - 1; r++) {
      for (let c = 1; c < GRID_W - 1; c++) {
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) n += rawMask[(r + dr) * GRID_W + c + dc];
        if (n >= 5) closedMask[r * GRID_W + c] = 1;
      }
    }
    mask = fillInteriorHoles(closedMask, GRID_W, GRID_H);
    const sample = makeDemSampler(dem!);
    const rawElev = new Float32Array(GRID_W * GRID_H);
    for (let row = 0; row < GRID_H; row++) {
      for (let col = 0; col < GRID_W; col++) {
        const i = row * GRID_W + col;
        rawElev[i] = mask[i] ? Math.max(0, sample(UZ_BBOX.minLon + col * dx, UZ_BBOX.maxLat - row * dy)) : 0;
      }
    }
    // One light 3x3 smoothing pass: removes single-cell DEM needles, keeps real ridges.
    elevations = new Float32Array(GRID_W * GRID_H);
    for (let r = 0; r < GRID_H; r++) {
      for (let c = 0; c < GRID_W; c++) {
        const i = r * GRID_W + c;
        if (!mask[i]) continue;
        let sum = 0, n = 0;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= GRID_H || cc >= GRID_W) continue;
          const j = rr * GRID_W + cc;
          if (mask[j]) { sum += rawElev[j]; n++; }
        }
        elevations[i] = n ? sum / n : rawElev[i];
        if (elevations[i] < elevMin) elevMin = elevations[i];
        if (elevations[i] > elevMax) elevMax = elevations[i];
      }
    }
  }
  // Vertices for ALL grid points (outside ones are only used by the skirt base ring where needed).
  const positions = new Float32Array(GRID_W * GRID_H * 3);
  const colors = new Float32Array(GRID_W * GRID_H * 3);
  for (let row = 0; row < GRID_H; row++) {
    for (let col = 0; col < GRID_W; col++) {
      const i = row * GRID_W + col;
      const lon = UZ_BBOX.minLon + col * dx;
      const lat = UZ_BBOX.maxLat - row * dy;
      const [x, z] = lonLatToWorld(lon, lat);
      positions[i * 3] = x;
      positions[i * 3 + 1] = mask[i] ? elevationToWorld(elevations[i]) : -0.02;
      positions[i * 3 + 2] = z;
      const c = terrainColor(elevations[i], lon, lat);
      colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
    }
  }
  const indices: number[] = [];
  const idx = (r: number, c: number) => r * GRID_W + c;
  for (let r = 0; r < GRID_H - 1; r++) {
    for (let c = 0; c < GRID_W - 1; c++) {
      const a = idx(r, c), b = idx(r, c + 1), d = idx(r + 1, c), e = idx(r + 1, c + 1);
      // Triangle kept when its centroid cell is inside the country mask.
      if (mask[a] && mask[b] && mask[d]) indices.push(a, d, b);
      if (mask[b] && mask[d] && mask[e]) indices.push(b, d, e);
    }
  }
  // Skirt: boundary edges (used once) extruded down to a base, darker cut-edge colour.
  const edgeCount = new Map<string, { a: number; b: number; n: number }>();
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const e = edgeCount.get(key(a, b));
      if (e) e.n++;
      else edgeCount.set(key(a, b), { a, b, n: 1 });
    }
  }
  const posArr = Array.from(positions);
  const colArr = Array.from(colors);
  const EDGE: RGB = [0.62, 0.55, 0.44];
  edgeCount.forEach(({ a, b, n }) => {
    if (n !== 1) return;
    const base = posArr.length / 3;
    for (const v of [a, b]) {
      posArr.push(posArr[v * 3], -SKIRT_DEPTH, posArr[v * 3 + 2]);
      colArr.push(EDGE[0], EDGE[1], EDGE[2]);
    }
    indices.push(a, base + 1, base, a, b, base + 1);
  });
  // Water feature curation: long mapped ways read as the national system; short ways are local LOD.
  const lineLen = (f: WaterFeature) => (f.geometry?.coordinates?.length ?? 0);
  const riversOut = (rivers.features ?? []).filter((f: WaterFeature) => f.geometry?.type === 'LineString' && lineLen(f) >= 6);
  const canalsAll = (canals.features ?? []).filter((f: WaterFeature) => f.geometry?.type === 'LineString');
  const canalsMajor = canalsAll.filter((f: WaterFeature) => lineLen(f) >= 14);
  const canalsMinor = canalsAll.filter((f: WaterFeature) => lineLen(f) >= 6 && lineLen(f) < 14);
  const seen = new Set<string>();
  const reservoirsOut = (waterBodies.features ?? [])
    .filter((f: WaterFeature) => f.geometry?.type === 'Point' && (f.properties.kind === 'reservoir' || f.properties.kind === 'lake'))
    .sort((a: WaterFeature, b: WaterFeature) => (a.properties.sourceDataset?.startsWith('cawater') ? 0 : 1) - (b.properties.sourceDataset?.startsWith('cawater') ? 0 : 1))
    .filter((f: WaterFeature) => {
      const [lon, lat] = f.geometry.coordinates as number[];
      const k = `${lon.toFixed(3)},${lat.toFixed(3)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const damsOut = (infra.features ?? []).filter((f: WaterFeature) => f.geometry?.type === 'Point' && f.properties.kind === 'dam' && f.properties.name);
  // Major cities at real populated-place locations (Open-Meteo Geocoding /
  // GeoNames, verified 2026-10-26). Regional administrative centroids are NOT
  // used: e.g. Samarqand Region's centroid sits ~65 km from Samarkand city.
  const cities = [
    { name: 'Tashkent', lon: 69.21627, lat: 41.26465 },
    { name: 'Samarkand', lon: 66.96445, lat: 39.65456 },
    { name: 'Bukhara', lon: 64.43069, lat: 39.77026 },
    { name: 'Fergana', lon: 71.78432, lat: 40.38421 },
    { name: 'Andijan', lon: 72.35067, lat: 40.78338 },
    { name: 'Namangan', lon: 71.67257, lat: 40.9983 },
    { name: 'Nukus', lon: 59.60576, lat: 42.45861 },
    { name: 'Qarshi', lon: 65.78905, lat: 38.86056 },
    { name: 'Termez', lon: 67.27833, lat: 37.22417 },
    { name: 'Jizzakh', lon: 67.82956, lat: 40.13351 },
    { name: 'Guliston', lon: 68.77542, lat: 40.49536 },
    { name: 'Navoiy', lon: 65.37917, lat: 40.08444 },
    { name: 'Urgench', lon: 60.63143, lat: 41.55177 },
    { name: 'Nurafshon', lon: 69.36253, lat: 41.0321 },
  ];
  const artifact=await artifactPromise;
  return {
    gridW: GRID_W, gridH: GRID_H, elevations, mask,
    positions: new Float32Array(posArr), colors: new Float32Array(colArr), indices: new Uint32Array(indices),
    rivers: riversOut, canalsMajor, canalsMinor, reservoirs: reservoirsOut, dams: damsOut, cities,
    elevMin, elevMax, demSource: asset ? 'Precomputed relief v1 from Mapzen / AWS Terrain Tiles (terrarium, zoom 7)' : 'Mapzen / AWS Terrain Tiles (terrarium, zoom 7)', demTiles: asset ? 0 : dem!.tiles,
    ...(artifact??{}),
  };
}

/** Source-boundary-clipped display mesh, built offline. No server or browser geography synthesis. */
async function loadArtifactAsset():Promise<Partial<ReliefData>|null> {
  try{
    const response=await fetch('/data/uzbekistan-artifact-v2.json');if(!response.ok)return null;
    const a=await response.json();if(a.version!==2||a.gridW!==840||a.gridH!==568)return null;
    const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)).buffer;
    const positions=new Float32Array(bytes(a.positionsB64)),indices=new Uint32Array(bytes(a.indicesB64)),boundary=new Uint32Array(bytes(a.boundaryB64));
    const elev16=new Int16Array(bytes(a.elevationsB64)),mask=new Uint8Array(bytes(a.maskB64));
    if(elev16.length!==a.gridW*a.gridH||mask.length!==elev16.length||positions.length%3||indices.length%3||boundary.length%2)return null;
    return {gridW:a.gridW,gridH:a.gridH,positions,indices,artifactBoundary:boundary,elevations:Float32Array.from(elev16),mask,demSource:'Mapzen / AWS Terrarium zoom 7; OSM national boundary 196240',demTiles:0,elevMin:elev16.reduce((v:number,h:number,i:number)=>mask[i]?Math.min(v,h):v,Infinity),elevMax:elev16.reduce((v:number,h:number,i:number)=>mask[i]?Math.max(v,h):v,-Infinity)};
  }catch{return null;}
}

/** Build a flat ribbon strip for a set of polylines, draped over the relief grid. */
export function buildRibbon(features: WaterFeature[], widthWorld: number, color: RGB, sampleElev: (lon: number, lat: number) => number, lift = 0.045): { positions: Float32Array; colors: Float32Array; indices: Uint32Array } {
  const pos: number[] = [];
  const col: number[] = [];
  const idxArr: number[] = [];
  for (const f of features) {
    const coords = (f.geometry.coordinates as number[][]).filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (coords.length < 2) continue;
    const base = pos.length / 3;
    const pts = coords.map(([lon, lat]) => {
      const [x, z] = lonLatToWorld(lon, lat);
      return { x, z, y: elevationToWorld(sampleElev(lon, lat)) + lift };
    });
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const pn = pts[Math.min(pts.length - 1, i + 1)];
      const pp = pts[Math.max(0, i - 1)];
      let vx = pn.x - pp.x;
      let vz = pn.z - pp.z;
      const len = Math.hypot(vx, vz) || 1;
      vx /= len; vz /= len;
      const px = -vz * widthWorld / 2;
      const pz = vx * widthWorld / 2;
      pos.push(p.x + px, p.y, p.z + pz, p.x - px, p.y, p.z - pz);
      col.push(...color, ...color);
      if (i > 0) {
        const a = base + (i - 1) * 2;
        idxArr.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col), indices: new Uint32Array(idxArr) };
}
