/**
 * Deterministic ARIQ tools for the AI Water Copilot (Feature 6).
 * Every tool wraps an existing engine (Features 2-5); the model can only
 * choose among these, with backend-validated arguments. No tool invents
 * measurements, and proximity results always carry the non-connectivity
 * label. All numeric output stays canonical SI.
 */
import { HttpError } from '../irrigation/http.ts';
import { nearestFeatures, searchFeatures, searchSeries } from '../data-foundation.ts';
import { recommend, type RecommendationInput } from '../irrigation/recommendation.ts';
import { compareScenarios, simulateEnsemble, soilPresetById, type SeasonInput } from '../irrigation/season.ts';
import { fetchAnalogYears } from '../irrigation/season-weather.ts';
import { CROPS } from '../irrigation/recommendation.ts';

export const TOOL_NAMES = ['search_water_sources', 'nearby_water_sources', 'regional_water_history', 'irrigation_recommendation', 'season_simulation', 'compare_drought_strategies'] as const;
export type ToolName = typeof TOOL_NAMES[number];
export type ToolDeps = {
  weatherFetcher?: typeof fetch;
  analogFetcher?: (lat: number, lon: number, plantingDate: string, seasonDays: number, years: number[]) => Promise<{ year: number; weather: SeasonInput['weather']; sourceUrl: string }[]>;
};
const UZ = { minLat: 37.0, maxLat: 45.7, minLon: 55.9, maxLon: 73.3 };
function bad(message: string): never { throw new HttpError(400, message); }
function obj(v: unknown, label: string): Record<string, unknown> { if (v === null || typeof v !== 'object' || Array.isArray(v)) bad(`${label} must be an object`); return v as Record<string, unknown>; }
function num(v: unknown, lo: number, hi: number, label: string): number { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) bad(`${label} must be a finite number in [${lo}, ${hi}]`); return n; }
function coords(a: Record<string, unknown>): { latitude: number; longitude: number } {
  const latitude = num(a.latitude ?? a.lat, -90, 90, 'latitude'), longitude = num(a.longitude ?? a.lon ?? a.lng, -180, 180, 'longitude');
  if (latitude < UZ.minLat || latitude > UZ.maxLat || longitude < UZ.minLon || longitude > UZ.maxLon) bad('coordinates are outside Uzbekistan');
  return { latitude, longitude };
}
function seasonDaysFor(cropId: string): number { const c = CROPS.find(x => x.id === cropId); if (!c) bad(`unknown cropId ${cropId}`); const s = c.kcCurve.stageLengthsDays; return s.initial + s.development + s.mid + s.late; }
async function seasonBase(raw: Record<string, unknown>, deps: ToolDeps): Promise<{ base: Omit<SeasonInput, 'weather' | 'analogYear'>; analogs: { year: number; weather: SeasonInput['weather'] }[]; seasonInputFor: (year: { year: number; weather: SeasonInput['weather'] }) => SeasonInput }> {
  const { latitude, longitude } = coords(raw);
  const cropId = typeof raw.cropId === 'string' ? raw.cropId : bad('cropId is required');
  const plantingDate = typeof raw.plantingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.plantingDate) ? raw.plantingDate : bad('plantingDate must be YYYY-MM-DD');
  const years = raw.analogYears === undefined ? [2020, 2021, 2022] : raw.analogYears;
  if (!Array.isArray(years) || years.length < 2 || years.length > 5 || years.some(y => !Number.isInteger(y) || (y as number) < 1940 || (y as number) > 2100)) bad('analogYears must be 2..5 integer years');
  const fetcher = deps.analogFetcher ?? (async (la: number, lo: number, pd: string, days: number, ys: number[]) => fetchAnalogYears(la, lo, pd, days, ys));
  const analogs = await fetcher(latitude, longitude, plantingDate, seasonDaysFor(cropId), years as number[]);
  const soilRaw = raw.soil as SeasonInput['soil'] | undefined;
  const preset = soilPresetById.get('soil.loam-reference')!;
  const base: Omit<SeasonInput, 'weather' | 'analogYear'> = {
    cropId, areaHa: raw.areaHa === undefined ? 1 : num(raw.areaHa, 0.001, 100000, 'areaHa'),
    applicationEfficiency: raw.applicationEfficiency === undefined ? 0.65 : num(raw.applicationEfficiency, 0.05, 1, 'applicationEfficiency'),
    soil: soilRaw ?? preset, soilKind: soilRaw ? 'user-supplied' : 'illustrative-reference', weatherKind: 'historical-analog',
    ...(raw.seasonSupplyM3 === undefined ? {} : { strategy: { seasonSupplyM3: num(raw.seasonSupplyM3, 0, 1e12, 'seasonSupplyM3'), ...(raw.minIntervalDays === undefined ? {} : { minIntervalDays: num(raw.minIntervalDays, 0, 120, 'minIntervalDays') }) } }),
  };
  return { base, analogs, seasonInputFor: (y) => ({ ...base, weather: y.weather, analogYear: y.year }) };
}

export async function executeTool(name: ToolName, args: unknown, deps: ToolDeps = {}): Promise<unknown> {
  const a = obj(args ?? {}, 'tool arguments');
  switch (name) {
    case 'search_water_sources': {
      const limit = a.limit === undefined ? 10 : num(a.limit, 1, 20, 'limit');
      const { total, results } = searchFeatures({ q: typeof a.q === 'string' ? a.q.slice(0, 100) : undefined, kind: typeof a.kind === 'string' ? a.kind : undefined, region: typeof a.region === 'string' ? a.region : undefined, basin: typeof a.basin === 'string' ? a.basin : undefined, limit });
      return { kind: 'reported', total, results: results.map(f => ({ id: f.id, kind: f.kind, name: f.nameEn ?? f.nameSource, region: f.region, basin: f.basin, geometry: f.geometry, connectivityStatus: f.connectivity.status })) };
    }
    case 'nearby_water_sources': {
      const { latitude, longitude } = coords(a);
      const k = a.k === undefined ? 5 : num(a.k, 1, 10, 'k');
      return { kind: 'reported', note: 'Geographic proximity only; this does not prove water access or hydraulic connectivity.', results: nearestFeatures(latitude, longitude, k).map(r => ({ id: r.feature.id, kind: r.feature.kind, name: r.feature.nameEn ?? r.feature.nameSource, distanceKm: r.distanceKm, coordinates: r.feature.geometry?.type === 'Point' ? r.feature.geometry.coordinates : null })) };
    }
    case 'regional_water_history': {
      if (typeof a.region !== 'string' || !a.region) bad('region is required');
      const series = searchSeries({ region: a.region });
      return { kind: 'modeled-and-reported', region: a.region, series: series.map(s => ({ id: s.id, indicator: s.indicator, unit: s.unit, measurementKind: s.measurementKind, recentValues: s.values.slice(-12) })) };
    }
    case 'irrigation_recommendation': {
      const input: Record<string, unknown> = { ...a };
      return recommend(input as RecommendationInput, { fetcher: deps.weatherFetcher });
    }
    case 'season_simulation': {
      const { base, analogs, seasonInputFor } = await seasonBase(a, deps);
      const ensemble = simulateEnsemble(base, analogs);
      const sorted = [...ensemble.years].sort((x, y) => x.result.yieldImpact.relativeYieldRetained - y.result.yieldImpact.relativeYieldRetained);
      const median = sorted[Math.floor(sorted.length / 2)];
      return { kind: 'simulated', summary: ensemble.summary, years: ensemble.years.map(y => ({ year: y.year, totals: y.result.totals, yieldImpact: y.result.yieldImpact, stages: y.result.stages })), medianAnalogYear: median.year, daily: median.result.daily, warnings: median.result.warnings,
        assumptions: [...(a.areaHa === undefined ? ['areaHa defaulted to 1 ha: cubic-metre totals describe a 1-hectare field, not a specific farm.'] : []), ...(a.applicationEfficiency === undefined ? ['applicationEfficiency defaulted to 0.65 for this scenario.'] : []), ...((a as Record<string, unknown>).soil === undefined ? ['Illustrative loam reference soil used; it does not describe a real field.'] : [])] };
    }
    case 'compare_drought_strategies': {
      const rainFactor = a.rainFactor === undefined ? 0.7 : num(a.rainFactor, 0, 1, 'rainFactor');
      const { base, analogs, seasonInputFor } = await seasonBase(a, deps);
      const sorted = [...analogs].sort((x, y) => x.year - y.year);
      const chosen = sorted[Math.floor(sorted.length / 2)];
      const baselineInput = seasonInputFor(chosen);
      const droughtInput: SeasonInput = { ...baselineInput, perturbation: { rainFactor } };
      const improvedEfficiency: SeasonInput = { ...droughtInput, applicationEfficiency: Math.min(1, baselineInput.applicationEfficiency + 0.15) };
      const relaxedFrequency: SeasonInput = { ...droughtInput, strategy: { ...droughtInput.strategy, minIntervalDays: 0 } };
      const drought = compareScenarios(baselineInput, droughtInput);
      const eff = compareScenarios(droughtInput, improvedEfficiency);
      const freq = compareScenarios(droughtInput, relaxedFrequency);
      const summarize = (c: ReturnType<typeof compareScenarios>) => ({ deltas: c.deltas, baselineYieldRetained: c.baseline.yieldImpact.relativeYieldRetained, modifiedYieldRetained: c.modified.yieldImpact.relativeYieldRetained, baselineIrrigationGrossM3: c.baseline.totals.irrigationGrossM3, modifiedIrrigationGrossM3: c.modified.totals.irrigationGrossM3 });
      return { kind: 'simulated', analogYear: chosen.year, rainFactor, droughtVsBaseline: summarize(drought), alternatives: { improvedEfficiencyPlus15pts: summarize(eff), irrigationFrequencyRelaxed: summarize(freq) }, note: 'Alternatives are engine-evaluated scenarios on the same analog year, not field recommendations or measured savings.' };
    }
    default: return bad(`unknown tool ${String(name)}`);
  }
}

const COORDS = { latitude: { type: 'number', description: 'Latitude inside Uzbekistan (37..45.7)' }, longitude: { type: 'number', description: 'Longitude inside Uzbekistan (55.9..73.3)' } };
const FARM = { ...COORDS, cropId: { type: 'string', enum: CROPS.map(c => c.id) }, areaHa: { type: 'number' }, plantingDate: { type: 'string', description: 'YYYY-MM-DD' } };
const SCHEMAS: Record<ToolName, { description: string; properties: Record<string, unknown>; required: string[] }> = {
  search_water_sources: { description: 'Search verified Uzbekistan water features (rivers, canals, reservoirs) in the ARIQ database. Returns reported records with coordinates where verified.', properties: { q: { type: 'string' }, kind: { type: 'string' }, region: { type: 'string' }, basin: { type: 'string' }, limit: { type: 'number' } }, required: [] },
  nearby_water_sources: { description: 'Find nearest mapped water features to the given coordinates. Proximity only; never proof of water access. Always pass latitude and longitude from the farm context.', properties: { ...COORDS, k: { type: 'number' } }, required: ['latitude', 'longitude'] },
  regional_water_history: { description: 'Regional historical water/climate series (ERA5 modeled reanalysis and reported statistics) by region name.', properties: { region: { type: 'string' } }, required: ['region'] },
  irrigation_recommendation: { description: 'Run the FAO-56 location irrigation recommendation (forecast weather) for a farm. Soil/supply optional; missing inputs are reported. Always pass latitude, longitude, cropId, areaHa, plantingDate and applicationEfficiency.', properties: { ...FARM, applicationEfficiency: { type: 'number' } }, required: ['latitude', 'longitude', 'cropId', 'areaHa', 'plantingDate', 'applicationEfficiency'] },
  season_simulation: { description: 'Run the full-season crop simulation with historical analog years and FAO-33 relative yield impact. Always pass latitude, longitude, cropId, areaHa and plantingDate.', properties: { ...FARM, analogYears: { type: 'array', items: { type: 'number' } }, seasonSupplyM3: { type: 'number' } }, required: ['latitude', 'longitude', 'cropId', 'plantingDate'] },
  compare_drought_strategies: { description: 'Compare baseline vs reduced-rainfall season outcomes and evaluate efficiency/frequency alternatives on the same analog year. Always pass latitude, longitude, cropId, areaHa, plantingDate and rainFactor (for example 0.7).', properties: { ...FARM, rainFactor: { type: 'number' }, seasonSupplyM3: { type: 'number' } }, required: ['latitude', 'longitude', 'cropId', 'plantingDate', 'rainFactor'] },
};
export const TOOL_DEFINITIONS = TOOL_NAMES.map(name => ({
  type: 'function', name, strict: false, description: SCHEMAS[name].description,
  parameters: { type: 'object', additionalProperties: true, properties: SCHEMAS[name].properties, required: SCHEMAS[name].required },
}));
