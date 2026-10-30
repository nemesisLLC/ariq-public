/**
 * Soil fertility and fertilizer science (scenario accounting, not prescription).
 *
 * Methods:
 * - Saxton & Rawls (2006, Soil Sci. Soc. Am. J. 70:1569-1578) pedotransfer
 *   functions estimating volumetric water content at -33 kPa (field
 *   capacity proxy) and -1500 kPa (wilting point) from sand, clay and
 *   organic matter. Coarse MODELLED estimates — not lab measurements and
 *   not the paused SoilGrids REST API.
 * - Nutrient accounting: inputs (fertilizer products by declared nutrient
 *   fractions, irrigation-water nitrogen from nitrate concentration,
 *   manure by declared fractions) minus crop nutrient REMOVAL (harvested
 *   product coefficients). A balance is bookkeeping, not a fertilizer
 *   prescription: exact field rates require soil-test calibration.
 * - Salinity classes from FAO-29 (Ayers & Westcot) ECe ranges; pH classes
 *   are standard agronomic bands.
 * - Leaching-risk screening combines simulated drainage (from the season
 *   engine) with texture: nitrate moves with drainage water, fastest in
 *   coarse soils. Qualitative screening only.
 *
 * Soil-test inputs (lab results supplied by the user) are typed separately
 * from modelled texture estimates so the two are never confused.
 */
import { InputError } from './irrigation/core.ts';

function fail(m: string): never { throw new InputError(m); }
function num(v: unknown, lo: number, hi: number, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) fail(`${label} must be a finite number in [${lo}, ${hi}]`);
  return v;
}

export type TextureEstimate = {
  kind: 'modeled-estimate';
  fieldCapacity: number; wiltingPoint: number; // volumetric m3/m3
  totalAvailableMmPerM: number; // (FC-WP)*1000 per metre of root zone
  method: string; note: string;
};

/** Saxton & Rawls (2006) texture pedotransfer. Inputs in percent. */
export function estimateWaterRetention(input: { sandPct: number; clayPct: number; organicMatterPct: number }): TextureEstimate {
  const sand = num(input.sandPct, 0, 100, 'sandPct') / 100;
  const clay = num(input.clayPct, 0, 100, 'clayPct') / 100;
  num(input.organicMatterPct, 0, 20, 'organicMatterPct');
  if (input.sandPct + input.clayPct > 100) fail('sandPct + clayPct must not exceed 100');
  const om = input.organicMatterPct;
  const t1500 = -0.024 * sand + 0.487 * clay + 0.006 * om + 0.005 * sand * om - 0.013 * clay * om + 0.068 * sand * clay + 0.031;
  const wp = t1500 + (0.14 * t1500 - 0.02);
  const t33 = -0.251 * sand + 0.195 * clay + 0.011 * om + 0.006 * sand * om - 0.027 * clay * om + 0.452 * sand * clay + 0.299;
  const fc = t33 + (1.283 * t33 * t33 - 0.374 * t33 - 0.015);
  const clamp = (v: number) => Math.min(0.6, Math.max(0.02, v));
  const fieldCapacity = clamp(fc), wiltingPoint = Math.min(clamp(wp), fieldCapacity - 0.01);
  return {
    kind: 'modeled-estimate', fieldCapacity, wiltingPoint,
    totalAvailableMmPerM: (fieldCapacity - wiltingPoint) * 1000,
    method: 'Saxton & Rawls (2006) pedotransfer from sand/clay/organic matter.',
    note: 'Coarse modelled estimate (typical error several volumetric percent). Use a soil lab or field measurement for operational decisions; this is not SoilGrids and not a lab result.',
  };
}

export type SoilTestInput = {
  kind: 'soil-test';
  measuredAt: string;
  labName?: string;
  textureSandPct?: number; textureClayPct?: number; organicCarbonPct?: number;
  pH?: number; ecDsM?: number; // ECe of saturation extract where available
  availableP2O5MgKg?: number; exchangeableK2OMgKg?: number; mineralNKgHa?: number;
};

export function classifySoilTest(test: SoilTestInput): {
  salinity: { level: string; note: string } | null;
  acidity: { level: string; note: string } | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  let salinity: { level: string; note: string } | null = null;
  if (test.ecDsM !== undefined) {
    const ec = num(test.ecDsM, 0, 60, 'ecDsM');
    // FAO-29 soil salinity (ECe) classes.
    const level = ec < 2 ? 'non-saline' : ec < 4 ? 'slightly saline' : ec < 8 ? 'moderately saline' : ec < 16 ? 'strongly saline' : 'very strongly saline';
    salinity = { level, note: `ECe ${ec} dS/m (FAO-29 class). Crop impact depends on crop salt tolerance and leaching fraction.` };
  } else warnings.push('warning.soil-no-ec-measurement');
  let acidity: { level: string; note: string } | null = null;
  if (test.pH !== undefined) {
    const ph = num(test.pH, 3, 11, 'pH');
    const level = ph < 5.5 ? 'acidic' : ph <= 7.3 ? 'near-neutral' : ph <= 8.5 ? 'alkaline (common in arid Uzbekistan soils)' : 'strongly alkaline / sodicity check advised';
    acidity = { level, note: `pH ${ph}. Nutrient availability (notably P and micronutrients) shifts at extremes; this is classification, not an amendment prescription.` };
  } else warnings.push('warning.soil-no-ph-measurement');
  return { salinity, acidity, warnings };
}

/**
 * Harvest nutrient removal coefficients (kg per tonne of harvested product,
 * grain/product only, residues excluded). Typical published ranges
 * (FAO/IPNI compilations); midpoint used and flagged as reference values,
 * not locally calibrated for Uzbekistan.
 */
export const NUTRIENT_REMOVAL_KG_PER_T: Record<string, { n: number; p2o5: number; k2o: number; product: string }> = {
  cotton: { n: 20, p2o5: 8, k2o: 15, product: 'seed cotton' },
  'winter-wheat': { n: 21, p2o5: 9, k2o: 6, product: 'grain (straw retained)' },
  maize: { n: 15, p2o5: 7, k2o: 5, product: 'grain (stover retained)' },
  alfalfa: { n: 28, p2o5: 7, k2o: 24, product: 'hay (whole plant removed)' },
  tomato: { n: 3, p2o5: 1, k2o: 4, product: 'fresh fruit' },
  potato: { n: 4, p2o5: 1.5, k2o: 6, product: 'tubers' },
  sunflower: { n: 18, p2o5: 8, k2o: 10, product: 'seed' },
  melon: { n: 2.5, p2o5: 1, k2o: 3.5, product: 'fresh fruit' },
};

export type FertilizerApplication = { name: string; rateKgPerHa: number; nFraction: number; p2o5Fraction: number; k2oFraction: number };
export type NutrientBalance = {
  kind: 'scenario-accounting';
  cropId: string; yieldTPerHa: number;
  inputsKgHa: { n: number; p2o5: number; k2o: number };
  removalKgHa: { n: number; p2o5: number; k2o: number };
  balanceKgHa: { n: number; p2o5: number; k2o: number };
  reading: { nutrient: 'N' | 'P2O5' | 'K2O'; balanceKgHa: number; tendency: 'large-surplus' | 'surplus' | 'near-balanced' | 'deficit' | 'large-deficit' }[];
  warnings: string[];
};

/**
 * Field nutrient bookkeeping for a caller-supplied yield scenario.
 * Irrigation-water N: kg/ha = nitrate-N (mg/L) * water applied (m3/ha) / 1000.
 * This never prescribes a fertilizer rate.
 */
export function nutrientBalance(input: {
  cropId: string; yieldTPerHa: number;
  fertilizers?: FertilizerApplication[];
  irrigationWater?: { volumeM3PerHa: number; nitrateNMgL: number };
  manure?: { rateKgPerHa: number; nFraction: number; p2o5Fraction: number; k2oFraction: number };
}): NutrientBalance {
  const coef = NUTRIENT_REMOVAL_KG_PER_T[input.cropId];
  if (!coef) fail(`No nutrient-removal reference for crop ${input.cropId}`);
  const yieldT = num(input.yieldTPerHa, 0.01, 200, 'yieldTPerHa');
  const inputs = { n: 0, p2o5: 0, k2o: 0 };
  for (const f of input.fertilizers ?? []) {
    const rate = num(f.rateKgPerHa, 0, 5000, 'fertilizer.rateKgPerHa');
    inputs.n += rate * num(f.nFraction, 0, 1, 'fertilizer.nFraction');
    inputs.p2o5 += rate * num(f.p2o5Fraction, 0, 1, 'fertilizer.p2o5Fraction');
    inputs.k2o += rate * num(f.k2oFraction, 0, 1, 'fertilizer.k2oFraction');
  }
  if (input.irrigationWater) {
    inputs.n += (num(input.irrigationWater.nitrateNMgL, 0, 200, 'irrigationWater.nitrateNMgL') * num(input.irrigationWater.volumeM3PerHa, 0, 100000, 'irrigationWater.volumeM3PerHa')) / 1000;
  }
  if (input.manure) {
    const rate = num(input.manure.rateKgPerHa, 0, 200000, 'manure.rateKgPerHa');
    inputs.n += rate * num(input.manure.nFraction, 0, 1, 'manure.nFraction');
    inputs.p2o5 += rate * num(input.manure.p2o5Fraction, 0, 1, 'manure.p2o5Fraction');
    inputs.k2o += rate * num(input.manure.k2oFraction, 0, 1, 'manure.k2oFraction');
  }
  const removal = { n: coef.n * yieldT, p2o5: coef.p2o5 * yieldT, k2o: coef.k2o * yieldT };
  const balance = { n: inputs.n - removal.n, p2o5: inputs.p2o5 - removal.p2o5, k2o: inputs.k2o - removal.k2o };
  const tendency = (b: number): NutrientBalance['reading'][number]['tendency'] => b > 50 ? 'large-surplus' : b > 15 ? 'surplus' : b >= -15 ? 'near-balanced' : b >= -50 ? 'deficit' : 'large-deficit';
  return {
    kind: 'scenario-accounting', cropId: input.cropId, yieldTPerHa: yieldT, inputsKgHa: inputs, removalKgHa: removal, balanceKgHa: balance,
    reading: [
      { nutrient: 'N', balanceKgHa: balance.n, tendency: tendency(balance.n) },
      { nutrient: 'P2O5', balanceKgHa: balance.p2o5, tendency: tendency(balance.p2o5) },
      { nutrient: 'K2O', balanceKgHa: balance.k2o, tendency: tendency(balance.k2o) },
    ],
    warnings: ['warning.nutrient-balance-not-prescription', 'warning.removal-coefficients-reference-not-local'],
  };
}

/**
 * Nitrate leaching screening from simulated seasonal drainage.
 * Drainage comes from the caller's season simulation; risk rises with
 * drainage depth and sand fraction. Qualitative screening only — no
 * leached-mass claim without soil solution measurements.
 */
export function leachingRisk(input: { drainageMmSeason: number; sandPct: number; nitrogenInputKgHa: number }): {
  level: 'low' | 'moderate' | 'high'; score: number; reason: string; kind: 'modeled-estimate';
} {
  const drainage = num(input.drainageMmSeason, 0, 5000, 'drainageMmSeason');
  const sand = num(input.sandPct, 0, 100, 'sandPct');
  num(input.nitrogenInputKgHa, 0, 2000, 'nitrogenInputKgHa');
  // Transparent screening score: drainage (mm) weighted by coarse texture and N load.
  const score = (drainage / 100) * (0.5 + sand / 100) * (input.nitrogenInputKgHa > 0 ? Math.min(2, input.nitrogenInputKgHa / 100) : 0.5);
  const level = score < 0.5 ? 'low' as const : score < 1.5 ? 'moderate' as const : 'high' as const;
  return {
    level, score, kind: 'modeled-estimate',
    reason: `Season drainage ${drainage} mm, sand ${sand}%, N input ${input.nitrogenInputKgHa} kg/ha. ${level === 'high' ? 'Deep drainage through coarse soil can carry nitrate below the roots; split N applications and avoid irrigation far beyond deficit.' : level === 'moderate' ? 'Some drainage-driven nitrate movement is plausible; timing fertilizer close to crop uptake reduces exposure.' : 'Low screened leaching exposure under these scenario numbers.'} Screening only — not a measured leaching loss.`,
  };
}
