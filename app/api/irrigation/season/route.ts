import {compareScenarios, sensitivityAnalysis, simulateEnsemble, soilPresetById, type SeasonInput} from '../../../../lib/irrigation/season.ts';
import {fetchAnalogYears} from '../../../../lib/irrigation/season-weather.ts';
import {cropById} from '../../../../lib/irrigation/recommendation.ts';
import {readJson,json,fail,HttpError} from '../../../../lib/irrigation/http.ts';

const UZ = { minLat: 37.0, maxLat: 45.7, minLon: 55.9, maxLon: 73.3 };
export async function POST(request: Request) {
  try {
    const body = await readJson(request, 32768) as Record<string, unknown>;
    const latitude = body.latitude, longitude = body.longitude;
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || latitude < UZ.minLat || latitude > UZ.maxLat || longitude < UZ.minLon || longitude > UZ.maxLon) throw new HttpError(400, 'Coordinates must be inside Uzbekistan.');
    const crop = typeof body.cropId === 'string' ? cropById.get(body.cropId) : undefined;
    if (!crop) throw new HttpError(400, 'Unknown cropId. Supply a supported crop or use the recommendation endpoint with a custom Kc.');
    if (typeof body.plantingDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.plantingDate)) throw new HttpError(400, 'plantingDate must be YYYY-MM-DD.');
    const seasonDays = crop.kcCurve.stageLengthsDays.initial + crop.kcCurve.stageLengthsDays.development + crop.kcCurve.stageLengthsDays.mid + crop.kcCurve.stageLengthsDays.late;
    const years = Array.isArray(body.analogYears) && body.analogYears.length >= 2 ? body.analogYears as number[] : [2019, 2020, 2021, 2022, 2023];
    if (years.length > 10 || years.some(y => !Number.isInteger(y))) throw new HttpError(400, 'analogYears must be 2..10 integer years.');
    let analogs;
    try { analogs = await fetchAnalogYears(latitude, longitude, body.plantingDate, seasonDays, years); }
    catch { throw new HttpError(502, 'Historical weather (ERA5) could not be retrieved. No season simulation was fabricated.'); }
    const soilInput = body.soil as SeasonInput['soil'] | undefined;
    const preset = soilPresetById.get('soil.loam-reference')!;
    const soil = soilInput ?? preset;
    const base: Omit<SeasonInput, 'weather' | 'analogYear'> = {
      cropId: crop.id,
      areaHa: typeof body.areaHa === 'number' ? body.areaHa : 1,
      applicationEfficiency: typeof body.applicationEfficiency === 'number' ? body.applicationEfficiency : 0.65,
      soil, soilKind: soilInput ? (body.soilKind==='modeled-estimate'?'modeled-estimate':body.soilKind==='illustrative-reference'?'illustrative-reference':'user-supplied') : 'illustrative-reference', weatherKind: 'historical-analog',
      ...(typeof body.potentialYieldTPerHa === 'number' ? { potentialYieldTPerHa: body.potentialYieldTPerHa } : {}),
      ...(body.supply && typeof body.supply === 'object' ? { strategy: { seasonSupplyM3: (body.supply as Record<string, number>).seasonSupplyM3, minIntervalDays: (body.supply as Record<string, number>).minIntervalDays } } : {}),
    };
    const ensemble = simulateEnsemble(base, analogs.map(a => ({ year: a.year, weather: a.weather })));
    const modifiedSpec = body.modified as Record<string, unknown> | undefined;
    let comparison = null, sensitivity = null;
    const sorted = [...ensemble.years].sort((a, b) => a.result.yieldImpact.relativeYieldRetained - b.result.yieldImpact.relativeYieldRetained);
    const medianYear = sorted[Math.floor(sorted.length / 2)];
    if (modifiedSpec) {
      const modifiedBase: SeasonInput = { ...base, weather: medianYear.result.daily.map(d => ({ date: d.date, et0Mm: d.et0Mm / ((modifiedSpec.et0Factor as number) ?? 1) || d.et0Mm, rainMm: d.rainMm })), analogYear: medianYear.year,
        perturbation: { rainFactor: typeof modifiedSpec.rainFactor === 'number' ? modifiedSpec.rainFactor : undefined, et0Factor: typeof modifiedSpec.et0Factor === 'number' ? modifiedSpec.et0Factor : undefined, temperatureDeltaC: typeof modifiedSpec.temperatureDeltaC === 'number' ? modifiedSpec.temperatureDeltaC : undefined },
        ...(typeof modifiedSpec.supplyReductionFraction === 'number' && base.strategy?.seasonSupplyM3 ? { strategy: { ...base.strategy, seasonSupplyM3: base.strategy.seasonSupplyM3 * (1 - modifiedSpec.supplyReductionFraction) } } : {}) };
      // Baseline for comparison uses the same median analog year with unmodified weather.
      const baselineInput: SeasonInput = { ...base, weather: analogs.find(a => a.year === medianYear.year)!.weather, analogYear: medianYear.year };
      const modifiedInput: SeasonInput = { ...modifiedBase, weather: baselineInput.weather };
      comparison = compareScenarios(baselineInput, modifiedInput);
    }
    sensitivity = sensitivityAnalysis({ ...base, weather: analogs.find(a => a.year === medianYear.year)!.weather, analogYear: medianYear.year });
    return json({
      kind: 'season-simulation', location: { latitude, longitude }, crop: { id: crop.id, labelId: `crop.${crop.id}` },
      plantingDate: body.plantingDate, seasonDays,
      provenance: { weather: { kind: 'modeled-historical-analog', provider: 'Open-Meteo Historical Weather API (ERA5)', analogYears: years, grids: analogs.map(a => a.grid), sourceUrls: analogs.map(a => a.sourceUrl) }, soil: { kind: base.soilKind }, result: { kind: 'simulated', yieldBasis: 'FAO-33 relative yield (water only); t/ha only if potentialYieldTPerHa supplied' } },
      assumptions: [...(soilInput ? [] : ['Illustrative loam reference soil used; it does not describe this field.']), ...(body.applicationEfficiency === undefined ? ['Application efficiency 0.65 assumed for illustration; override for planning.'] : []), ...(typeof body.areaHa === 'number' ? [] : ['areaHa was not supplied and defaulted to 1 ha: all cubic-metre totals describe a 1-hectare field, not the caller\'s farm. Millimetre results are unaffected.']), 'Historical analog years are scenarios, not long-range forecasts. Ensemble spread is not a confidence interval.'],
      ensemble: { summary: ensemble.summary, years: ensemble.years.map(y => ({ year: y.year, totals: y.result.totals, yieldImpact: y.result.yieldImpact, supply: y.result.supply, stages: y.result.stages })) },
      medianAnalogYear: medianYear.year,
      dailyBaseline: medianYear.result.daily, dailyStages: medianYear.result.stages,
      comparison, sensitivity,
    });
  } catch (error) { return fail(error); }
}
