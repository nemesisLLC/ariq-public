/**
 * Reproducible demo scenarios (Feature 5). Synthetic-but-labelled weather
 * fixtures shaped like ERA5 daily series (ET0/rain patterns stated in each
 * assumption list). They demonstrate the engine in three regions; they are
 * NOT measured seasons and must not be quoted as regional statistics.
 */
import type { SeasonInput, SeasonWeatherDay } from './season.ts';

function fixture(days: number, startDate: string, et0: number, rainEvery: number, rainMm: number, hotSpell?: { from: number; to: number; et0: number }): SeasonWeatherDay[] {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  return Array.from({ length: days }, (_, i) => {
    const et0Mm = hotSpell && i >= hotSpell.from && i <= hotSpell.to ? hotSpell.et0 : et0 + Math.sin(i / 9) * 0.7;
    return { date: new Date(start + i * 86400000).toISOString().slice(0, 10), et0Mm: Math.round(et0Mm * 100) / 100, rainMm: i % rainEvery === rainEvery - 1 ? rainMm : 0 };
  });
}
const loam = { fieldCapacity: 0.28, wiltingPoint: 0.13, rootDepthM: 0.8, depletionFraction: 0.5, targetDepletionFraction: 0.2, initialDepletionMm: 40 };
export const DEMO_SCENARIOS: { id: string; regionId: string; location: { latitude: number; longitude: number }; assumptions: string[]; baseline: SeasonInput; modified: SeasonInput }[] = [
  {
    id: 'demo.samarkand-cotton-drought', regionId: 'region.samarqand',
    location: { latitude: 39.65, longitude: 66.96 },
    assumptions: ['Synthetic ERA5-like fixture: ET0 ~6.2 mm/day, 12 mm rain every 14 days, labelled illustrative.', 'Illustrative loam soil; not a Samarkand field measurement.', 'Modified scenario: rain x0.7 and season supply -40%, matching the Feature 5 example.'],
    baseline: { cropId: 'cotton', areaHa: 5, applicationEfficiency: 0.7, soil: { ...loam }, soilKind: 'illustrative-reference', weather: fixture(180, '2026-04-15', 6.2, 14, 12), weatherKind: 'historical-analog', analogYear: 2021, strategy: { seasonSupplyM3: 40000 } },
    modified: { cropId: 'cotton', areaHa: 5, applicationEfficiency: 0.7, soil: { ...loam }, soilKind: 'illustrative-reference', weather: fixture(180, '2026-04-15', 6.2, 14, 12), weatherKind: 'historical-analog', analogYear: 2021, strategy: { seasonSupplyM3: 24000 }, perturbation: { rainFactor: 0.7 } },
  },
  {
    id: 'demo.karakalpakstan-maize-supply-cut', regionId: 'region.karakalpakstan',
    location: { latitude: 42.47, longitude: 59.61 },
    assumptions: ['Synthetic arid fixture: ET0 ~7.0 mm/day, 6 mm rain every 21 days, with a 10-day hot spell at ET0 8.5.', 'Illustrative loam soil; Nukus-area location used only as a geographic identifier.', 'Modified scenario: season supply -40% and irrigation at most every 14 days.'],
    baseline: { cropId: 'maize', areaHa: 3, applicationEfficiency: 0.75, soil: { ...loam }, soilKind: 'illustrative-reference', weather: fixture(180, '2026-05-01', 7.0, 21, 6, { from: 60, to: 69, et0: 8.5 }), weatherKind: 'historical-analog', analogYear: 2022, strategy: { seasonSupplyM3: 30000 } },
    modified: { cropId: 'maize', areaHa: 3, applicationEfficiency: 0.75, soil: { ...loam }, soilKind: 'illustrative-reference', weather: fixture(180, '2026-05-01', 7.0, 21, 6, { from: 60, to: 69, et0: 8.5 }), weatherKind: 'historical-analog', analogYear: 2022, strategy: { seasonSupplyM3: 18000, minIntervalDays: 14 } },
  },
  {
    id: 'demo.fergana-wheat-rainfall', regionId: 'region.fergana',
    location: { latitude: 40.39, longitude: 71.78 },
    assumptions: ['Synthetic fixture: ET0 ~4.6 mm/day, 10 mm rain every 10 days (wetter valley pattern, illustrative).', 'Illustrative loam soil; winter-wheat stage timing is approximate (FAO-56 note).', 'Modified scenario: rain x1.2 and planting unchanged; shows rainfall credit on irrigation demand.'],
    baseline: { cropId: 'winter-wheat', areaHa: 4, applicationEfficiency: 0.7, soil: { ...loam }, soilKind: 'illustrative-reference', weather: fixture(180, '2026-10-15', 4.6, 10, 10), weatherKind: 'historical-analog', analogYear: 2020, strategy: { seasonSupplyM3: 25000 } },
    modified: { cropId: 'winter-wheat', areaHa: 4, applicationEfficiency: 0.7, soil: { ...loam }, soilKind: 'illustrative-reference', weather: fixture(180, '2026-10-15', 4.6, 10, 10), weatherKind: 'historical-analog', analogYear: 2020, strategy: { seasonSupplyM3: 25000 }, perturbation: { rainFactor: 1.2 } },
  },
];
