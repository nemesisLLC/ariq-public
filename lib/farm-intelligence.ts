/**
 * Farm-intelligence evidence layer (Phase 1).
 *
 * One call assembles the best available evidence for a farm location from
 * ARIQ's integrated datasets. Every section is typed by evidence kind and
 * carries provenance. Where farm-level measurements do not exist, this
 * layer returns labelled regional context or an explicit null — it never
 * invents a groundwater depth, a soil-test result, or a current storage.
 *
 * Sources (see docs/DATA_SOURCES.md):
 * - Soil: ISRIC SoilGrids 2.0. Phase 2 prefers location-specific grid
 *   predictions (lib/soil-grid.ts, lib/data-intelligence/soil-grid.json)
 *   for the farm point/polygon; Phase 1 regional statistics
 *   (lib/data-intelligence/soil-regions.json) remain the fallback and are
 *   preserved in `regionalEstimate`. Always modeled estimates.
 * - National water: SIAT SDMX datasets 3505-3513 (Ministry of Water
 *   Resources via UzStat) — reported national statistics, context only.
 * - Water proximity: Feature 3 foundation (OSM + CAWater), line-aware.
 * - Climate: Feature 3 ERA5 regional series — modeled reanalysis.
 * - Groundwater: no open farm-level data exists; depth stays null and
 *   the scenario API is the supported path.
 */
import soilRegionsJson from './data-intelligence/soil-regions.json' with { type: 'json' };
import siatJson from './data-intelligence/siat-water.json' with { type: 'json' };
import { foundationRegions, nearestWaterFeatures, searchSeries } from './data-foundation.ts';
import { estimateWaterRetention } from './soil-fertility.ts';
import { sampleSoilAtPoint, sampleSoilForPolygon, soilGridProvenance, KHOREZM_LAB_VALIDATION, type SoilGridPointResult, type SoilGridPolygonResult } from './soil-grid.ts';
import { InputError } from './irrigation/core.ts';

type LonLat = [number, number];
function pointInRing(lon: number, lat: number, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export type FarmEvidence = {
  location: { latitude: number; longitude: number; region: string | null; insideUzbekistanBbox: boolean };
  soil: {
    kind: 'modeled-estimate'; region: string;
    texture: { sandPct: number; clayPct: number; siltPct: number | null; sandRangePct: [number, number] | null; clayRangePct: [number, number] | null };
    organicCarbonGPerKg: number | null; ph: number | null; bulkDensityGPerCm3: number | null; cecCmolPerKg: number | null;
    waterRetentionScenario: { fieldCapacity: number; wiltingPoint: number; totalAvailableMmPerM: number } | null;
    withinRegionSpread: string; source: string; note: string;
    /**
     * Phase 2 (additive; Phase 1 consumers keep working): `estimateBasis`
     * says whether the headline values above are location-specific grid
     * predictions or the Phase 1 regional fallback. `farmEstimate` carries
     * the full location-specific estimate with SoilGrids Q0.05-Q0.95
     * intervals and, for polygons, within-farm cell variation.
     * `regionalEstimate` preserves the Phase 1 regional values verbatim.
     */
    estimateBasis: 'soilgrids-grid-point' | 'soilgrids-grid-polygon' | 'regional-fallback';
    farmEstimate: (SoilGridPointResult | SoilGridPolygonResult) | null;
    regionalEstimate: { sandPct: number; clayPct: number; siltPct: number | null; organicCarbonGPerKg: number | null; ph: number | null } | null;
    /**
     * Independent Khorezm laboratory validation of the SoilGrids model,
     * including the preserved modelled-vs-measured discrepancy. No bias
     * correction is applied and farm-level accuracy is not verified.
     * Present whenever soil is reported so consumers cannot quote the
     * modelled values without this context being available alongside.
     */
    validationContext: typeof KHOREZM_LAB_VALIDATION;
  } | null;
  water: {
    kind: 'reported'; note: string;
    nearest: { id: string; name: string | null; kind: string; distanceKm: number; distanceKind: 'point' | 'line-segment' }[];
  };
  nationalWaterContext: {
    kind: 'reported'; geography: 'national';
    latestIrrigationWithdrawalMillionM3: { year: number; value: number } | null;
    latestGroundwaterWithdrawalMillionM3: { year: number; value: number } | null;
    source: string; note: string;
  };
  climate: { kind: 'modeled'; region: string; series: { indicator: string; unit: string; recentMean: number | null; years: number[] }[] } | null;
  groundwater: {
    depthToWaterM: null; status: 'no-farm-measurement-available';
    regionalContext: string; scenarioApi: string;
  };
  warnings: string[];
};

const soilRegions = (soilRegionsJson as unknown as { regions: { region: string; soil: Record<string, { mean: number; p10: number; p90: number; unit: string }>; uncertainty5to15cm: Record<string, { q05Mean: number; q95Mean: number }> }[] }).regions;
const siat = siatJson as unknown as { datasets: { datasetId: number; rows: { geography: string | null; values: Record<string, number> }[] }[] };

function latestValue(datasetId: number): { year: number; value: number } | null {
  const ds = siat.datasets.find((d) => d.datasetId === datasetId);
  const row = ds?.rows[0];
  if (!row) return null;
  const years = Object.keys(row.values).map(Number).sort((a, b) => b - a);
  return years.length ? { year: years[0], value: row.values[String(years[0])] } : null;
}

export function getFarmEvidence(latitude: number, longitude: number, options?: { polygon?: [number, number][] }): FarmEvidence {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new InputError('latitude/longitude must be finite WGS84 coordinates');
  }
  if (options?.polygon !== undefined) {
    const ring = options.polygon;
    if (!Array.isArray(ring) || ring.length < 3 || ring.some((p) => !Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[1]) > 90 || Math.abs(p[0]) > 180)) {
      throw new InputError('polygon must be an array of at least 3 [longitude, latitude] WGS84 points');
    }
  }
  const warnings: string[] = [];
  const insideUzbekistanBbox = longitude >= 55.9 && longitude <= 73.35 && latitude >= 36.9 && latitude <= 45.75;
  if (!insideUzbekistanBbox) warnings.push('warning.location-outside-uzbekistan-coverage');

  // Region lookup needs boundaries, not a recount of every national feature.
  const regions = foundationRegions;
  let regionName: string | null = null;
  for (const r of regions) {
    const rings = (r.polygon ?? []) as unknown as LonLat[][];
    if (rings.some((ring) => pointInRing(longitude, latitude, ring))) { regionName = r.nameEn; break; }
  }
  if (!regionName) {
    // Fall back to the nearest regional centre, labelled as such.
    let best = Infinity;
    for (const r of regions) {
      if (!r.centre) continue;
      const d = Math.hypot(r.centre.latitude - latitude, r.centre.longitude - longitude);
      if (d < best) { best = d; regionName = r.nameEn; }
    }
    warnings.push('warning.region-by-nearest-centre-not-containment');
  }

  const soilRow = soilRegions.find((s) => s.region === regionName) ?? null;
  let soil: FarmEvidence['soil'] = null;
  if (soilRow) {
    const g = (k: string) => soilRow.soil[k] ?? null;
    const sand = g('sand'), clay = g('clay'), silt = g('silt'), soc = g('soc'), ph = g('phh2o'), bdod = g('bdod'), cec = g('cec');
    let retention: FarmEvidence['soil'] extends null ? never : NonNullable<FarmEvidence['soil']>['waterRetentionScenario'] = null;
    if (sand && clay && soc) {
      try {
        // SOC g/kg -> organic matter % (Van Bemmelen 1.724 on carbon %).
        const omPct = (soc.mean / 10) * 1.724;
        const est = estimateWaterRetention({ sandPct: sand.mean, clayPct: clay.mean, organicMatterPct: Math.min(10, omPct) });
        retention = { fieldCapacity: est.fieldCapacity, wiltingPoint: est.wiltingPoint, totalAvailableMmPerM: est.totalAvailableMmPerM };
      } catch { retention = null; }
    }
    // Phase 2: prefer the location-specific grid estimate for this point /
    // polygon; the Phase 1 regional estimate above remains the fallback and
    // is preserved verbatim in `regionalEstimate`.
    const farmEstimate = options?.polygon
      ? sampleSoilForPolygon(options.polygon)
      : sampleSoilAtPoint(latitude, longitude);
    if (options?.polygon && !farmEstimate) warnings.push('warning.soil-polygon-outside-grid-coverage-regional-fallback');
    if (!options?.polygon && !farmEstimate && insideUzbekistanBbox) warnings.push('warning.soil-grid-no-valid-cell-regional-fallback');

    const regionalEstimate = {
      sandPct: sand?.mean ?? 0, clayPct: clay?.mean ?? 0, siltPct: silt?.mean ?? null,
      organicCarbonGPerKg: soc?.mean ?? null, ph: ph?.mean ?? null,
    };
    const useFarm = farmEstimate !== null;
    const farmRetention = farmEstimate?.availableWater
      ? { fieldCapacity: farmEstimate.availableWater.fieldCapacity, wiltingPoint: farmEstimate.availableWater.wiltingPoint, totalAvailableMmPerM: farmEstimate.availableWater.totalAvailableMmPerM }
      : null;
    const provenance = soilGridProvenance();
    soil = {
      kind: 'modeled-estimate', region: regionName!,
      texture: {
        sandPct: useFarm ? farmEstimate.sandPct : regionalEstimate.sandPct,
        clayPct: useFarm ? farmEstimate.clayPct : regionalEstimate.clayPct,
        siltPct: useFarm ? farmEstimate.siltPct : regionalEstimate.siltPct,
        sandRangePct: useFarm ? farmEstimate.uncertainty.sandPct : (soilRow.uncertainty5to15cm.sand ? [soilRow.uncertainty5to15cm.sand.q05Mean, soilRow.uncertainty5to15cm.sand.q95Mean] : null),
        clayRangePct: useFarm ? farmEstimate.uncertainty.clayPct : (soilRow.uncertainty5to15cm.clay ? [soilRow.uncertainty5to15cm.clay.q05Mean, soilRow.uncertainty5to15cm.clay.q95Mean] : null),
      },
      organicCarbonGPerKg: useFarm ? farmEstimate.organicCarbonGPerKg : regionalEstimate.organicCarbonGPerKg,
      ph: useFarm ? farmEstimate.ph : regionalEstimate.ph, bulkDensityGPerCm3: bdod?.mean ?? null, cecCmolPerKg: cec?.mean ?? null,
      waterRetentionScenario: useFarm ? farmRetention : retention,
      withinRegionSpread: sand ? `Sand p10-p90 ${sand.p10}-${sand.p90}% within the region; a regional mean hides real field variation.` : '',
      source: useFarm
        ? `${provenance.source}; national grid ${provenance.gridCellDeg} deg (WCS-resampled from 250 m source), retrieved ${provenance.retrievedAt}`
        : 'ISRIC SoilGrids 2.0 (WCS, 250 m source aggregated regionally), CC BY 4.0',
      note: useFarm
        ? 'Modelled location-specific SoilGrids prediction (0-30 cm) for this farm location, not a soil measurement. Texture ranges reuse 5-15 cm SoilGrids Q0.05-Q0.95 model uncertainty approximately (see farmEstimate.uncertaintyInfo); they are not calibrated field-level confidence intervals. Independent Khorezm lab validation found material regional bias (see validationContext); no bias correction is applied. Use a lab test for field decisions (POST /api/soil-fertility analysis=soil-test).'
        : 'Modelled regional estimate, not a soil measurement. Ranges are SoilGrids Q0.05-Q0.95 model uncertainty at 5-15 cm, not calibrated field-level confidence. Use a lab test for field decisions (POST /api/soil-fertility analysis=soil-test).',
      estimateBasis: useFarm ? farmEstimate.basis : 'regional-fallback',
      farmEstimate,
      regionalEstimate,
      validationContext: KHOREZM_LAB_VALIDATION,
    };
  }

  const nearest = nearestWaterFeatures(latitude, longitude, 5).map((n) => ({
    id: n.feature.id, name: n.feature.nameEn ?? n.feature.nameSource, kind: n.feature.kind, distanceKm: n.distanceKm, distanceKind: n.distanceKind,
  }));

  let climate: FarmEvidence['climate'] = null;
  if (regionName) {
    try {
      // ERA5 series are stored per region under the FULL region name
      // ('Samarqand Region') with MONTHLY records
      // {month, precipitationMm, et0Mm, temperatureMeanC}. (Audit fix:
      // this block previously stripped ' Region' before searching and
      // read a {year, value} shape that this dataset never had, so the
      // climate section was silently always empty.)
      const series = searchSeries({ sourceDataset: 'open-meteo-era5-archive', region: regionName });
      const monthly = (series[0]?.values ?? []) as unknown as { month: string; precipitationMm: number; et0Mm: number; temperatureMeanC: number }[];
      if (series.length && monthly.length) {
        const recent = monthly.slice(-60); // last 5 years of months
        const mean = (pick: (v: typeof monthly[number]) => number) =>
          recent.reduce((a, v) => a + pick(v), 0) / recent.length;
        const years = [Number(monthly[0].month.slice(0, 4)), Number(monthly[monthly.length - 1].month.slice(0, 4))];
        climate = {
          kind: 'modeled', region: regionName,
          series: [
            { indicator: 'Precipitation (ERA5 monthly mean, last 5 years)', unit: 'mm/month', recentMean: mean((v) => v.precipitationMm), years },
            { indicator: 'FAO-56 ET0 (ERA5 monthly mean, last 5 years)', unit: 'mm/month', recentMean: mean((v) => v.et0Mm), years },
            { indicator: 'Mean temperature (ERA5 monthly mean, last 5 years)', unit: 'degC', recentMean: mean((v) => v.temperatureMeanC), years },
          ],
        };
      }
    } catch { climate = null; }
  }

  return {
    location: { latitude, longitude, region: regionName, insideUzbekistanBbox },
    soil,
    water: { kind: 'reported', note: 'Geographic proximity only; this does not imply hydraulic connectivity or a right to water.', nearest },
    nationalWaterContext: {
      kind: 'reported', geography: 'national',
      latestIrrigationWithdrawalMillionM3: latestValue(3506),
      latestGroundwaterWithdrawalMillionM3: latestValue(3511),
      source: 'SIAT SDMX datasets 3505-3513, Ministry of Water Resources via UzStat (api.siat.stat.uz)',
      note: 'National reported statistics for context. They are never downscaled to this farm.',
    },
    climate,
    groundwater: {
      depthToWaterM: null, status: 'no-farm-measurement-available',
      regionalContext: 'Uzbekistan long-term renewable groundwater production is about 8 km3/year (FAO AQUASTAT national account). Regional salinity/groundwater research exists, but no open farm-level depth dataset was found; ARIQ will not estimate a depth for this field.',
      scenarioApi: 'POST /api/groundwater with a user-supplied depth and depthKind',
    },
    warnings,
  };
}
