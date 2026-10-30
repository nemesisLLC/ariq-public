/**
 * Groundwater intelligence (scenario-grade, evidence-typed).
 *
 * Scientific basis:
 * - FAO-56 (Allen et al. 1998) root-zone balance (Eq. 85) includes a
 *   capillary-rise term CR from a shallow water table; FAO-56 notes CR
 *   depends on soil texture, water-table depth and rooting depth, and is
 *   often small when the water table is more than ~1 m below the roots.
 * - FAO Irrigation and Drainage Paper 48 / Ayers & Westcot (FAO-29) for
 *   irrigation-water salinity (ECw) hazard classes.
 * - Regional context only: FAO AQUASTAT Uzbekistan country profile and
 *   IGRAC Global Groundwater Information System describe national
 *   groundwater resources; neither provides farm-level current depth.
 *
 * Hard rules:
 * - A depth value is ALWAYS one of: observed (a dated measurement the
 *   caller supplies), historical/reported (dated publication values the
 *   caller supplies), or a user scenario assumption. This module never
 *   manufactures a "current depth beneath your farm".
 * - Capillary rise here is a transparent scenario model with published
 *   texture parameter RANGES, returned as low/mid/high — not a measurement
 *   and not a calibrated local prediction.
 */
import { InputError } from './irrigation/core.ts';

export type GroundwaterDataKind = 'observed' | 'historical' | 'reported' | 'user-supplied-scenario' | 'modeled-estimate';
export type SoilTextureClass = 'sand' | 'sandy-loam' | 'loam' | 'clay-loam' | 'clay';

export type GroundwaterObservation = {
  depthToWaterM: number;
  observedAt: string; // ISO date
  kind: Exclude<GroundwaterDataKind, 'user-supplied-scenario' | 'modeled-estimate'>;
  source: string;
};

/**
 * Scenario parameters for capillary rise by texture (compiled ranges in the
 * FAO/USDA literature tradition: coarse soils have a shallow capillary
 * fringe but can transmit quickly near the table; clays lift higher but
 * slowly). maxRateMmDay applies at the fringe; extinctionGapM is the
 * water-table distance below the root-zone bottom beyond which rise is
 * negligible. These are scenario parameters, not site measurements.
 */
export const CAPILLARY_PARAMETERS: Record<SoilTextureClass, { fringeM: [number, number]; maxRateMmDay: [number, number]; extinctionGapM: number; note: string }> = {
  sand: { fringeM: [0.2, 0.5], maxRateMmDay: [1.0, 3.0], extinctionGapM: 0.6, note: 'Coarse pores: short fringe, fast but short-lived rise.' },
  'sandy-loam': { fringeM: [0.4, 0.8], maxRateMmDay: [0.8, 2.5], extinctionGapM: 1.0, note: 'Moderate fringe and transmission.' },
  loam: { fringeM: [0.7, 1.2], maxRateMmDay: [0.5, 2.0], extinctionGapM: 1.4, note: 'Balanced fringe height and rate.' },
  'clay-loam': { fringeM: [1.0, 1.8], maxRateMmDay: [0.3, 1.2], extinctionGapM: 1.8, note: 'Higher fringe, slower transmission.' },
  clay: { fringeM: [1.2, 2.5], maxRateMmDay: [0.1, 0.8], extinctionGapM: 2.2, note: 'Tallest fringe, slowest rate; structure/macropores dominate in practice.' },
};

function fail(m: string): never { throw new InputError(m); }
function num(v: unknown, lo: number, hi: number, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) fail(`${label} must be a finite number in [${lo}, ${hi}]`);
  return v;
}

export type CapillaryRiseEstimate = {
  kind: 'modeled-estimate';
  rateMmDay: { low: number; mid: number; high: number };
  gapBelowRootsM: number;
  texture: SoilTextureClass;
  method: string;
  note: string;
};

/**
 * Scenario capillary rise into the root zone.
 * gap = depthToWater - rootDepth (distance from water table to root bottom).
 * Inside the fringe, rise is at the texture max rate; beyond it, rise decays
 * exponentially to the extinction gap. Returns low/mid/high from the
 * published parameter ranges.
 */
export function capillaryRise(input: { depthToWaterM: number; rootDepthM: number; texture: SoilTextureClass }): CapillaryRiseEstimate {
  const depth = num(input.depthToWaterM, 0, 300, 'depthToWaterM');
  const root = num(input.rootDepthM, 0.05, 3, 'rootDepthM');
  const p = CAPILLARY_PARAMETERS[input.texture];
  if (!p) fail(`unknown soil texture ${input.texture}`);
  const gap = Math.max(0, depth - root);
  const rateAt = (fringe: number, maxRate: number): number => {
    if (gap <= fringe) return maxRate;
    if (gap >= fringe + p.extinctionGapM) return 0;
    return maxRate * Math.exp(-2.2 * ((gap - fringe) / p.extinctionGapM));
  };
  const low = rateAt(p.fringeM[0], p.maxRateMmDay[0]);
  const high = rateAt(p.fringeM[1], p.maxRateMmDay[1]);
  const mid = rateAt((p.fringeM[0] + p.fringeM[1]) / 2, (p.maxRateMmDay[0] + p.maxRateMmDay[1]) / 2);
  return {
    kind: 'modeled-estimate', rateMmDay: { low, mid, high }, gapBelowRootsM: gap, texture: input.texture,
    method: 'Scenario exponential-decay capillary model over published texture fringe/rate ranges (FAO-56 Ch. 7 groundwater contribution framing).',
    note: `${p.note} Scenario estimate only; not a measured flux. Validate with observation wells and soil data before operational use.`,
  };
}

export type GroundwaterRisk = {
  waterlogging: { level: 'none' | 'low' | 'moderate' | 'high'; reason: string };
  salinity: { level: 'unknown' | 'none' | 'slight-moderate' | 'severe'; reason: string };
  kind: 'modeled-estimate';
};

/** Waterlogging and salinity hazard screening from a scenario water table. */
export function groundwaterRisks(input: { depthToWaterM: number; rootDepthM: number; groundwaterEcDsM?: number }): GroundwaterRisk {
  const depth = num(input.depthToWaterM, 0, 300, 'depthToWaterM');
  const root = num(input.rootDepthM, 0.05, 3, 'rootDepthM');
  const clearance = depth - root;
  const waterlogging: GroundwaterRisk['waterlogging'] =
    depth <= root ? { level: 'high', reason: 'Water table is inside the root zone; roots are likely saturated (anaerobic stress risk).' }
    : clearance <= 0.3 ? { level: 'moderate', reason: 'Water table is within 0.3 m below the roots; saturation can reach the root zone after irrigation or rain.' }
    : clearance <= 0.8 ? { level: 'low', reason: 'Water table is 0.3-0.8 m below the roots; episodic waterlogging is possible in fine textures.' }
    : { level: 'none', reason: 'Water table is more than 0.8 m below the roots; waterlogging from groundwater is unlikely.' };
  let salinity: GroundwaterRisk['salinity'];
  if (input.groundwaterEcDsM === undefined) {
    salinity = { level: 'unknown', reason: 'No groundwater EC supplied; salinity hazard cannot be assessed. Shallow saline water tables are a known Aral Sea basin risk — measure EC before judging.' };
  } else {
    const ec = num(input.groundwaterEcDsM, 0, 40, 'groundwaterEcDsM');
    // FAO-29 (Ayers & Westcot) irrigation-water salinity hazard: <0.7 none, 0.7-3 slight-moderate, >3 severe (for surface irrigation).
    const base = ec < 0.7 ? 'none' as const : ec <= 3 ? 'slight-moderate' as const : 'severe' as const;
    salinity = { level: base, reason: `Groundwater EC ${ec} dS/m (FAO-29 hazard class: ${base}). ${depth <= root + 1 ? 'The shallow table can move salts into the root zone by capillary rise; leaching and drainage control matter.' : 'The table is deep enough that direct salt rise is limited.'}` };
  }
  return { waterlogging, salinity, kind: 'modeled-estimate' };
}

export type DailyGroundwaterBalance = {
  date: string; startDepletionMm: number; etAdjMm: number; capillaryRiseMm: number; drainageMm: number; endDepletionMm: number;
};

/**
 * FAO-56 Eq. 85 daily root-zone balance WITH the capillary-rise term:
 * Dr,i = Dr,i-1 - Pi - IRi - CRi + ETa,i + DPi, with ETa bounded by
 * available water and CR bounded by both the scenario rate and the
 * depletion it can replenish. Mass conserves exactly by construction.
 */
export function simulateGroundwaterBalance(input: {
  days: { date: string; etAdjMm: number; effectiveRainMm: number; irrigationNetMm: number }[];
  totalAvailableMm: number; initialDepletionMm: number;
  capillaryRateMmDay: number;
}): DailyGroundwaterBalance[] {
  const taw = num(input.totalAvailableMm, 0.01, 5000, 'totalAvailableMm');
  let dr = num(input.initialDepletionMm, 0, taw, 'initialDepletionMm');
  const rate = num(input.capillaryRateMmDay, 0, 20, 'capillaryRateMmDay');
  return input.days.map((d) => {
    const start = dr;
    const inputs = d.effectiveRainMm + d.irrigationNetMm;
    const et = Math.min(d.etAdjMm, Math.max(0, taw - start + inputs));
    const cr = Math.min(rate, Math.max(0, start + et - inputs)); // cannot push depletion below zero beyond today's balance
    const rawEnd = start + et - inputs - cr;
    const drainage = Math.max(0, -rawEnd);
    const end = Math.min(taw, Math.max(0, rawEnd));
    dr = end;
    return { date: d.date, startDepletionMm: start, etAdjMm: et, capillaryRiseMm: cr, drainageMm: drainage, endDepletionMm: end };
  });
}

/** Least-squares depth trend from dated observations. Describes the supplied record only; never extrapolates to "current" depth. */
export function groundwaterTrend(observations: GroundwaterObservation[]): {
  count: number; trendMPerYear: number | null; latest: GroundwaterObservation | null; earliest: GroundwaterObservation | null;
  spanYears: number; note: string;
} {
  if (!Array.isArray(observations)) fail('observations must be an array');
  const obs = [...observations].map((o) => {
    num(o.depthToWaterM, 0, 1000, 'depthToWaterM');
    const t = Date.parse(`${o.observedAt}T00:00:00.000Z`);
    if (!Number.isFinite(t)) fail(`invalid observedAt ${o.observedAt}`);
    return { o, t };
  }).sort((a, b) => a.t - b.t);
  if (obs.length === 0) return { count: 0, trendMPerYear: null, latest: null, earliest: null, spanYears: 0, note: 'No observations supplied.' };
  const first = obs[0], last = obs[obs.length - 1];
  const spanYears = (last.t - first.t) / (365.25 * 86400000);
  let trend: number | null = null;
  if (obs.length >= 3 && spanYears > 0) {
    const xs = obs.map((x) => (x.t - first.t) / (365.25 * 86400000));
    const ys = obs.map((x) => x.o.depthToWaterM);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const denom = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    trend = denom > 0 ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / denom : null;
  }
  return {
    count: obs.length, trendMPerYear: trend, latest: last.o, earliest: first.o, spanYears,
    note: trend === null
      ? 'Fewer than three dated observations (or zero time span): no trend is calculated.'
      : `Least-squares trend over the supplied ${obs.length} observations (${spanYears.toFixed(1)} years). Positive means a deepening water table in the supplied record. This describes those observations only; it is not a current farm measurement.`,
  };
}

/** One-call scenario assessment for the API/frontend. */
export function assessGroundwaterScenario(input: {
  depthToWaterM: number; depthKind: GroundwaterDataKind; rootDepthM: number; texture: SoilTextureClass; groundwaterEcDsM?: number;
}): { depth: { valueM: number; kind: GroundwaterDataKind }; capillaryRise: CapillaryRiseEstimate; risks: GroundwaterRisk; warnings: string[] } {
  num(input.depthToWaterM, 0, 300, 'depthToWaterM');
  return {
    depth: { valueM: input.depthToWaterM, kind: input.depthKind },
    capillaryRise: capillaryRise(input),
    risks: groundwaterRisks(input),
    warnings: [
      'warning.groundwater-scenario-not-measurement',
      ...(input.depthKind === 'historical' || input.depthKind === 'reported' ? ['warning.groundwater-dated-source-not-current'] : []),
    ],
  };
}
