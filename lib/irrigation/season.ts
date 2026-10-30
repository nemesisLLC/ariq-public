/**
 * Crop-season simulation and water-related yield-impact engine (Feature 5).
 *
 * Methods (see docs/water-futures-simulation.md):
 * - FAO-56 single-coefficient ETc with Ks stress (Eqs. 58, 81, 84, 85),
 *   reusing kcForDay / stressCoefficient from the Feature 1 scheduler.
 * - FAO-33 / FAO-66 (Doorenbos & Kassam 1979; Steduto et al. 2012)
 *   yield response: Ya/Ym = 1 - Ky * (1 - ETa/ETm) at season level.
 *   This is NOT AquaCrop: no canopy growth, biomass, harvest index,
 *   fertility, salinity, CO2, or pest/disease modelling is performed.
 * - Weather beyond a short forecast must be supplied as historical
 *   analog years (ERA5 in the API layer) and is labelled as such.
 * All calculations are canonical SI (mm, m3, ha, degC) and deterministic.
 */
import { InputError } from './core.ts';
import { kcForDay, stressCoefficient, type KcCurve } from './scheduler.ts';
import { CROPS, type CropReference } from './recommendation.ts';

export type SeasonWeatherDay = { date: string; et0Mm: number; rainMm: number; tmeanC?: number };
export type SoilPreset = { id: string; fieldCapacity: number; wiltingPoint: number; rootDepthM: number; depletionFraction: number; targetDepletionFraction: number; initialDepletionMm: number; kind: 'illustrative-reference'; note: string };
/** Illustrative soil presets from FAO-56 typical soil-water ranges. They never describe a real field. */
export const SOIL_PRESETS: SoilPreset[] = [
  { id: 'soil.sandy-loam-reference', fieldCapacity: 0.18, wiltingPoint: 0.08, rootDepthM: 0.6, depletionFraction: 0.5, targetDepletionFraction: 0.2, initialDepletionMm: 30, kind: 'illustrative-reference', note: 'Illustrative sandy-loam reference (FAO-56 typical range). Not this field.' },
  { id: 'soil.loam-reference', fieldCapacity: 0.28, wiltingPoint: 0.13, rootDepthM: 0.8, depletionFraction: 0.5, targetDepletionFraction: 0.2, initialDepletionMm: 40, kind: 'illustrative-reference', note: 'Illustrative loam reference (FAO-56 typical range). Not this field.' },
  { id: 'soil.clay-loam-reference', fieldCapacity: 0.36, wiltingPoint: 0.20, rootDepthM: 0.8, depletionFraction: 0.5, targetDepletionFraction: 0.2, initialDepletionMm: 50, kind: 'illustrative-reference', note: 'Illustrative clay-loam reference (FAO-56 typical range). Not this field.' },
];
export const soilPresetById = new Map(SOIL_PRESETS.map(s => [s.id, s]));

export type YieldReference = { cropId: string; kySeasonal: number; source: string };
const KY_SOURCE = 'FAO Irrigation and Drainage Paper 33 (Doorenbos & Kassam 1979) seasonal Ky, as tabulated in FAO Irrigation and Drainage Paper 66 (Steduto et al. 2012, Table 1).';
export const YIELD_REFERENCES: YieldReference[] = [
  { cropId: 'cotton', kySeasonal: 0.85, source: KY_SOURCE },
  { cropId: 'winter-wheat', kySeasonal: 1.05, source: `${KY_SOURCE} FAO-66 Table 1 lists winter wheat 1.05 (spring wheat is 1.15); corrected per audit M06.` },
  { cropId: 'maize', kySeasonal: 1.25, source: KY_SOURCE },
  { cropId: 'alfalfa', kySeasonal: 1.1, source: KY_SOURCE },
  { cropId: 'tomato', kySeasonal: 1.05, source: KY_SOURCE },
  { cropId: 'potato', kySeasonal: 1.1, source: KY_SOURCE },
  { cropId: 'sunflower', kySeasonal: 0.95, source: KY_SOURCE },
  { cropId: 'melon', kySeasonal: 1.1, source: 'Watermelon Ky 1.1 from the same FAO-33/FAO-66 table, used as the documented melon proxy; treat as approximate for other melons.' },
];
export const yieldByCropId = new Map(YIELD_REFERENCES.map(y => [y.cropId, y]));

export type IrrigationStrategy = {
  seasonSupplyM3?: number; // total gate supply available over the season; omit = unconstrained supply assumption (labelled)
  minIntervalDays?: number; // irrigation frequency limit: minimum days between events
  maxEventNetMm?: number; // optional cap per event
};
export type WeatherPerturbation = {
  rainFactor?: number; // multiplies daily rain; 1 = unchanged
  et0Factor?: number; // multiplies ET0; simplified sensitivity assumption, labelled as such
  temperatureDeltaC?: number; // recorded for labelling; ET0 effect only via et0Factor (no PM recomputation without full met data)
};
export type SeasonInput = {
  cropId: string; kcCurve?: KcCurve; kySeasonal?: number; kyByStage?: [number, number, number, number];
  areaHa: number; applicationEfficiency: number;
  soil: { fieldCapacity: number; wiltingPoint: number; rootDepthM: number; depletionFraction: number; targetDepletionFraction: number; initialDepletionMm: number };
  soilKind: 'user-supplied' | 'illustrative-reference' | 'modeled-estimate';
  weather: SeasonWeatherDay[]; weatherKind: 'historical-analog' | 'forecast' | 'mixed' | 'user-supplied';
  analogYear?: number;
  strategy?: IrrigationStrategy;
  perturbation?: WeatherPerturbation;
  potentialYieldTPerHa?: number; // only caller-supplied baselines produce t/ha
  rainRetentionFraction?: number;
};
export type SeasonStage = 'initial' | 'development' | 'mid' | 'late';
export type SeasonDaily = { date: string; dayIndex: number; stage: SeasonStage; kc: number; ks: number; et0Mm: number; etCropMm: number; etCropAdjMm: number; rainMm: number; effectiveRainMm: number; irrigationNetMm: number; drainageMm: number; startDepletionMm: number; endDepletionMm: number; stress: boolean; etLimitedByAvailableWater: boolean };
export type SeasonResult = {
  cropId: string; soilKind: SeasonInput['soilKind']; weatherKind: SeasonInput['weatherKind']; analogYear: number | null;
  rootZone:{totalAvailableMm:number;readilyAvailableMm:number};
  seasonDays: number; daily: SeasonDaily[];
  stages: { stage: SeasonStage; days: number; etCropMm: number; etCropAdjMm: number; etDeficitFraction: number; stressDays: number; stressIndex: number; irrigationNetMm: number }[];
  totals: { etCropMm: number; etCropAdjMm: number; rainMm: number; effectiveRainMm: number; irrigationNetMm: number; irrigationGrossM3: number; irrigationEvents: number; drainageMm: number; stressDays: number; endDepletionMm: number };
  yieldImpact: {
    method: 'fao33-seasonal' | 'fao33-stage-product'; kySeasonal: number;
    relativeYieldRetained: number; relativeYieldLost: number; waterOnly: true;
    potentialYieldTPerHa: number | null; estimatedYieldTPerHa: number | null;
    note: string;
  };
  supply: { constrained: boolean; seasonSupplyM3: number | null; supplyUsedM3: number; unmetGrossM3: number; unmetEvents: number };
  warnings: string[];
};
function fail(m: string): never { throw new InputError(m); }
function num(v: unknown, lo: number, hi: number, label: string): number { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) fail(`${label} must be a finite number in [${lo}, ${hi}]`); return v; }
const sum = (v: number[]): number => v.reduce((a, b) => a + b, 0);
export function stageForDay(curve: KcCurve, dayIndex: number): SeasonStage {
  const { initial, development, mid } = curve.stageLengthsDays;
  if (dayIndex < initial) return 'initial';
  if (dayIndex < initial + development) return 'development';
  if (dayIndex < initial + development + mid) return 'mid';
  return 'late';
}
/** FAO-33 seasonal yield response. Returns Ya/Ym in [0, 1]. */
export function fao33RelativeYield(ky: number, etAdjMm: number, etStandardMm: number): number {
  if (!(ky >= 0) || etStandardMm < 0 || etAdjMm < 0) throw new InputError('Invalid FAO-33 inputs');
  if (etStandardMm === 0) return 1;
  const ratio = Math.min(1, Math.max(0, etAdjMm / etStandardMm));
  return Math.min(1, Math.max(0, 1 - ky * (1 - ratio)));
}

export function simulateSeason(input: SeasonInput): SeasonResult {
  const crop: CropReference | undefined = CROPS.find(c => c.id === input.cropId);
  const curve = input.kcCurve ?? crop?.kcCurve;
  if (!curve) fail(`Unknown cropId ${input.cropId} and no kcCurve supplied`);
  kcForDay(curve, 0);
  const kyRef = yieldByCropId.get(input.cropId);
  const ky = input.kySeasonal ?? kyRef?.kySeasonal;
  if (ky === undefined) fail(`No FAO-33 Ky reference for crop ${input.cropId}; supply kySeasonal`);
  num(ky, 0, 3, 'kySeasonal');
  const areaHa = num(input.areaHa, 0.001, 100000, 'areaHa'), appEff = num(input.applicationEfficiency, 0.05, 1, 'applicationEfficiency');
  const s = input.soil;
  if (s.fieldCapacity <= s.wiltingPoint) fail('soil.fieldCapacity must exceed soil.wiltingPoint');
  const taw = 1000 * (num(s.fieldCapacity, 0, 1, 'soil.fieldCapacity') - num(s.wiltingPoint, 0, 1, 'soil.wiltingPoint')) * num(s.rootDepthM, 0.05, 3, 'soil.rootDepthM');
  const raw = num(s.depletionFraction, 0.05, 0.95, 'soil.depletionFraction') * taw;
  const target = num(s.targetDepletionFraction, 0, s.depletionFraction, 'soil.targetDepletionFraction') * taw;
  let dr = num(s.initialDepletionMm, 0, taw, 'soil.initialDepletionMm');
  const retention = input.rainRetentionFraction ?? 0.8;
  num(retention, 0, 1, 'rainRetentionFraction');
  const seasonLength = curve.stageLengthsDays.initial + curve.stageLengthsDays.development + curve.stageLengthsDays.mid + curve.stageLengthsDays.late;
  if (!Array.isArray(input.weather) || input.weather.length < seasonLength) fail(`weather must cover the full ${seasonLength}-day crop season (got ${input.weather?.length ?? 0} days)`);
  const rainFactor = input.perturbation?.rainFactor ?? 1, et0Factor = input.perturbation?.et0Factor ?? 1;
  num(rainFactor, 0, 3, 'perturbation.rainFactor'); num(et0Factor, 0.2, 3, 'perturbation.et0Factor');
  const strategy = input.strategy ?? {};
  const minInterval = strategy.minIntervalDays ?? 0;
  if (!Number.isInteger(minInterval) || minInterval < 0 || minInterval > 120) fail('strategy.minIntervalDays must be an integer in 0..120');
  let supplyLeftGrossM3 = strategy.seasonSupplyM3 === undefined ? Infinity : num(strategy.seasonSupplyM3, 0, 1e12, 'strategy.seasonSupplyM3');
  let lastEventDay = -Infinity, events = 0, unmetGrossM3 = 0, unmetEvents = 0, supplyUsedM3 = 0;
  const daily: SeasonDaily[] = [];
  const weather = input.weather.slice(0, seasonLength);
  // Calendar integrity (audit M05): valid, consecutive, ascending dates.
  let prevEpoch = NaN;
  for (let day = 0; day < weather.length; day++) {
    const d = weather[day]?.date;
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(`weather[${day}].date must be YYYY-MM-DD`);
    const epoch = Date.parse(`${d}T00:00:00.000Z`);
    if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== d) fail(`weather[${day}].date is not a valid calendar date`);
    if (day > 0 && epoch - prevEpoch !== 86400000) fail('weather dates must be consecutive daily dates in ascending order');
    prevEpoch = epoch;
  }
  for (let day = 0; day < seasonLength; day++) {
    const w = weather[day];
    const et0 = num(w.et0Mm, 0, 30, `weather[${day}].et0Mm`) * et0Factor;
    const rain = num(w.rainMm, 0, 1000, `weather[${day}].rainMm`) * rainFactor;
    const kc = kcForDay(curve, day), stage = stageForDay(curve, day);
    const ks = stressCoefficient(dr, taw, raw);
    const etStd = kc * et0, etAdj = ks * etStd;
    const effRain = rain * retention;
    // Irrigation decision at day start projection: irrigate before depletion passes RAW.
    let irrNet = 0;
    const projected = dr + etAdj - effRain;
    if (projected > raw + 1e-10 * Math.max(1, taw) && day - lastEventDay >= Math.max(1, minInterval)) {
      let wantedNet = projected - target;
      if (strategy.maxEventNetMm !== undefined) wantedNet = Math.min(wantedNet, num(strategy.maxEventNetMm, 0.1, 500, 'strategy.maxEventNetMm'));
      const wantedGrossM3 = (wantedNet * areaHa * 10) / appEff;
      const affordableGrossM3 = Math.min(wantedGrossM3, supplyLeftGrossM3);
      irrNet = wantedNet * (wantedGrossM3 > 0 ? affordableGrossM3 / wantedGrossM3 : 0);
      if (irrNet > 1e-9) { events++; lastEventDay = day; supplyLeftGrossM3 -= affordableGrossM3; supplyUsedM3 += affordableGrossM3; }
      if (affordableGrossM3 < wantedGrossM3 - 1e-6) { unmetGrossM3 += wantedGrossM3 - affordableGrossM3; unmetEvents++; }
    } else if (projected > raw + 1e-10 * Math.max(1, taw) && day - lastEventDay < Math.max(1, minInterval)) {
      unmetEvents++; // frequency limit prevented a due irrigation; volume not estimated as unmet here
    }
    // Physical bound (audit M01): actual ET cannot exceed stored water + inputs.
    const etAdjBounded = Math.min(etAdj, Math.max(0, taw - dr + effRain + irrNet));
    const rawEnd = dr + etAdjBounded - effRain - irrNet;
    const drainage = Math.max(0, -rawEnd);
    const end = Math.min(taw, Math.max(0, rawEnd));
    daily.push({ date: w.date, dayIndex: day, stage, kc, ks, et0Mm: et0, etCropMm: etStd, etCropAdjMm: etAdjBounded, rainMm: rain, effectiveRainMm: effRain, irrigationNetMm: irrNet, drainageMm: drainage, startDepletionMm: dr, endDepletionMm: end, stress: ks < 1 - 1e-12, etLimitedByAvailableWater: etAdjBounded < etAdj - 1e-12 });
    dr = end;
  }
  const stageNames: SeasonStage[] = ['initial', 'development', 'mid', 'late'];
  const stages = stageNames.map(stage => {
    const ds = daily.filter(d => d.stage === stage);
    const etCropMm = sum(ds.map(d => d.etCropMm)), etCropAdjMm = sum(ds.map(d => d.etCropAdjMm));
    return { stage, days: ds.length, etCropMm, etCropAdjMm, etDeficitFraction: etCropMm > 0 ? 1 - etCropAdjMm / etCropMm : 0, stressDays: ds.filter(d => d.stress).length, stressIndex: sum(ds.map(d => 1 - d.ks)), irrigationNetMm: sum(ds.map(d => d.irrigationNetMm)) };
  });
  const etCropMm = sum(daily.map(d => d.etCropMm)), etCropAdjMm = sum(daily.map(d => d.etCropAdjMm));
  let relativeYieldRetained: number, method: SeasonResult['yieldImpact']['method'];
  if (input.kyByStage) {
    method = 'fao33-stage-product';
    let product = 1;
    // Each stage retention factor is clamped to [0, 1] before multiplying (audit M09).
    stages.forEach((st, i) => { product *= Math.min(1, Math.max(0, 1 - num(input.kyByStage![i], 0, 3, `kyByStage[${i}]`) * st.etDeficitFraction)); });
    relativeYieldRetained = Math.min(1, Math.max(0, product));
  } else {
    method = 'fao33-seasonal';
    relativeYieldRetained = fao33RelativeYield(ky, etCropAdjMm, etCropMm);
  }
  const potential = input.potentialYieldTPerHa === undefined ? null : num(input.potentialYieldTPerHa, 0.01, 100, 'potentialYieldTPerHa');
  const warnings = [
    'warning.water-only-yield-impact',
    ...(input.soilKind === 'illustrative-reference' ? ['warning.illustrative-soil-preset'] : []),
    ...(input.weatherKind === 'historical-analog' ? ['warning.historical-analog-not-forecast'] : []),
    ...(strategy.seasonSupplyM3 === undefined ? ['warning.supply-unconstrained-assumption'] : []),
    ...((input.perturbation?.temperatureDeltaC ?? 0) !== 0 ? ['warning.temperature-via-et0-factor-simplified'] : []),
  ];
  return {
    rootZone:{totalAvailableMm:taw,readilyAvailableMm:raw},
    cropId: input.cropId, soilKind: input.soilKind, weatherKind: input.weatherKind, analogYear: input.analogYear ?? null,
    seasonDays: seasonLength, daily, stages,
    totals: { etCropMm, etCropAdjMm, rainMm: sum(daily.map(d => d.rainMm)), effectiveRainMm: sum(daily.map(d => d.effectiveRainMm)), irrigationNetMm: sum(daily.map(d => d.irrigationNetMm)), irrigationGrossM3: sum(daily.map(d => d.irrigationNetMm)) * areaHa * 10 / appEff, irrigationEvents: events, drainageMm: sum(daily.map(d => d.drainageMm)), stressDays: daily.filter(d => d.stress).length, endDepletionMm: dr },
    yieldImpact: { method, kySeasonal: ky, relativeYieldRetained, relativeYieldLost: 1 - relativeYieldRetained, waterOnly: true, potentialYieldTPerHa: potential, estimatedYieldTPerHa: potential === null ? null : potential * relativeYieldRetained, note: 'Water-related impact only (FAO-33). Nutrients, disease, pests, salinity, heat damage and management are excluded. No t/ha without a caller-supplied potential-yield baseline.' },
    supply: { constrained: strategy.seasonSupplyM3 !== undefined, seasonSupplyM3: strategy.seasonSupplyM3 ?? null, supplyUsedM3, unmetGrossM3, unmetEvents },
    warnings,
  };
}

export type AnalogYearWeather = { year: number; weather: SeasonWeatherDay[] };
export function simulateEnsemble(base: Omit<SeasonInput, 'weather' | 'analogYear'>, years: AnalogYearWeather[]): { years: { year: number; result: SeasonResult }[]; summary: { relativeYieldRetained: { low: number; median: number; high: number }; irrigationGrossM3: { low: number; median: number; high: number }; stressDays: { low: number; median: number; high: number }; note: string } } {
  if (!Array.isArray(years) || years.length < 2) fail('ensemble requires at least two analog years');
  const results = years.map(y => ({ year: y.year, result: simulateSeason({ ...base, weather: y.weather, analogYear: y.year, weatherKind: 'historical-analog' }) }));
  const pct = (values: number[], q: number): number => { const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]; };
  const trio = (pick: (r: SeasonResult) => number) => { const v = results.map(x => pick(x.result)); return { low: pct(v, 0.1), median: pct(v, 0.5), high: pct(v, 0.9) }; };
  return { years: results, summary: { relativeYieldRetained: trio(r => r.yieldImpact.relativeYieldRetained), irrigationGrossM3: trio(r => r.totals.irrigationGrossM3), stressDays: trio(r => r.totals.stressDays), note: 'Ensemble spread across supplied historical analog years (10th/50th/90th ordered values). This is scenario spread, not a statistically calibrated confidence interval.' } };
}

export function compareScenarios(baseline: SeasonInput, modified: SeasonInput): { baseline: SeasonResult; modified: SeasonResult; deltas: Record<string, number> } {
  const b = simulateSeason(baseline), m = simulateSeason(modified);
  return { baseline: b, modified: m, deltas: {
    etCropMm: m.totals.etCropMm - b.totals.etCropMm, irrigationGrossM3: m.totals.irrigationGrossM3 - b.totals.irrigationGrossM3,
    irrigationNetMm: m.totals.irrigationNetMm - b.totals.irrigationNetMm, stressDays: m.totals.stressDays - b.totals.stressDays,
    relativeYieldRetained: m.yieldImpact.relativeYieldRetained - b.yieldImpact.relativeYieldRetained,
    relativeYieldLost: m.yieldImpact.relativeYieldLost - b.yieldImpact.relativeYieldLost, unmetGrossM3: m.supply.unmetGrossM3 - b.supply.unmetGrossM3,
  } };
}

/** Deterministic one-at-a-time sensitivity around a baseline season. Ranks inputs by |change in relative yield retained|. */
export function sensitivityAnalysis(base: SeasonInput): { baseline: SeasonResult; factors: { factorId: string; change: string; relativeYieldRetained: number; deltaRelativeYield: number; irrigationGrossM3: number }[] } {
  const baseline = simulateSeason(base);
  const variants: { factorId: string; change: string; input: SeasonInput }[] = [
    { factorId: 'factor.rainfall-minus-20pct', change: 'rainFactor 0.8', input: { ...base, perturbation: { ...base.perturbation, rainFactor: (base.perturbation?.rainFactor ?? 1) * 0.8 } } },
    { factorId: 'factor.rainfall-plus-20pct', change: 'rainFactor 1.2', input: { ...base, perturbation: { ...base.perturbation, rainFactor: (base.perturbation?.rainFactor ?? 1) * 1.2 } } },
    { factorId: 'factor.et0-plus-10pct-heat', change: 'et0Factor 1.1 (simplified heat sensitivity)', input: { ...base, perturbation: { ...base.perturbation, et0Factor: (base.perturbation?.et0Factor ?? 1) * 1.1, temperatureDeltaC: (base.perturbation?.temperatureDeltaC ?? 0) + 2 } } },
    { factorId: 'factor.application-efficiency-minus-10pts', change: 'applicationEfficiency -0.10', input: { ...base, applicationEfficiency: Math.max(0.05, base.applicationEfficiency - 0.1) } },
    { factorId: 'factor.irrigation-frequency-14d', change: 'minIntervalDays 14', input: { ...base, strategy: { ...base.strategy, minIntervalDays: 14 } } },
  ];
  if (base.strategy?.seasonSupplyM3 !== undefined) variants.push({ factorId: 'factor.supply-minus-40pct', change: 'seasonSupplyM3 x0.6', input: { ...base, strategy: { ...base.strategy, seasonSupplyM3: base.strategy.seasonSupplyM3 * 0.6 } } });
  const factors = variants.map(v => { const r = simulateSeason(v.input); return { factorId: v.factorId, change: v.change, relativeYieldRetained: r.yieldImpact.relativeYieldRetained, deltaRelativeYield: r.yieldImpact.relativeYieldRetained - baseline.yieldImpact.relativeYieldRetained, irrigationGrossM3: r.totals.irrigationGrossM3 }; })
    .sort((a, b) => Math.abs(b.deltaRelativeYield) - Math.abs(a.deltaRelativeYield) || (a.factorId < b.factorId ? -1 : 1));
  return { baseline, factors };
}
