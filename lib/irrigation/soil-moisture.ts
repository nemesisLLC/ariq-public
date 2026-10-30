/**
 * Modelled soil-moisture scenario for initial root-zone depletion (Phase 3).
 *
 * QUESTION THIS MODULE ANSWERS: can satellite/reanalysis soil moisture
 * defensibly estimate a farm's INITIAL root-zone depletion (Dr) so farmers
 * need not guess their current soil moisture?
 *
 * PRODUCT INVESTIGATION (2026-10; see docs/FEATURE_CATALOG.md 13f):
 * - ERA5-Land (ECMWF): volumetric water content at 0-7, 7-28, 28-100 cm,
 *   0.1° (~9 km) hourly, from 1950. KEY LIMIT: the HTESSEL land model has
 *   NO irrigation scheme, so over irrigated land its soil moisture is
 *   driven by modelled precipitation only and can run dry-biased during
 *   the irrigation season. Literature validation vs in-situ networks
 *   shows useful correlation but material bias (ubRMSE of order
 *   0.04-0.06 m3/m3 in favourable networks, worse where uncalibrated).
 *   Available key-free via Open-Meteo with a few days' lag.
 * - SMAP L4 (NASA): true surface + root-zone (0-100 cm) soil moisture at
 *   9 km from L-band assimilation; the most accurate of the three
 *   (ubRMSE ~0.05 vs core validation sites) and its assimilation does
 *   sense irrigation wetting at the surface. NOT integrated: requires
 *   NASA Earthdata credentials, EASE-Grid processing and carries up to
 *   ~7-day product latency — revisit if a credentialed pipeline is set up.
 * - Copernicus CGLS Soil Water Index (ASCAT): daily, ~0.1° global (1 km
 *   mainly Europe). SWI is a saturation INDEX (0-100%) from an
 *   exponential filter, not volumetric water content; converting it to
 *   depletion needs porosity/field-capacity assumptions per pixel that
 *   would stack assumptions on assumptions. NOT integrated.
 *
 * DECISION: ERA5-Land via Open-Meteo (the provider ARIQ already uses for
 * ERA5 season analogs; deterministic, mockable, no credentials) is used
 * ONLY as a clearly labelled SCENARIO for initial depletion:
 *   depletion fraction f = (FC - theta_rootzone) / (FC - WP), clamped,
 *   Dr = f * TAW, with theta uncertainty +/-0.05 m3/m3 propagated into a
 *   Dr range. It never overrides a farmer-supplied or measured depletion,
 *   never claims to be a field measurement, and the farm profile runs the
 *   EXISTING FAO-56 engine at the low/central/high depletion values so
 *   users see how the uncertainty moves stress timing.
 * FC/WP come from the farm's soil estimate (Saxton–Rawls on SoilGrids
 * texture) while theta comes from ERA5-Land: that cross-model pairing is
 * an assumption and is stated wherever the number is shown.
 */
import { InputError } from './core.ts';

export const THETA_UNCERTAINTY_M3M3 = 0.05;

function fail(m: string): never { throw new InputError(m); }
const DAY_MS = 86400000;
const fmt = (epoch: number) => new Date(epoch).toISOString().slice(0, 10);

export type Era5LandSoilMoisture = {
  kind: 'modeled-reanalysis';
  provider: 'Open-Meteo Historical Weather API';
  model: 'ERA5-Land (ECMWF)';
  gridResolution: '0.1° (~9 km)';
  grid: { latitude: number; longitude: number };
  dataDate: string;
  lagDays: number;
  /** Daily-mean volumetric water content (m3/m3) by layer for dataDate. */
  layers: { depthCm: string; thetaM3M3: number }[];
  sourceUrl: string;
  retrievedAt: string;
};

const LAYER_VARS = [
  { var: 'soil_moisture_0_to_7cm', depthCm: '0-7', topCm: 0, bottomCm: 7 },
  { var: 'soil_moisture_7_to_28cm', depthCm: '7-28', topCm: 7, bottomCm: 28 },
  { var: 'soil_moisture_28_to_100cm', depthCm: '28-100', topCm: 28, bottomCm: 100 },
] as const;

/**
 * Fetch the latest complete day of ERA5-Land soil moisture in a 7-day
 * window ending at `nowMs`. Hourly values are daily-averaged; a day only
 * counts when every layer has >= 20 finite hourly values. Any provider
 * failure or gap throws — callers must degrade honestly, never invent.
 */
export async function fetchEra5LandSoilMoisture(
  latitude: number, longitude: number,
  options: { fetcher?: typeof fetch; nowMs?: number } = {},
): Promise<Era5LandSoilMoisture> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) fail('Invalid location for soil-moisture lookup.');
  const fetcher = options.fetcher ?? fetch;
  const now = options.nowMs ?? Date.now();
  const endEpoch = Math.floor(now / DAY_MS) * DAY_MS;
  const startEpoch = endEpoch - 6 * DAY_MS;
  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.search = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude),
    start_date: fmt(startEpoch), end_date: fmt(endEpoch),
    hourly: LAYER_VARS.map((l) => l.var).join(','),
    models: 'era5_land', timezone: 'Asia/Samarkand',
  }).toString();
  const response = await fetcher(url, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.ok) throw new Error('ERA5-Land soil-moisture source unavailable.');
  const data = await response.json();
  const hourly = data?.hourly;
  if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) throw new Error('ERA5-Land soil-moisture response was empty.');
  const units = data.hourly_units ?? {};
  for (const l of LAYER_VARS) {
    if (units[l.var] !== undefined && units[l.var] !== 'm³/m³' && units[l.var] !== 'm3/m3') {
      throw new Error(`Unexpected ERA5-Land soil-moisture unit for ${l.var}: ${units[l.var]}`);
    }
    if (!Array.isArray(hourly[l.var]) || hourly[l.var].length !== hourly.time.length) throw new Error(`ERA5-Land layer ${l.var} missing or incomplete.`);
  }
  // Daily means per layer; pick the LATEST complete day in the window.
  const byDay = new Map<string, { sums: number[]; counts: number[] }>();
  hourly.time.forEach((t: string, i: number) => {
    const day = String(t).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { sums: [0, 0, 0], counts: [0, 0, 0] });
    const rec = byDay.get(day)!;
    LAYER_VARS.forEach((l, li) => {
      const v = hourly[l.var][i];
      if (typeof v === 'number' && Number.isFinite(v)) { rec.sums[li] += v; rec.counts[li]++; }
    });
  });
  const completeDays = [...byDay.entries()]
    .filter(([, r]) => r.counts.every((c) => c >= 20))
    .map(([day, r]) => ({ day, thetas: r.sums.map((s, i) => s / r.counts[i]) }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
  if (!completeDays.length) throw new Error('No complete ERA5-Land soil-moisture day in the last 7 days.');
  const latest = completeDays[0];
  const lagDays = Math.max(0, Math.round((endEpoch - Date.parse(`${latest.day}T00:00:00.000Z`)) / DAY_MS));
  return {
    kind: 'modeled-reanalysis',
    provider: 'Open-Meteo Historical Weather API',
    model: 'ERA5-Land (ECMWF)',
    gridResolution: '0.1° (~9 km)',
    grid: { latitude: data.latitude, longitude: data.longitude },
    dataDate: latest.day, lagDays,
    layers: LAYER_VARS.map((l, i) => ({ depthCm: l.depthCm, thetaM3M3: latest.thetas[i] })),
    sourceUrl: url.href,
    retrievedAt: new Date(now).toISOString(),
  };
}

export type InitialDepletionEstimate = {
  kind: 'modeled-scenario-not-measurement';
  rootZoneThetaM3M3: number;
  /** Depth actually observed by ERA5-Land, capped at 1 m. */
  observedDepthM: number;
  cropRootDepthM: number;
  thetaUncertaintyM3M3: number;
  totalAvailableMm: number;
  depletionFraction: { central: number; low: number; high: number };
  depletionMm: { central: number; low: number; high: number };
  method: string;
};

/**
 * Root-zone depletion scenario from ERA5-Land layer thetas and the farm's
 * FC/WP. Layers are depth-weighted over min(rootDepth, 1 m); the resulting
 * moisture FRACTION of TAW is applied to the full root zone. Low/high use
 * theta -/+ the uncertainty (wetter theta = lower depletion). Pure and
 * deterministic; throws on physically impossible soil inputs.
 */
export function estimateInitialDepletion(input: {
  layers: { topCm: number; bottomCm: number; thetaM3M3: number }[];
  fieldCapacity: number; wiltingPoint: number; rootDepthM: number;
  thetaUncertaintyM3M3?: number;
}): InitialDepletionEstimate {
  const { fieldCapacity: fc, wiltingPoint: wp, rootDepthM } = input;
  if (!(fc > wp) || fc > 1 || wp < 0) fail('fieldCapacity must exceed wiltingPoint within [0, 1] for a depletion estimate.');
  if (!(rootDepthM > 0) || rootDepthM > 3) fail('rootDepthM must be in (0, 3] for a depletion estimate.');
  const uncertainty = input.thetaUncertaintyM3M3 ?? THETA_UNCERTAINTY_M3M3;
  const observedDepthCm = Math.min(rootDepthM * 100, 100);
  let weighted = 0, covered = 0;
  for (const layer of input.layers) {
    const overlap = Math.max(0, Math.min(layer.bottomCm, observedDepthCm) - layer.topCm);
    if (overlap > 0) { weighted += layer.thetaM3M3 * overlap; covered += overlap; }
  }
  if (covered <= 0) fail('No ERA5-Land layer overlaps the crop root zone.');
  const thetaRz = weighted / covered;
  const taw = (fc - wp) * rootDepthM * 1000;
  const fraction = (theta: number) => Math.min(1, Math.max(0, (fc - theta) / (fc - wp)));
  const fCentral = fraction(thetaRz), fLow = fraction(thetaRz + uncertainty), fHigh = fraction(thetaRz - uncertainty);
  return {
    kind: 'modeled-scenario-not-measurement',
    rootZoneThetaM3M3: thetaRz,
    observedDepthM: observedDepthCm / 100,
    cropRootDepthM: rootDepthM,
    thetaUncertaintyM3M3: uncertainty,
    totalAvailableMm: taw,
    depletionFraction: { central: fCentral, low: fLow, high: fHigh },
    depletionMm: { central: fCentral * taw, low: fLow * taw, high: fHigh * taw },
    method: 'Depletion fraction (FC - theta)/(FC - WP) from ERA5-Land depth-weighted root-zone theta (observed to at most 1 m, fraction applied to the full crop root zone), times TAW. Theta uncertainty +/-0.05 m3/m3 (order of published ERA5-Land ubRMSE) gives the low/high depletion range. Cross-model assumption: FC/WP from the farm soil estimate, theta from ERA5-Land.',
  };
}

/** Convenience adapter from a fetch result to estimator layer inputs. */
export function era5LayersForEstimate(sm: Era5LandSoilMoisture): { topCm: number; bottomCm: number; thetaM3M3: number }[] {
  return LAYER_VARS.map((l, i) => ({ topCm: l.topCm, bottomCm: l.bottomCm, thetaM3M3: sm.layers[i].thetaM3M3 }));
}
