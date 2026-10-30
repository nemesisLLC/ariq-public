/**
 * Location-based irrigation recommendation (Feature 4).
 *
 * Flow: farm coordinates -> Open-Meteo forecast (ET0 is the provider's
 * FAO-56 reference evapotranspiration; precipitation is liquid rain plus
 * showers, as in the existing weather module) -> Feature 1 scheduler
 * (ariq-irrigation-v2) for demand, depletion, stress and deadlines.
 * Nothing is invented: missing soil, initial depletion, or supply inputs
 * produce a useful partial result with explicit `missingInputs`, never
 * silent defaults. The SoilGrids REST API is not used (provider-paused);
 * soil must be supplied by the caller.
 */
import { fetchWeather, type Forecast } from '../weather.ts';
import { InputError } from './core.ts';
import { calculateFieldOutlook, calculateSchedule, kcForDay, type AdvancedFieldInput, type KcCurve, type ScheduleResult } from './scheduler.ts';

export type CropReference = { id: string; nameEn: string; kcCurve: KcCurve; source: string; note: string };
const FAO_KC_SOURCE = 'FAO-56 (Allen et al. 1998) Tables 11-12, typical single crop coefficients and stage lengths. Reference values, not locally calibrated for Uzbekistan; adjust with local agronomic guidance.';
export const CROPS: CropReference[] = [
  { id: 'cotton', nameEn: 'Cotton', kcCurve: { kcIni: 0.35, kcMid: 1.18, kcEnd: 0.6, stageLengthsDays: { initial: 30, development: 50, mid: 55, late: 45 } }, source: FAO_KC_SOURCE, note: 'FAO Kc mid range 1.15-1.20 and end range 0.75-0.35 by height/climate; midpoints used.' },
  { id: 'winter-wheat', nameEn: 'Winter wheat', kcCurve: { kcIni: 0.4, kcMid: 1.15, kcEnd: 0.3, stageLengthsDays: { initial: 20, development: 60, mid: 70, late: 30 } }, source: FAO_KC_SOURCE, note: 'Stage lengths vary strongly with autumn planting and winter dormancy; treat timing as approximate.' },
  { id: 'maize', nameEn: 'Maize (grain)', kcCurve: { kcIni: 0.3, kcMid: 1.2, kcEnd: 0.55, stageLengthsDays: { initial: 30, development: 50, mid: 60, late: 40 } }, source: FAO_KC_SOURCE, note: 'Grain maize; sweet maize differs.' },
  { id: 'alfalfa', nameEn: 'Alfalfa (hay, mean over cuttings)', kcCurve: { kcIni: 0.4, kcMid: 1.2, kcEnd: 1.15, stageLengthsDays: { initial: 10, development: 30, mid: 50, late: 30 } }, source: FAO_KC_SOURCE, note: 'Mean seasonal coefficients; individual cuttings cycle Kc sharply.' },
  { id: 'tomato', nameEn: 'Tomato', kcCurve: { kcIni: 0.6, kcMid: 1.15, kcEnd: 0.8, stageLengthsDays: { initial: 35, development: 40, mid: 50, late: 30 } }, source: FAO_KC_SOURCE, note: '' },
  { id: 'potato', nameEn: 'Potato', kcCurve: { kcIni: 0.5, kcMid: 1.15, kcEnd: 0.75, stageLengthsDays: { initial: 30, development: 35, mid: 50, late: 30 } }, source: FAO_KC_SOURCE, note: '' },
  { id: 'sunflower', nameEn: 'Sunflower', kcCurve: { kcIni: 0.35, kcMid: 1.1, kcEnd: 0.35, stageLengthsDays: { initial: 25, development: 35, mid: 45, late: 25 } }, source: FAO_KC_SOURCE, note: '' },
  { id: 'melon', nameEn: 'Melon (cantaloupe)', kcCurve: { kcIni: 0.5, kcMid: 1.05, kcEnd: 0.75, stageLengthsDays: { initial: 30, development: 45, mid: 65, late: 25 } }, source: FAO_KC_SOURCE, note: '' },
];
export const cropById = new Map(CROPS.map(c => [c.id, c]));

export class ForecastUnavailableError extends Error {
  constructor(message = 'The forecast source is unavailable. No invented weather has been substituted.') { super(message); this.name = 'ForecastUnavailableError'; }
}

// ------------------------------------------------------------------- caching
export type ForecastCacheEntry = { forecast: Forecast; fetchedAtMs: number };
export class ForecastCache {
  private entries = new Map<string, ForecastCacheEntry>();
  readonly ttlMs: number;
  readonly maxEntries: number;
  constructor(ttlMs = 30 * 60 * 1000, maxEntries = 500) { this.ttlMs = ttlMs; this.maxEntries = maxEntries; }
  key(lat: number, lon: number): string { return `${lat.toFixed(3)},${lon.toFixed(3)}`; }
  get(lat: number, lon: number, nowMs: number): ForecastCacheEntry | null {
    const e = this.entries.get(this.key(lat, lon));
    return e && nowMs - e.fetchedAtMs <= this.ttlMs ? e : null;
  }
  getStale(lat: number, lon: number): ForecastCacheEntry | null { return this.entries.get(this.key(lat, lon)) ?? null; }
  set(lat: number, lon: number, forecast: Forecast, nowMs: number): void {
    if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(this.key(lat, lon), { forecast, fetchedAtMs: nowMs });
  }
  clear(): void { this.entries.clear(); }
  get size(): number { return this.entries.size; }
}
const globalState = globalThis as typeof globalThis & { __ariqForecastCache?: ForecastCache };
export const forecastCache = globalState.__ariqForecastCache ??= new ForecastCache();

/** Hard stale cutoff (audit M08): stale-after-failure data older than this, or whose forecast days have all passed, is never used for a recommendation. */
export const MAX_STALE_FORECAST_MS = 6 * 60 * 60 * 1000;
export async function fetchForecastCached(lat: number, lon: number, options: { fetcher?: typeof fetch; cache?: ForecastCache; nowMs?: number; maxStaleMs?: number } = {}): Promise<{ forecast: Forecast; cacheStatus: 'live' | 'cached' | 'stale-after-failure' }> {
  const cache = options.cache ?? forecastCache, now = options.nowMs ?? Date.now();
  const hit = cache.get(lat, lon, now);
  if (hit) return { forecast: hit.forecast, cacheStatus: 'cached' };
  try {
    const forecast = await fetchWeather(lat, lon, options.fetcher);
    cache.set(lat, lon, forecast, now);
    return { forecast, cacheStatus: 'live' };
  } catch {
    const stale = cache.getStale(lat, lon);
    const maxStale = options.maxStaleMs ?? MAX_STALE_FORECAST_MS;
    if (stale && now - stale.fetchedAtMs <= maxStale) {
      const lastDate = stale.forecast.daily.time[stale.forecast.daily.time.length - 1];
      const today = new Date(now).toISOString().slice(0, 10);
      if (lastDate && lastDate >= today) return { forecast: stale.forecast, cacheStatus: 'stale-after-failure' };
    }
    throw new ForecastUnavailableError();
  }
}

// -------------------------------------------------------------------- inputs
export type RecommendationInput = {
  latitude: number; longitude: number; areaHa: number; plantingDate: string;
  /** Optional (audit M07): millimetre demand never needs it. Required only to express gross volumes / run a delivery schedule. */
  applicationEfficiency?: number;
  cropId?: string; kcCurve?: KcCurve; kc?: number;
  soil?: { fieldCapacity: number; wiltingPoint: number; rootDepthM: number; depletionFraction: number; targetDepletionFraction?: number; initialDepletionMm?: number };
  initialDepletionKind?: 'user-assumed';
  rainRetentionFraction?: number;
  supply?: { availableWaterM3: number; sourceMaxFlowM3PerHour: number; canalMaxFlowM3PerHour: number; canalEfficiency: number; windowHoursPerDay: number };
};
const UZ_BBOX = { minLat: 37.0, maxLat: 45.7, minLon: 55.9, maxLon: 73.3 };
function fail(message: string): never { throw new InputError(message); }
function num(value: unknown, low: number, high: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) fail(`${label} must be a finite number in [${low}, ${high}]`);
  return value;
}
function parseInput(value: unknown): RecommendationInput & { crop: CropReference | { id: 'custom' } } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('input must be an object');
  const p = value as Record<string, unknown>;
  const latitude = num(p.latitude, -90, 90, 'latitude'), longitude = num(p.longitude, -180, 180, 'longitude');
  if (latitude < UZ_BBOX.minLat || latitude > UZ_BBOX.maxLat || longitude < UZ_BBOX.minLon || longitude > UZ_BBOX.maxLon) fail('coordinates are outside Uzbekistan (ARIQ covers Uzbekistan; no recommendation was calculated)');
  if (typeof p.plantingDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.plantingDate)) fail('plantingDate must be YYYY-MM-DD');
  const plantingEpoch = Date.parse(`${p.plantingDate}T00:00:00.000Z`);
  if (!Number.isFinite(plantingEpoch) || new Date(plantingEpoch).toISOString().slice(0, 10) !== p.plantingDate) fail('plantingDate is not a valid calendar date');
  let crop: CropReference | { id: 'custom' };
  let kcCurve: KcCurve | undefined, kc: number | undefined;
  if (p.kcCurve !== undefined) { kcCurve = p.kcCurve as KcCurve; kcForDay(kcCurve, 0); crop = { id: 'custom' }; }
  else if (p.kc !== undefined) { kc = num(p.kc, 0, 2.5, 'kc'); crop = { id: 'custom' }; }
  else {
    if (typeof p.cropId !== 'string' || !cropById.has(p.cropId)) fail(`cropId must be one of ${[...cropById.keys()].join(', ')} (or supply kc / kcCurve)`);
    const ref = cropById.get(p.cropId)!;
    crop = ref; kcCurve = ref.kcCurve;
  }
  const input: RecommendationInput & { crop: CropReference | { id: 'custom' } } = {
    latitude, longitude, areaHa: num(p.areaHa, 0.001, 100000, 'areaHa'), plantingDate: p.plantingDate,
    ...(p.applicationEfficiency === undefined ? {} : { applicationEfficiency: num(p.applicationEfficiency, 0.05, 1, 'applicationEfficiency') }), crop,
    ...(kcCurve ? { kcCurve } : {}), ...(kc !== undefined ? { kc } : {}),
    ...(typeof p.cropId === 'string' ? { cropId: p.cropId } : {}),
  };
  if (p.rainRetentionFraction !== undefined) input.rainRetentionFraction = num(p.rainRetentionFraction, 0, 1, 'rainRetentionFraction');
  if (p.soil !== undefined) {
    if (p.soil === null || typeof p.soil !== 'object' || Array.isArray(p.soil)) fail('soil must be an object');
    const s = p.soil as Record<string, unknown>;
    const fieldCapacity = num(s.fieldCapacity, 0, 1, 'soil.fieldCapacity'), wiltingPoint = num(s.wiltingPoint, 0, 1, 'soil.wiltingPoint');
    if (fieldCapacity <= wiltingPoint) fail('soil.fieldCapacity must exceed soil.wiltingPoint');
    input.soil = { fieldCapacity, wiltingPoint, rootDepthM: num(s.rootDepthM, 0.05, 3, 'soil.rootDepthM'), depletionFraction: num(s.depletionFraction, 0.05, 0.95, 'soil.depletionFraction') };
    if (s.targetDepletionFraction !== undefined) input.soil.targetDepletionFraction = num(s.targetDepletionFraction, 0, 1, 'soil.targetDepletionFraction');
    if (s.initialDepletionMm !== undefined) {
      input.soil.initialDepletionMm = num(s.initialDepletionMm, 0, 1000, 'soil.initialDepletionMm');
      input.initialDepletionKind = 'user-assumed';
    }
  }
  if (p.supply !== undefined) {
    if (p.supply === null || typeof p.supply !== 'object' || Array.isArray(p.supply)) fail('supply must be an object');
    const s = p.supply as Record<string, unknown>;
    const required = ['availableWaterM3', 'sourceMaxFlowM3PerHour', 'canalMaxFlowM3PerHour', 'canalEfficiency', 'windowHoursPerDay'] as const;
    const missing = required.filter(k => s[k] === undefined);
    if (missing.length === 0) {
      input.supply = { availableWaterM3: num(s.availableWaterM3, 0, 1e9, 'supply.availableWaterM3'), sourceMaxFlowM3PerHour: num(s.sourceMaxFlowM3PerHour, 0, 1e7, 'supply.sourceMaxFlowM3PerHour'), canalMaxFlowM3PerHour: num(s.canalMaxFlowM3PerHour, 0, 1e7, 'supply.canalMaxFlowM3PerHour'), canalEfficiency: num(s.canalEfficiency, 0.05, 1, 'supply.canalEfficiency'), windowHoursPerDay: num(s.windowHoursPerDay, 0.01, 24, 'supply.windowHoursPerDay') };
    } else if (missing.length < required.length) {
      fail(`supply is incomplete: missing ${missing.join(', ')}. Supply all of them or omit supply entirely.`);
    }
  }
  return input;
}

// --------------------------------------------------------------- calculation
export type RecommendationResult = {
  kind: string; calculationTier: string;
  location: { latitude: number; longitude: number; forecastGrid?: { latitude: number; longitude: number; timezone: string } };
  crop: Record<string, unknown> & { kcCurve?: KcCurve };
  plantingDate: string; kcStartDayIndex?: number;
  provenance: ReturnType<typeof provenance>;
  forecastDays: { date: string; et0Mm: number; rainMm: number; kc: number }[];
  demand: (Record<string, unknown> & { totalEtCropMm?: number; totalDeficitMm?: number; totalNetIrrigationMm?: number }) | null;
  outlook: { firstStressDateWithoutIrrigation: string | null; stressDaysWithoutIrrigation: number; irrigationEvents: { eventId: string; deadlineDate: string; netIrrigationMm: number; grossDemandM3: number }[] } | null;
  schedule: { events: ScheduleResult['events']; deliveries: ScheduleResult['deliveries']; totals: ScheduleResult['totals']; warnings: string[] } | null;
  missingInputs: { field: string; effect: string }[]; warnings: string[];
};
export async function recommend(value: unknown, options: { fetcher?: typeof fetch; cache?: ForecastCache; nowMs?: number } = {}): Promise<RecommendationResult> {
  const input = parseInput(value);
  const { forecast, cacheStatus } = await fetchForecastCached(input.latitude, input.longitude, options);
  const allWeather = forecast.daily.time.map((date, i) => ({ date, et0Mm: forecast.daily.et0_fao_evapotranspiration[i], rainMm: forecast.daily.rain_sum[i] + forecast.daily.showers_sum[i] }));
  const plantingEpoch = Date.parse(`${input.plantingDate}T00:00:00.000Z`);
  const firstEpoch = Date.parse(`${allWeather[0].date}T00:00:00.000Z`);
  const kcStartDayIndex = Math.max(0, Math.round((firstEpoch - plantingEpoch) / 86400000));
  const weather = allWeather.filter(w => Date.parse(`${w.date}T00:00:00.000Z`) >= plantingEpoch);
  const retention = input.rainRetentionFraction ?? 0.8;
  const missingInputs: { field: string; effect: string }[] = [];
  const warnings: string[] = [
    'Weather is an Open-Meteo model forecast (ET0 is the provider FAO-56 reference evapotranspiration), not a field measurement.',
    'Crop coefficients are FAO-56 reference values, not locally calibrated and not a yield prediction. No yield or water-saving claim is made.',
  ];
  if (cacheStatus === 'stale-after-failure') warnings.push('The forecast source could not be reached; a previously cached forecast for this location is shown and marked stale.');
  if (weather.length === 0) {
    return {
      kind: 'irrigation-recommendation', calculationTier: 'not-yet-planted', location: { latitude: input.latitude, longitude: input.longitude },
      crop: cropDescription(input), plantingDate: input.plantingDate,
      provenance: provenance(input, forecast, cacheStatus, retention),
      forecastDays: [], demand: null, outlook: null, schedule: null,
      missingInputs: [{ field: 'forecast-horizon', effect: 'Planting date is after the 7-day forecast horizon; no crop demand was calculated.' }],
      warnings,
    };
  }
  if (allWeather.length !== weather.length) warnings.push('Forecast days before the planting date were excluded.');

  const effDefined = input.applicationEfficiency !== undefined;
  if (!effDefined) missingInputs.push({ field: 'applicationEfficiency', effect: 'Millimetre water demand is unaffected, but gross cubic-metre volumes and any delivery schedule require an irrigation application efficiency. No efficiency was assumed.' });
  const fieldBase = { id: 'farm-field', nodeId: 'farm-field', areaHa: input.areaHa, applicationEfficiency: input.applicationEfficiency ?? 1, priority: 1, kcStartDayIndex };
  let demand: Record<string, unknown>;
  let outlook: ReturnType<typeof calculateFieldOutlook> | null = null;
  let schedule: ScheduleResult | null = null;

  if (!input.soil) {
    missingInputs.push({ field: 'soil', effect: 'Soil properties were not supplied, so soil-water depletion, water stress and irrigation deadlines cannot be calculated. ARIQ does not invent soil properties (SoilGrids is not used).' });
    const daily = weather.map((w, i) => {
      const kc = input.kcCurve ? kcForDay(input.kcCurve, kcStartDayIndex + i) : input.kc!;
      const etCropMm = kc * w.et0Mm;
      const effectiveRainMm = w.rainMm * retention;
      return { date: w.date, et0Mm: w.et0Mm, rainMm: w.rainMm, effectiveRainMm, kc, etCropMm, deficitMm: Math.max(0, etCropMm - effectiveRainMm) };
    });
    demand = { tier: 'et-deficit-only-no-soil-storage', daily, totalEtCropMm: sum(daily.map(d => d.etCropMm)), totalEffectiveRainMm: sum(daily.map(d => d.effectiveRainMm)), totalDeficitMm: sum(daily.map(d => d.deficitMm)), note: 'Deficit is ETc minus effective rain with no soil-storage accounting; it is not an irrigation schedule.' };
  } else {
    const target = input.soil.targetDepletionFraction ?? Math.min(0.2, input.soil.depletionFraction);
    if (input.soil.targetDepletionFraction === undefined) warnings.push('soil.targetDepletionFraction was not supplied; refill target uses 0.2 of TAW (or the depletion fraction if lower) as a stated modelling assumption.');
    if (input.soil.initialDepletionMm === undefined) {
      missingInputs.push({ field: 'soil.initialDepletionMm', effect: 'Current soil depletion is unknown (ARIQ does not measure or invent soil moisture), so depletion, stress and deadlines cannot be calculated. Supply an assumed initial depletion to run the soil-water balance as a simulation.' });
      const daily = weather.map((w, i) => {
        const kc = input.kcCurve ? kcForDay(input.kcCurve, kcStartDayIndex + i) : input.kc!;
        const etCropMm = kc * w.et0Mm;
        const effectiveRainMm = w.rainMm * retention;
        return { date: w.date, et0Mm: w.et0Mm, rainMm: w.rainMm, effectiveRainMm, kc, etCropMm, deficitMm: Math.max(0, etCropMm - effectiveRainMm) };
      });
      demand = { tier: 'et-deficit-only-no-initial-depletion', daily, totalEtCropMm: sum(daily.map(d => d.etCropMm)), totalEffectiveRainMm: sum(daily.map(d => d.effectiveRainMm)), totalDeficitMm: sum(daily.map(d => d.deficitMm)), note: 'ET deficit without soil-water state; no stress or deadline claim.' };
    } else {
      const field: AdvancedFieldInput = { ...fieldBase, ...(input.kcCurve ? { kcCurve: input.kcCurve } : { kc: input.kc! }),
        soil: { fieldCapacity: input.soil.fieldCapacity, wiltingPoint: input.soil.wiltingPoint, rootDepthM: input.soil.rootDepthM, depletionFraction: input.soil.depletionFraction, initialDepletionMm: input.soil.initialDepletionMm, targetDepletionFraction: target } };
      outlook = calculateFieldOutlook(field, weather, retention);
      demand = { tier: 'soil-water-balance', totalAvailableMm: outlook.totalAvailableMm, readilyAvailableMm: outlook.readilyAvailableMm, totalNetIrrigationMm: outlook.totalNetIrrigationMm, totalGrossDemandM3: effDefined ? outlook.totalGrossDemandM3 : null, daily: outlook.dailyNoIrrigation };
      if (!input.supply) {
        missingInputs.push({ field: 'supply', effect: 'No canal capacity / available water was supplied, so no feasible delivery schedule was generated. Demand, depletion, stress and deadlines are shown without a schedule.' });
      } else if (!effDefined) {
        // Schedule volumes are gross volumes; without an efficiency they cannot be expressed honestly.
      } else {
        schedule = calculateSchedule({
          kind: 'simulation', inputNote: 'Location-based recommendation: farmer-supplied field, soil and supply assumptions with Open-Meteo forecast weather. Simulated, not measured.',
          rainRetentionFraction: retention, weather,
          fields: [field],
          network: { sourceId: 'source', nodes: ['source', 'farm-field'], supplyM3: input.supply.availableWaterM3, sourceMaxFlowM3PerHour: input.supply.sourceMaxFlowM3PerHour, windowHoursPerDay: input.supply.windowHoursPerDay, edges: [{ id: 'farm-canal', from: 'source', to: 'farm-field', maxFlowM3PerHour: input.supply.canalMaxFlowM3PerHour, efficiency: input.supply.canalEfficiency, closed: false }] },
        });
      }
    }
  }
  return {
    kind: 'irrigation-recommendation',
    calculationTier: schedule ? 'demand-stress-and-schedule' : outlook ? 'demand-and-stress-no-schedule' : 'demand-only',
    location: { latitude: input.latitude, longitude: input.longitude, forecastGrid: { latitude: forecast.latitude, longitude: forecast.longitude, timezone: forecast.timezone } },
    crop: cropDescription(input), plantingDate: input.plantingDate, kcStartDayIndex,
    provenance: provenance(input, forecast, cacheStatus, retention),
    forecastDays: weather.map((w, i) => ({ date: w.date, et0Mm: w.et0Mm, rainMm: w.rainMm, kc: input.kcCurve ? kcForDay(input.kcCurve, kcStartDayIndex + i) : input.kc! })),
    demand, outlook: outlook ? { firstStressDateWithoutIrrigation: outlook.firstStressDateWithoutIrrigation, stressDaysWithoutIrrigation: outlook.stressDaysWithoutIrrigation, irrigationEvents: effDefined ? outlook.irrigationEvents : outlook.irrigationEvents.map(e => ({ ...e, grossDemandM3: null as unknown as number })) } : null,
    schedule: schedule ? { events: schedule.events, deliveries: schedule.deliveries, totals: schedule.totals, warnings: schedule.warnings } : null,
    missingInputs, warnings,
  };
}
const sum = (v: number[]): number => v.reduce((a, b) => a + b, 0);
function cropDescription(input: RecommendationInput & { crop: CropReference | { id: 'custom' } }) {
  return 'kcCurve' in input.crop && typeof input.crop.id === 'string' && input.crop.id !== 'custom'
    ? { kind: 'reference', ...(input.crop as CropReference) }
    : { kind: 'user-supplied', id: 'custom', note: 'Caller-supplied Kc/Kc curve; no reference crop was assumed.' };
}
function provenance(input: RecommendationInput, forecast: Forecast, cacheStatus: string, retention: number) {
  return {
    weather: { kind: 'forecast', provider: 'Open-Meteo', sourceUrl: forecast.source, retrievedAt: forecast.retrievedAt, cacheStatus, validThrough: forecast.daily.time[forecast.daily.time.length - 1] ?? null, maxStaleMs: MAX_STALE_FORECAST_MS, values: 'ET0: provider FAO-56 reference evapotranspiration (forecast). Rain: forecast liquid rain plus showers; snowfall excluded, no snowmelt model.' },
    crop: { kind: 'reference-or-user-supplied' },
    soil: input.soil ? { kind: 'user-supplied-assumed', measured: false, initialDepletionKind: input.initialDepletionKind ?? null } : { kind: 'missing', measured: false },
    rainRetentionFraction: { value: retention, kind: input.rainRetentionFraction === undefined ? 'assumed-default' : 'user-supplied' },
    supply: input.supply ? { kind: 'user-supplied-assumed', measured: false } : { kind: 'missing', measured: false },
    result: { kind: 'simulated', measuredSoilMoisture: false, yieldPrediction: false },
  };
}
