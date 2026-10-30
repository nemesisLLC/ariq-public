/**
 * Unified automatic farm intelligence (connects Features 1-6 + Phase 1/2).
 *
 * One call builds the most complete farm profile ARIQ can defend from a
 * land selection, a crop and a planting date. It creates NO new science:
 * every number comes from an existing validated engine or dataset —
 *
 * - Phase 1/2 evidence (`getFarmEvidence`): location-specific SoilGrids
 *   soil (Saxton–Rawls retention via lib/soil-fertility.ts), documented
 *   water proximity, ERA5 climate context, SIAT national context, the
 *   explicit groundwater null, and the Khorezm lab-validation context.
 * - Feature 4 recommendation (`recommend`), which runs the Feature 1
 *   scheduler on Open-Meteo FAO-56 ET0 forecasts. The profile feeds it
 *   the Phase 2 soil retention plus FAO-56 Table 22 crop root-depth /
 *   depletion-fraction references, so a farmer who supplies no soil data
 *   still gets demand from the best available modelled evidence —
 *   labelled as modelled, never as measured.
 * - Feature 5 references: FAO-56 Kc stage calendar and FAO-33 Ky
 *   water-yield sensitivity (relative only; no yield is predicted).
 *
 * Honesty rules: unknown measurements stay unknown (current soil
 * moisture, groundwater depth, actual water supply/connectivity, lab
 * soil test, field area for a point-only selection). Optional seed
 * quantity produces a seeding rate (kg/ha) and a comparison with a
 * general reference range; seed NEVER changes irrigation calculations.
 */
import { getFarmEvidence, type FarmEvidence } from './farm-intelligence.ts';
import { polygonAreaKm2, polygonCentroid } from './soil-grid.ts';
import { cropById, recommend, ForecastUnavailableError, type ForecastCache, type RecommendationResult } from './irrigation/recommendation.ts';
import { fetchEra5LandSoilMoisture, estimateInitialDepletion, era5LayersForEstimate, type Era5LandSoilMoisture, type InitialDepletionEstimate } from './irrigation/soil-moisture.ts';
import { kcForDay } from './irrigation/scheduler.ts';
import { yieldByCropId } from './irrigation/season.ts';
import { InputError } from './irrigation/core.ts';

function fail(m: string): never { throw new InputError(m); }
function num(v: unknown, lo: number, hi: number, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) fail(`${label} must be a finite number in [${lo}, ${hi}]`);
  return v;
}
const DAY_MS = 86400000;
const fmt = (epoch: number) => new Date(epoch).toISOString().slice(0, 10);

/**
 * FAO-56 Table 22 (Allen et al. 1998): ranges of maximum effective
 * rooting depth Zr and depletion fraction p (for ETc ~5 mm/day).
 * `rootDepthUsedM` is the range midpoint. Zr is a MAXIMUM depth: young
 * crops root shallower, and the existing engines use one constant depth
 * — a stated simplification, overridable by the caller.
 */
export const CROP_SOIL_REFERENCE: Record<string, { rootDepthRangeM: [number, number]; rootDepthUsedM: number; depletionFraction: number; source: string }> = {
  cotton: { rootDepthRangeM: [1.0, 1.7], rootDepthUsedM: 1.35, depletionFraction: 0.65, source: 'FAO-56 Table 22 (cotton)' },
  'winter-wheat': { rootDepthRangeM: [1.5, 1.8], rootDepthUsedM: 1.65, depletionFraction: 0.55, source: 'FAO-56 Table 22 (winter wheat)' },
  maize: { rootDepthRangeM: [1.0, 1.7], rootDepthUsedM: 1.35, depletionFraction: 0.55, source: 'FAO-56 Table 22 (maize, field grain)' },
  alfalfa: { rootDepthRangeM: [1.0, 2.0], rootDepthUsedM: 1.5, depletionFraction: 0.55, source: 'FAO-56 Table 22 (alfalfa hay)' },
  tomato: { rootDepthRangeM: [0.7, 1.5], rootDepthUsedM: 1.1, depletionFraction: 0.4, source: 'FAO-56 Table 22 (tomato)' },
  potato: { rootDepthRangeM: [0.4, 0.6], rootDepthUsedM: 0.5, depletionFraction: 0.35, source: 'FAO-56 Table 22 (potato)' },
  sunflower: { rootDepthRangeM: [0.8, 1.5], rootDepthUsedM: 1.15, depletionFraction: 0.45, source: 'FAO-56 Table 22 (sunflower)' },
  melon: { rootDepthRangeM: [0.8, 1.5], rootDepthUsedM: 1.15, depletionFraction: 0.4, source: 'FAO-56 Table 22 (watermelon, used as the melon reference)' },
};

/**
 * General agronomic seeding-rate reference ranges (kg/ha). These are
 * broad practice ranges, NOT locally calibrated for Uzbekistan: variety,
 * seed size, germination, treatment (e.g. delinted cotton) and drill
 * calibration govern the real rate. Tomato is normally transplanted, so
 * no direct-seed range is offered. Used only to contextualise the
 * farmer's own rate; never fed into any irrigation calculation.
 */
export const SEEDING_REFERENCE_KG_PER_HA: Record<string, { rangeKgPerHa: [number, number] | null; note: string }> = {
  cotton: { rangeKgPerHa: [40, 80], note: 'Wide because fuzzy vs delinted seed differ greatly.' },
  'winter-wheat': { rangeKgPerHa: [150, 250], note: 'Depends on thousand-kernel weight and target plant density.' },
  maize: { rangeKgPerHa: [20, 30], note: 'Grain maize; hybrid seed size varies.' },
  alfalfa: { rangeKgPerHa: [12, 25], note: 'Pure-live-seed basis; coated seed weighs more.' },
  tomato: { rangeKgPerHa: null, note: 'Tomato is normally transplanted; no direct-seed reference rate is offered.' },
  potato: { rangeKgPerHa: [1500, 3000], note: 'Seed tubers (not true seed); depends on tuber size and spacing.' },
  sunflower: { rangeKgPerHa: [4, 8], note: 'Hybrid sunflower seed.' },
  melon: { rangeKgPerHa: [2, 5], note: 'Depends on seed size and hill spacing.' },
};

export type FarmProfileInput = {
  /** Representative point. Optional when a polygon is supplied (its area centroid is used). */
  latitude?: number; longitude?: number;
  /** User-drawn planning boundary ([longitude, latitude] ring). NOT a surveyed cadastral parcel. */
  polygon?: [number, number][];
  cropId: string;
  plantingDate: string;
  /** Optional total seed the farmer plans to use, kg. Never affects irrigation. */
  seedQuantityKg?: number;
  /** Known field area for point selections; polygon area wins when both are given. */
  areaHa?: number;
  /** Advanced overrides — supplied values always beat automatic references. */
  applicationEfficiency?: number;
  retentionOverride?: {fieldCapacity:number;wiltingPoint:number;source:string;kind:'user-supplied-measurement'|'user-supplied-scenario'};
  initialDepletionMm?: number;
  /**
   * Provenance of `initialDepletionMm` when auto-populated from the
   * TerraPulse ERA5-Land modelled scenario (DeliveryPlanner prefill)
   * rather than typed by the user. Preserved through results so the
   * modelled scenario value is never described as measured moisture.
   */
  initialDepletionSource?: 'terraPulse-modelled-scenario' | 'user-entered';
  supply?: { availableWaterM3: number; sourceMaxFlowM3PerHour: number; canalMaxFlowM3PerHour: number; canalEfficiency: number; windowHoursPerDay: number };
  rootDepthM?: number;
  depletionFraction?: number;
};

export type FarmProfile = {
  suppliedInputs: FarmProfileInput;
  kind: 'unified-farm-profile'; version: 1;
  location: { latitude: number; longitude: number; representativePointSource: 'user-point' | 'polygon-area-centroid'; region: string | null };
  area: { areaHa: number | null; source: 'polygon-geodesic' | 'user-supplied' | 'unknown-point-only'; note: string };
  evidence: FarmEvidence;
  crop: {
    id: string; nameEn: string; kcCurve: unknown; kcSource: string;
    soilReference: typeof CROP_SOIL_REFERENCE[string] & { rootDepthSource: 'fao56-table22-midpoint' | 'user-override'; depletionFractionSource: 'fao56-table22' | 'user-override' };
    yieldSensitivity: { kySeasonal: number; band: 'lower' | 'moderate' | 'high'; source: string; note: string } | null;
  };
  planting: {
    plantingDate: string; seasonLengthDays: number; expectedMaturityDate: string;
    stageCalendar: { stage: string; startDate: string; endDate: string; days: number; kcAtStart: number; kcAtEnd: number }[];
    seeding: {
      quantityKg: number | null; areaHa: number | null; seedingRateKgPerHa: number | null;
      referenceRangeKgPerHa: [number, number] | null;
      assessment: 'within-reference-range' | 'below-reference-range' | 'above-reference-range' | 'no-reference-range' | 'area-unknown' | 'not-supplied';
      note: string; affectsIrrigationCalculations: false;
    };
  };
  autoSoilForIrrigation: {
    fieldCapacity: number; wiltingPoint: number; rootDepthM: number; depletionFraction: number;
    kind: 'modeled-soil-plus-crop-reference'; measured: false;
    chain: string;
  } | null;
  irrigation: RecommendationResult | null;
  irrigationStatus: 'calculated' | 'forecast-unavailable';
  /**
   * Water-crisis relevance, in the farmer's units: the forecast window's
   * crop water demand converted mm -> m3 (1 mm over 1 ha = 10 m3; unit
   * conversion only, no new science). Net means water the crop needs in
   * the root zone; gross (what must be delivered) exists only when the
   * farmer supplied an application efficiency. This section NEVER claims
   * water savings: ARIQ has no measured baseline of this farm's current
   * practice to save against.
   */
  waterImpact: {
    windowDays: number;
    etCropMm: number | null; forecastRainMm: number | null;
    netDemandMm: number | null; netDemandM3PerHa: number | null;
    farmNetDemandM3: number | null; farmGrossDemandM3: number | null;
    basis: string;
  };
  /** Deterministic advisory IDs derived from the computed numbers above. Guidance, not prescriptions. */
  advisories: { id: string; basis: string }[];
  /**
   * Phase 3 automatic soil moisture: an ERA5-Land modelled SCENARIO for
   * initial root-zone depletion (never a measurement, never overriding a
   * farmer-supplied depletion), with the existing FAO-56 engine run at
   * the low/central/high depletion values so the uncertainty is visible
   * as a range of stress timing. See lib/irrigation/soil-moisture.ts for
   * the ERA5-Land/SMAP/Copernicus investigation behind this design.
   */
  soilMoisture: {
    status: 'scenario-available' | 'depletion-estimate-only' | 'unavailable-no-auto-soil' | 'unavailable-source-failure';
    kind: 'modeled-soil-moisture-scenario-not-measurement';
    source: Era5LandSoilMoisture | null;
    estimate: InitialDepletionEstimate | null;
    scenarios: { id: 'wetter' | 'central' | 'drier'; initialDepletionMm: number; calculationTier: string; firstStressDateWithoutIrrigation: string | null; stressDaysWithoutIrrigation: number | null }[];
    stressTiming: { earliestFirstStressDate: string | null; latestFirstStressDate: string | null; allScenariosStressFreeInWindow: boolean; note: string } | null;
    limitations: string[];
  };
  unknowns: { field: string; status: 'unknown-not-estimated'; effect: string }[];
  assumptions: string[];
  connectedSystems: { id: string; role: string; status: 'used' | 'referenced' | 'unavailable' }[];
  nextActions: { id: string; label: string; endpoint: string; note: string }[];
  warnings: string[];
};

export async function buildFarmProfile(
  input: FarmProfileInput,
  options: { fetcher?: typeof fetch; cache?: ForecastCache; nowMs?: number; soilMoistureFetcher?: typeof fetch } = {},
): Promise<FarmProfile> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('input must be an object');
  const crop = typeof input.cropId === 'string' ? cropById.get(input.cropId) : undefined;
  if (!crop) fail(`cropId must be one of ${[...cropById.keys()].join(', ')}`);
  if (typeof input.plantingDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.plantingDate)) fail('plantingDate must be YYYY-MM-DD');
  const plantingEpoch = Date.parse(`${input.plantingDate}T00:00:00.000Z`);
  if (!Number.isFinite(plantingEpoch) || fmt(plantingEpoch) !== input.plantingDate) fail('plantingDate is not a valid calendar date');
  if (input.seedQuantityKg !== undefined) num(input.seedQuantityKg, 0.001, 1e7, 'seedQuantityKg');
  if (input.areaHa !== undefined) num(input.areaHa, 0.001, 100000, 'areaHa');
  if (input.applicationEfficiency !== undefined) num(input.applicationEfficiency, 0.05, 1, 'applicationEfficiency');
  if (input.rootDepthM !== undefined) num(input.rootDepthM, 0.05, 3, 'rootDepthM');
  if (input.depletionFraction !== undefined) num(input.depletionFraction, 0.05, 0.95, 'depletionFraction');

  // Representative point: explicit point wins; otherwise polygon centroid.
  let latitude: number, longitude: number, pointSource: 'user-point' | 'polygon-area-centroid';
  if (input.latitude !== undefined || input.longitude !== undefined) {
    latitude = num(input.latitude, -90, 90, 'latitude');
    longitude = num(input.longitude, -180, 180, 'longitude');
    pointSource = 'user-point';
  } else if (input.polygon) {
    const c = polygonCentroid(input.polygon);
    latitude = c.latitude; longitude = c.longitude;
    pointSource = 'polygon-area-centroid';
  } else fail('supply latitude/longitude or a polygon');

  // Area: polygon geodesic area wins; then user-supplied; else unknown.
  let areaHa: number | null, areaSource: FarmProfile['area']['source'];
  if (input.polygon) { areaHa = polygonAreaKm2(input.polygon) * 100; areaSource = 'polygon-geodesic'; }
  else if (input.areaHa !== undefined) { areaHa = input.areaHa; areaSource = 'user-supplied'; }
  else { areaHa = null; areaSource = 'unknown-point-only'; }
  if (areaHa !== null && !(areaHa > 0)) fail('farm area must be positive (degenerate polygon?)');

  const evidence = getFarmEvidence(latitude, longitude, input.polygon ? { polygon: input.polygon } : undefined);

  // ---- crop calendar + sensitivity (existing FAO references only) ----
  const lengths = crop.kcCurve.stageLengthsDays;
  const stageNames = ['initial', 'development', 'mid', 'late'] as const;
  const stageDays = [lengths.initial, lengths.development, lengths.mid, lengths.late];
  const seasonLengthDays = stageDays.reduce((a, b) => a + b, 0);
  let cursor = 0;
  const stageCalendar = stageNames.map((stage, i) => {
    const start = cursor; cursor += stageDays[i];
    return {
      stage, days: stageDays[i],
      startDate: fmt(plantingEpoch + start * DAY_MS), endDate: fmt(plantingEpoch + (cursor - 1) * DAY_MS),
      kcAtStart: kcForDay(crop.kcCurve, start), kcAtEnd: kcForDay(crop.kcCurve, cursor - 1),
    };
  });
  const ky = yieldByCropId.get(crop.id);
  const yieldSensitivity = ky ? {
    kySeasonal: ky.kySeasonal,
    band: (ky.kySeasonal >= 1.15 ? 'high' : ky.kySeasonal >= 1.0 ? 'moderate' : 'lower') as 'lower' | 'moderate' | 'high',
    source: ky.source,
    note: 'FAO-33 seasonal water-yield sensitivity (water only). This is not a yield prediction; tonnes/ha require a farmer-supplied potential-yield baseline (POST /api/irrigation/season).',
  } : null;

  // ---- seeding (arithmetic + general reference range only) ----
  const seedRef = SEEDING_REFERENCE_KG_PER_HA[crop.id];
  const quantityKg = input.seedQuantityKg ?? null;
  const seedingRate = quantityKg !== null && areaHa !== null ? quantityKg / areaHa : null;
  const seeding = {
    quantityKg, areaHa, seedingRateKgPerHa: seedingRate,
    referenceRangeKgPerHa: seedRef?.rangeKgPerHa ?? null,
    assessment: (quantityKg === null ? 'not-supplied'
      : areaHa === null ? 'area-unknown'
      : !seedRef?.rangeKgPerHa ? 'no-reference-range'
      : seedingRate! < seedRef.rangeKgPerHa[0] ? 'below-reference-range'
      : seedingRate! > seedRef.rangeKgPerHa[1] ? 'above-reference-range' : 'within-reference-range') as FarmProfile['planting']['seeding']['assessment'],
    note: quantityKg === null
      ? 'No seed quantity supplied; no seeding rate calculated.'
      : areaHa === null
        ? 'Seed quantity supplied but field area is unknown (point-only selection), so kg/ha cannot be calculated. Draw the field boundary or supply areaHa.'
        : `${seedRef?.note ?? ''} Reference ranges are general agronomic practice, not locally calibrated for Uzbekistan. Seed quantity never changes irrigation calculations.`.trim(),
    affectsIrrigationCalculations: false as const,
  };

  // ---- automatic soil for the existing recommendation engine ----
  const soilRef = CROP_SOIL_REFERENCE[crop.id];
  const supplied=input.retentionOverride;
  if(supplied){
    num(supplied.fieldCapacity,0.01,0.8,'fieldCapacity');num(supplied.wiltingPoint,0,0.79,'wiltingPoint');
    if(supplied.wiltingPoint>=supplied.fieldCapacity)fail('wiltingPoint must be lower than fieldCapacity');
    if(!['user-supplied-measurement','user-supplied-scenario'].includes(supplied.kind)||typeof supplied.source!=='string'||!supplied.source.trim()||supplied.source.length>300)fail('Retention override requires an evidence kind and source');
  }
  const retention = supplied ?? evidence.soil?.waterRetentionScenario ?? null;
  const rootDepthM = input.rootDepthM ?? soilRef.rootDepthUsedM;
  const depletionFraction = input.depletionFraction ?? soilRef.depletionFraction;
  const autoSoilForIrrigation = retention ? {
    fieldCapacity: retention.fieldCapacity, wiltingPoint: retention.wiltingPoint,
    rootDepthM, depletionFraction,
    kind: 'modeled-soil-plus-crop-reference' as const, measured: false as const,
    chain: `FC/WP from ${supplied?`${supplied.kind}: ${supplied.source}`:'Phase 2 SoilGrids texture via Saxton–Rawls (lib/soil-fertility.ts)'}; root depth ${input.rootDepthM !== undefined ? 'user override' : `FAO-56 Table 22 midpoint of ${soilRef.rootDepthRangeM[0]}-${soilRef.rootDepthRangeM[1]} m`}; depletion fraction p ${input.depletionFraction !== undefined ? 'user override' : 'FAO-56 Table 22'}. Modelled, not measured.`,
  } : null;

  // ---- irrigation via the EXISTING Feature 4 → Feature 1 engine ----
  let irrigation: RecommendationResult | null = null;
  let irrigationStatus: FarmProfile['irrigationStatus'] = 'calculated';
  // recommend() requires an area for volumes; when the farm area is
  // unknown we pass 1 ha internally and suppress every volume output
  // below — millimetre demand never depends on area.
  const recBase = {
    latitude, longitude, cropId: crop.id, plantingDate: input.plantingDate,
    areaHa: areaHa ?? 1,
    ...(autoSoilForIrrigation ? {
      soil: {
        fieldCapacity: autoSoilForIrrigation.fieldCapacity, wiltingPoint: autoSoilForIrrigation.wiltingPoint,
        rootDepthM, depletionFraction,
        ...(input.initialDepletionMm !== undefined ? { initialDepletionMm: num(input.initialDepletionMm, 0, 1000, 'initialDepletionMm') } : {}),
      },
    } : {}),
    ...(input.applicationEfficiency !== undefined ? { applicationEfficiency: input.applicationEfficiency } : {}),
    ...(input.supply ? { supply: input.supply } : {}),
  };
  try {
    irrigation = await recommend(recBase, options);
    if (areaHa === null && irrigation) {
      // Strip placeholder-area volumes: they would describe 1 ha, not this farm.
      if (irrigation.demand && typeof irrigation.demand.totalGrossDemandM3 === 'number') irrigation.demand.totalGrossDemandM3 = null;
      if (irrigation.outlook) irrigation.outlook.irrigationEvents = irrigation.outlook.irrigationEvents.map((e) => ({ ...e, grossDemandM3: null as unknown as number }));
      if (irrigation.schedule) irrigation.schedule = null;
    }
  } catch (error) {
    if (error instanceof ForecastUnavailableError) {
      irrigation = null; irrigationStatus = 'forecast-unavailable';
    } else throw error;
  }

  // ---- Phase 3: ERA5-Land modelled soil-moisture scenario ----
  const SOIL_MOISTURE_LIMITATIONS = [
    'ERA5-Land is a 0.1° (~9 km) land-model reanalysis cell, not this farm: within-cell variation (fields, canals, bare soil) is invisible to it.',
    'ERA5-Land has NO irrigation scheme: over irrigated land its moisture follows modelled rain only and can run dry-biased in the irrigation season, which would pull stress timing EARLIER than reality. Treat the central scenario as indicative and the range as the honest output.',
    'FC/WP come from the farm soil estimate while theta comes from ERA5-Land (different soil maps); the pairing is an assumption, and theta is clamped to the FC-WP range rather than recalibrated.',
    'This scenario never overrides a farmer-supplied initial depletion and is never a field measurement. A soil probe or gravimetric sample outranks it.',
  ];
  let soilMoisture: FarmProfile['soilMoisture'] = {
    status: 'unavailable-no-auto-soil', kind: 'modeled-soil-moisture-scenario-not-measurement',
    source: null, estimate: null, scenarios: [], stressTiming: null,
    limitations: SOIL_MOISTURE_LIMITATIONS,
  };
  if (autoSoilForIrrigation) {
    try {
      const sm = await fetchEra5LandSoilMoisture(latitude, longitude, { fetcher: options.soilMoistureFetcher, nowMs: options.nowMs });
      const estimate = estimateInitialDepletion({
        layers: era5LayersForEstimate(sm),
        fieldCapacity: autoSoilForIrrigation.fieldCapacity, wiltingPoint: autoSoilForIrrigation.wiltingPoint,
        rootDepthM,
      });
      const scenarios: FarmProfile['soilMoisture']['scenarios'] = [];
      if (irrigation) {
        const soilBase = (recBase as { soil: Record<string, number> }).soil;
        for (const [id, mm] of [['wetter', estimate.depletionMm.low], ['central', estimate.depletionMm.central], ['drier', estimate.depletionMm.high]] as const) {
          const r = await recommend({ ...recBase, soil: { ...soilBase, initialDepletionMm: mm } }, options);
          scenarios.push({
            id, initialDepletionMm: mm, calculationTier: r.calculationTier,
            firstStressDateWithoutIrrigation: r.outlook?.firstStressDateWithoutIrrigation ?? null,
            stressDaysWithoutIrrigation: r.outlook?.stressDaysWithoutIrrigation ?? null,
          });
        }
      }
      const stressDates = scenarios.map((s) => s.firstStressDateWithoutIrrigation).filter((d): d is string => d !== null).sort();
      soilMoisture = {
        status: scenarios.length ? 'scenario-available' : 'depletion-estimate-only',
        kind: 'modeled-soil-moisture-scenario-not-measurement',
        source: sm, estimate, scenarios,
        stressTiming: scenarios.length ? {
          earliestFirstStressDate: stressDates[0] ?? null,
          latestFirstStressDate: stressDates[stressDates.length - 1] ?? null,
          allScenariosStressFreeInWindow: stressDates.length === 0,
          note: stressDates.length
            ? 'Range of first-stress dates across the wetter/central/drier depletion scenarios (existing FAO-56 engine, no irrigation). A spread here is the uncertainty made visible — plan against the earlier date if water must be booked ahead.'
            : 'No scenario reaches stress inside the 7-day forecast window; that is a statement about this window only, not the season.',
        } : null,
        limitations: SOIL_MOISTURE_LIMITATIONS,
      };
    } catch {
      soilMoisture = {
        status: 'unavailable-source-failure', kind: 'modeled-soil-moisture-scenario-not-measurement',
        source: null, estimate: null, scenarios: [], stressTiming: null,
        limitations: [...SOIL_MOISTURE_LIMITATIONS, 'The ERA5-Land source could not be retrieved for this location, so no soil-moisture scenario was produced. Nothing was substituted.'],
      };
    }
  }

  // ---- water impact in farmer units (unit conversion of engine output) ----
  const demandTotals = (irrigation?.demand ?? {}) as Record<string, unknown>;
  const asNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const etCropMm = asNum(demandTotals.totalEtCropMm)
    ?? (irrigation ? irrigation.forecastDays.reduce((a, d) => a + d.et0Mm * d.kc, 0) : null);
  const forecastRainMm = irrigation ? irrigation.forecastDays.reduce((a, d) => a + d.rainMm, 0) : null;
  const netDemandMm = asNum(demandTotals.totalDeficitMm) ?? asNum(demandTotals.totalNetIrrigationMm);
  const netDemandM3PerHa = netDemandMm !== null ? netDemandMm * 10 : null; // 1 mm over 1 ha = 10 m3
  const waterImpact: FarmProfile['waterImpact'] = {
    windowDays: irrigation?.forecastDays.length ?? 0,
    etCropMm, forecastRainMm, netDemandMm, netDemandM3PerHa,
    farmNetDemandM3: netDemandM3PerHa !== null && areaHa !== null ? netDemandM3PerHa * areaHa : null,
    // Already a farm total from the engine when an efficiency and area
    // were supplied; null otherwise (withheld, never rescaled silently).
    farmGrossDemandM3: asNum(demandTotals.totalGrossDemandM3),
    basis: 'Derived only from the existing Feature 4/Feature 1 demand totals; mm-to-m3 is a unit conversion (1 mm/ha = 10 m3). No water-saving claim: no measured baseline of current farm practice exists.',
  };

  // ---- deterministic advisories tied to the computed numbers ----
  const advisories: FarmProfile['advisories'] = [];
  if (forecastRainMm !== null && forecastRainMm >= 10) {
    advisories.push({ id: 'advisory.rain-in-forecast-delay-irrigation-check', basis: `${forecastRainMm.toFixed(1)} mm of rain is forecast in the next ${waterImpact.windowDays} days; check soil storage and the engine deadlines before irrigating so forecast rain is not wasted.` });
  }
  if (etCropMm !== null && waterImpact.windowDays > 0 && etCropMm / waterImpact.windowDays >= 5) {
    advisories.push({ id: 'advisory.peak-demand-period', basis: `Mean crop demand is ${(etCropMm / waterImpact.windowDays).toFixed(1)} mm/day over the forecast window; depletion moves fastest now, so monitoring matters most in this window.` });
  }
  let currentStage: FarmProfile['planting']['stageCalendar'][number] | undefined;
  if (irrigation?.kcStartDayIndex !== undefined) {
    let acc = 0;
    for (const s of stageCalendar) {
      acc += s.days;
      if (irrigation.kcStartDayIndex < acc) { currentStage = s; break; }
    }
    currentStage ??= stageCalendar[stageCalendar.length - 1];
  }
  if (irrigation?.kcStartDayIndex !== undefined && irrigation.kcStartDayIndex >= seasonLengthDays) {
    advisories.push({ id: 'advisory.planting-date-season-already-completed', basis: `The planting date (${input.plantingDate}) plus the ${seasonLengthDays}-day FAO stage calendar ends before the forecast window begins, so demand is shown at end-of-season Kc. Check the planting date — for most crops this means the date belongs to a previous season.` });
  }
  if (currentStage?.stage === 'mid' && (yieldSensitivity?.kySeasonal ?? 0) >= 1.0) {
    advisories.push({ id: 'advisory.mid-season-water-priority', basis: `The crop is in its mid-season stage and its FAO-33 Ky is ${yieldSensitivity!.kySeasonal} (water-sensitive period); if supply must be rationed, this stage is where shortage costs the most relative yield (water-only relationship).` });
  }
  const polygonSample = evidence.soil?.farmEstimate?.basis === 'soilgrids-grid-polygon' ? evidence.soil.farmEstimate.sample : null;
  if (polygonSample && polygonSample.coverageRatio < 0.8) {
    advisories.push({ id: 'advisory.soil-estimate-partial-coverage', basis: `Only ${(polygonSample.coverageRatio * 100).toFixed(0)}% of the drawn farm overlaps valid SoilGrids cells; treat the soil estimate as partial and consider a laboratory soil test before acting on it.` });
  }
  advisories.push({ id: 'advisory.groundwater-and-supply-unverified', basis: 'ARIQ has not verified groundwater at this farm or any right/capacity to withdraw from nearby mapped water; confirm the actual water source before planning deliveries.' });

  const unknowns: FarmProfile['unknowns'] = [
    { field: 'groundwater.depthToWaterM', status: 'unknown-not-estimated', effect: 'No farm groundwater measurement exists; depth stays null. Use POST /api/groundwater only with a user/agency-supplied depth.' },
    { field: 'soil.initialDepletionMm', status: 'unknown-not-estimated', effect: input.initialDepletionMm === undefined ? 'Current soil-water depletion is not measured. The ERA5-Land scenario (soilMoisture section) estimates a labelled range with stress-timing scenarios, but the true current depletion remains unknown and a probe/sample outranks the scenario.' : input.initialDepletionSource === 'terraPulse-modelled-scenario' ? 'This run used the automatically populated TerraPulse value: an ERA5-Land modelled scenario estimate, NOT measured soil moisture and not farmer-confirmed. A probe or gravimetric sample outranks it.' : 'Caller supplied an assumed initial depletion for this simulation; it is not a measurement.' },
    { field: 'water.supplyAndConnectivity', status: 'unknown-not-estimated', effect: 'Nearest mapped water features are geographic proximity only — not verified hydraulic connectivity, capacity, or a right to water. No delivery schedule is generated without farmer-supplied supply.' },
    { field: 'soil.labTest', status: 'unknown-not-estimated', effect: 'No laboratory soil test is on file; all soil values are SoilGrids modelled estimates. Khorezm lab validation found material regional bias (see evidence.soil.validationContext).' },
    ...(areaHa === null ? [{ field: 'farm.areaHa', status: 'unknown-not-estimated' as const, effect: 'Point-only selection: cubic-metre volumes and seeding rate cannot be calculated until a polygon or areaHa is supplied. Millimetre demand is unaffected.' }] : []),
  ];
  const assumptions = [
    supplied ? `FC/WP override: ${supplied.kind}, source: ${supplied.source}. Other mapped soil properties remain modelled.` : 'Soil texture/FC/WP are SoilGrids modelled estimates (Phase 2 grid or regional fallback), not field measurements.',
    `Crop rooting depth (${rootDepthM} m) and depletion fraction (${depletionFraction}) are ${input.rootDepthM !== undefined || input.depletionFraction !== undefined ? 'caller overrides / ' : ''}FAO-56 Table 22 references; maximum rooting depth is used for the whole season (existing-engine simplification).`,
    'Weather is the Open-Meteo forecast (provider FAO-56 ET0); beyond the horizon, historical-analog season simulation is available at POST /api/irrigation/season.',
       ...(input.initialDepletionSource === 'terraPulse-modelled-scenario' ? ['Starting depletion for this run came from the TerraPulse ERA5-Land modelled scenario (automatically populated, not measured soil moisture and not farmer-confirmed).'] : []),
    ...(input.supply ? [] : ['No irrigation supply was supplied, so no feasible delivery schedule is claimed.']),
    ...(input.applicationEfficiency !== undefined ? [] : ['No application efficiency was supplied, so gross volumes are limited by the existing engine rules.']),
  ];

  return {
    kind: 'unified-farm-profile', version: 1,
    location: { latitude, longitude, representativePointSource: pointSource, region: evidence.location.region },
    area: {
      areaHa, source: areaSource,
      note: areaSource === 'polygon-geodesic' ? 'Geodesic area of the user-drawn planning boundary; NOT an officially surveyed cadastral parcel.'
        : areaSource === 'user-supplied' ? 'Area supplied by the farmer.'
        : 'Area unknown for a point-only selection; volumes and seeding rate are withheld rather than invented.',
    },
    evidence,
    crop: {
      id: crop.id, nameEn: crop.nameEn, kcCurve: crop.kcCurve, kcSource: crop.source,
      soilReference: {
        ...soilRef,
        rootDepthSource: input.rootDepthM !== undefined ? 'user-override' : 'fao56-table22-midpoint',
        depletionFractionSource: input.depletionFraction !== undefined ? 'user-override' : 'fao56-table22',
      },
      yieldSensitivity,
    },
    planting: {
      plantingDate: input.plantingDate, seasonLengthDays,
      expectedMaturityDate: fmt(plantingEpoch + (seasonLengthDays - 1) * DAY_MS),
      stageCalendar, seeding,
    },
    autoSoilForIrrigation,
    suppliedInputs: input, irrigation, irrigationStatus, waterImpact, advisories, soilMoisture,
    unknowns, assumptions,
    connectedSystems: [
      { id: 'phase1-2-farm-evidence', role: 'SoilGrids soil + Saxton–Rawls, water proximity, ERA5 climate, SIAT context, groundwater null', status: 'used' },
      { id: 'feature1-scheduler', role: 'Soil-water balance, stress, deadlines, allocation (via Feature 4)', status: irrigation ? 'used' : 'unavailable' },
      { id: 'feature4-recommendation', role: 'Open-Meteo FAO-56 ET0 forecast demand for this location/crop', status: irrigation ? 'used' : 'unavailable' },
      { id: 'phase3-era5land-soil-moisture', role: 'Modelled initial-depletion scenario (ERA5-Land via Open-Meteo) with wetter/central/drier stress timing through the same engine', status: soilMoisture.status === 'scenario-available' || soilMoisture.status === 'depletion-estimate-only' ? 'used' : 'unavailable' },
      { id: 'feature5-season-references', role: 'FAO-56 stage calendar + FAO-33 Ky sensitivity; full analog-ensemble simulation at POST /api/irrigation/season', status: 'referenced' },
      { id: 'feature2-3-water-data', role: 'Documented rivers/canals/reservoirs proximity (not connectivity)', status: 'used' },
      { id: 'groundwater-scenario', role: 'POST /api/groundwater with a user-supplied depth only', status: 'referenced' },
      { id: 'soil-fertility-lab', role: 'POST /api/soil-fertility with a laboratory soil test when available', status: 'referenced' },
    ],
    nextActions: [
      { id: 'season-simulation', label: 'Run full-season historical-analog simulation', endpoint: 'POST /api/irrigation/season', note: 'Uses ERA5 analog years; labelled scenarios, not forecasts. Supply this profile\'s soil instead of the illustrative preset for field-specific modelling.' },
      { id: 'supply-schedule', label: 'Add canal capacity and available water', endpoint: 'POST /api/irrigation/recommendation', note: 'Only farmer-supplied supply unlocks a feasible delivery schedule from the Feature 1 scheduler.' },
      { id: 'soil-lab-test', label: 'Replace modelled soil with a laboratory test', endpoint: 'POST /api/soil-fertility', note: 'A lab result outranks SoilGrids in the ARIQ soil hierarchy.' },
      { id: 'groundwater-scenario', label: 'Explore a groundwater scenario', endpoint: 'POST /api/groundwater', note: 'Requires a user/agency-supplied depth; ARIQ does not estimate depth.' },
    ],
    warnings: [...new Set([...evidence.warnings, ...(irrigation?.warnings ?? []),
      ...(irrigationStatus === 'forecast-unavailable' ? ['warning.forecast-unavailable-no-weather-invented'] : [])])],
  };
}
