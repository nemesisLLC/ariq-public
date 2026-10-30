/**
 * Frontend action contract for the AI Water Copilot (Feature 6).
 * Actions are built by the backend from real tool outputs (never invented
 * by the model) and validated before returning. Codex renders these on
 * the future 3D map; coordinates are [longitude, latitude] inside
 * Uzbekistan, and every referenced id must come from a tool result.
 */
import { HttpError } from '../irrigation/http.ts';

export type FrontendAction =
  | { type: 'flyToLocation'; latitude: number; longitude: number; zoom?: number }
  | { type: 'highlightWaterSources'; features: { id: string; coordinates: [number, number] }[] }
  | { type: 'displayForecast'; days: { date: string; et0Mm: number; rainMm: number }[] }
  | { type: 'displayIrrigationSchedule'; events: unknown[]; deliveries: unknown[] }
  | { type: 'showScenarioComparison'; comparison: unknown }
  | { type: 'animateSeasonTimeline'; daily: unknown[]; stages: unknown[] }
  | { type: 'displayYieldImpact'; yieldImpact: unknown }
  | { type: 'showSourceEvidence'; sources: { sourceId: string; url?: string }[] };

export const ACTION_TYPES = ['flyToLocation', 'highlightWaterSources', 'displayForecast', 'displayIrrigationSchedule', 'showScenarioComparison', 'animateSeasonTimeline', 'displayYieldImpact', 'showSourceEvidence'] as const;
const UZ = { minLat: 37.0, maxLat: 45.7, minLon: 55.9, maxLon: 73.3 };
function bad(m: string): never { throw new HttpError(502, `Invalid frontend action: ${m}`); }
export function validateFrontendAction(action: FrontendAction): FrontendAction {
  if (!action || typeof action !== 'object' || !ACTION_TYPES.includes(action.type as never)) bad(`unknown type ${String((action as { type?: unknown })?.type)}`);
  switch (action.type) {
    case 'flyToLocation':
      if (!(action.latitude >= UZ.minLat && action.latitude <= UZ.maxLat && action.longitude >= UZ.minLon && action.longitude <= UZ.maxLon)) bad('flyToLocation outside Uzbekistan');
      break;
    case 'highlightWaterSources':
      if (!Array.isArray(action.features) || action.features.length === 0 || action.features.length > 50) bad('highlightWaterSources requires 1..50 features');
      for (const f of action.features) {
        if (typeof f.id !== 'string' || !Array.isArray(f.coordinates) || f.coordinates.length !== 2) bad('feature requires id and [lon, lat]');
        const [lon, lat] = f.coordinates;
        if (!(lon >= UZ.minLon && lon <= UZ.maxLon && lat >= UZ.minLat && lat <= UZ.maxLat)) bad(`feature ${f.id} coordinates outside Uzbekistan`);
      }
      break;
    case 'displayForecast': if (!Array.isArray(action.days) || action.days.length === 0) bad('displayForecast requires days'); break;
    case 'displayIrrigationSchedule': if (!Array.isArray(action.events)) bad('displayIrrigationSchedule requires events'); break;
    case 'showScenarioComparison': if (!action.comparison || typeof action.comparison !== 'object') bad('showScenarioComparison requires comparison'); break;
    case 'animateSeasonTimeline': if (!Array.isArray(action.daily) || action.daily.length === 0) bad('animateSeasonTimeline requires daily series'); break;
    case 'displayYieldImpact': if (!action.yieldImpact || typeof action.yieldImpact !== 'object') bad('displayYieldImpact requires yieldImpact'); break;
    case 'showSourceEvidence': if (!Array.isArray(action.sources) || action.sources.length === 0) bad('showSourceEvidence requires sources'); break;
  }
  return action;
}
export function validateActions(actions: FrontendAction[]): FrontendAction[] { return actions.map(validateFrontendAction); }
