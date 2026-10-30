# Uzbekistan Data Sources — Canonical Registry (researched 2026-10-28)

One canonical source per variable. Everything else is a cross-check and
must never silently override the canonical value. This file is the human
companion to `lib/data-refresh.ts` (`SOURCE_REGISTRY`), which is the
machine-readable version the refresh engine and `/api/data-refresh` use.

## Canonical variable matrix

| Variable family | Canonical source | Kind | Access | Refresh |
|---|---|---|---|---|
| Short-term forecast + FAO-56 ET0 | Open-Meteo Forecast API | forecast (model) | JSON API, CC BY 4.0 | 6 h, automated |
| Historical analog weather | Open-Meteo Archive, ERA5 pinned | modeled reanalysis | JSON API | 30 d, automated |
| Transboundary river operations, reservoir regimes | SIC ICWC / BWO Amu Darya & BWO Syr Darya reports (sic.icwc-aral.uz) | reported (operational) | PDF reports | Seasonal, catalogue check |
| Reservoir design capacity & inventory | CAWater-Info / ICWC reservoir inventory (already in Feature 2/3 data) | reported | Deliberate ingest | Yearly check |
| National water statements, hydropost announcements | Ministry of Water Resources (water.gov.uz) | reported (official) | Statements, no API found | Monthly manual review |
| National observations (hydro/met, water quality, district groundwater & salinity series) | Uzhydromet / monitoring.meteo.uz | observed | Portal/agreement, no open API | Monthly manual review |
| National water-use & agriculture statistics | UzStat / SIAT (siat.stat.uz) | reported (official statistics) | Portal datasets | Quarterly manual review |
| Long-term renewable water accounts | FAO AQUASTAT Uzbekistan factsheet | reported (long-term averages) | PDF account | Yearly check |
| Aquifer boundaries / transboundary aquifers | IGRAC GGIS (UNESCO-IGRAC) | observed/context | Portal | Quarterly manual review |
| Historical gauged discharge | GRDC station archive | observed | Registration-gated | Yearly manual review |
| Regional groundwater storage anomaly | NASA GRACE-FO | modeled (basin scale) | Earthdata | Quarterly manual review |
| Modelled soil properties (context) | ISRIC SoilGrids 2.0 | modeled (ML, with uncertainty) | Downloads/WCS, CC BY 4.0 — **not** the paused REST API | Yearly |
| Farm soil truth | User soil-lab test (`SoilTestInput`) | observed (lab) | User supplied | Per test |
| Farm groundwater truth | User observation well (`GroundwaterObservation`) | observed | User supplied | Per reading |
| Waterway/reservoir geometry | OpenStreetMap (ODbL) via Feature 3 foundation | reported/observed mix | Already ingested | Snapshot |
| Elevation | Mapzen/AWS Terrain Tiles → precomputed relief asset | modeled | Static asset | Versioned |

## Key evidence (with dates)

- **FAO AQUASTAT, Uzbekistan water-resources account**: total renewable
  water resources **48.87 km³/year** (long-term average), groundwater
  produced internally **8 km³/year**. These are planning context, never
  current availability.
- **SIC ICWC seasonal analytical reports** (e.g. growing season 2025):
  actual Amu Darya availability at Kerki and Syr Darya reservoir volumes
  are reported against ICWC-approved limits — the closest thing to
  operational truth for the two rivers supplying most of Uzbekistan.
- **Ministry of Water Resources statements** publish hydropost levels
  (e.g. Amu Darya at Termez) during the season; no machine-readable feed
  was found — treat as dated reported statements.
- **Uzhydromet** is the national observer; the district groundwater
  depth/mineralisation and soil-salinity series used in peer-reviewed
  Uzbek studies are supplied by these agencies by agreement. ARIQ must
  not scrape the portals against their terms.
- **Soil salinity context**: peer-reviewed and national reporting puts
  roughly 45% of Uzbekistan's ~4.3 Mha irrigated land at some degree of
  salinity (2023-era reporting) — a regional context statistic, never a
  field diagnosis.
- **IGRAC/UNESCO** maps 34 transboundary aquifers across the five
  Central Asian states (incl. the Pretashkent aquifer) — boundaries and
  context, not farm depths.

## Deduplication rules (enforced in design)

1. **One canonical source per variable** (matrix above). A second source
   may cross-check and raise a conflict record (Feature 3 already keeps
   a conflicts register); it never silently replaces the canonical value.
2. **Design capacity ≠ measured storage.** Reservoir volumes in ARIQ are
   design capacities (CAWater). Current storage exists only in dated
   SIC ICWC/Ministry reports and must be stored as dated `reported`
   series, never merged into the capacity field.
3. **OSM geometry vs CAWater inventory** describe some of the same
   structures as separate evidence records (audit G04). Renderers dedupe
   by proximity/name for display counts; both records stay in storage.
4. **Soil hierarchy**: lab test > user texture + Saxton–Rawls estimate >
   SoilGrids modelled context. Lower tiers never overwrite higher ones.
5. **Groundwater hierarchy**: dated user/agency observation > scenario
   assumption. AQUASTAT/IGRAC/GRACE describe regions and basins only.
6. **Weather**: forecast (Open-Meteo) and reanalysis (ERA5) are different
   kinds and are never blended into one series.

## Algorithm integration map

| Algorithm | Feeds from |
|---|---|
| FAO-56 ET0 / scheduler | Open-Meteo forecast ET0 or caller weather; PM from station-like inputs |
| Recommendation | Open-Meteo point forecast (canonical), Feature 3 proximity (display only) |
| Season / yield | ERA5 analog years (canonical historical), FAO Kc/Ky references |
| Groundwater balance | User depth (typed kind) + texture scenario parameters; AQUASTAT/IGRAC context only |
| Soil fertility | Lab test, or texture estimate; SoilGrids reserved as future context layer |
| National briefing (future) | Refresh registry freshness + SIC ICWC/Ministry dated reports |

## Phase 1 integrations (2026-10-28, branch `phase1-data-intelligence`)

- **SIAT SDMX JSON works**: `api.siat.stat.uz/sdmx/<id>/table/download/`
  returns a metadata record pointing at the dataset JSON. Datasets
  3505–3513 (irrigation withdrawal by source: total, surface, groundwater,
  wells, collector-drainage return; million m³, 2013–2025, updated
  2026-04-28, prepared by the Ministry of Water Resources) are ingested
  in `lib/data-intelligence/siat-water.json`. 2025 total irrigation
  withdrawal: 40,681 million m³.
- **SoilGrids WCS works** (WCS 1.0 GetCoverage with BBOX/WIDTH/HEIGHT;
  2.0.1 needs explicit output sizing): national tiles for sand, clay,
  silt, SOC, pH, bulk density, CEC at 0–5/5–15/15–30 cm plus Q0.05/Q0.95
  uncertainty for sand/clay, aggregated inside ADM1 polygons into
  `lib/data-intelligence/soil-regions.json` (all 14 regions; sand
  16–30%, clay 27–34%, pH 7.1–7.7 regional means).
- **Farm evidence layer**: `lib/farm-intelligence.ts` +
  GET `/api/farm-evidence?lat&lon` combine regional SoilGrids +
  Saxton–Rawls retention scenarios, line-aware water proximity, ERA5
  regional climate context, SIAT national context, and an explicit
  groundwater null. Reproduce with `scripts/acquire-phase1-data.py`
  (project `.venv`).

## Phase 2 integrations (farm-specific soil, branch `phase2-farm-soil`)

- **National SoilGrids grid**: `scripts/acquire-phase2-soil-grid.py`
  extends the Phase 1 WCS pipeline to a 0.01° national grid (1745×885
  requested cells; 461,822 cells inside the ADM1 union) persisted as
  quantized uint8 layers in `lib/data-intelligence/soil-grid.json`
  (3.4 MB, ~1.1 MB gzipped, no raster binaries; verified Worker upload
  2,887 KiB gzip, inside Cloudflare Free limits). Layers: sand/clay/
  SOC/pH means (0–30 cm depth-weighted as Phase 1; farm silt is derived
  as the texture residual so fractions close to 100%) plus SoilGrids
  Q0.05–Q0.95 uncertainty widths (5–15 cm) for sand, clay, SOC and pH
  on a coarser 0.02° grid. The SoilGrids
  source models at 250 m; the WCS response resamples onto the requested
  grid, so cells are ~1 km aggregates of the 250 m predictions — not
  250 m-native samples and never field measurements.
- **Sampling**: `lib/soil-grid.ts` — bilinear point sampling; polygon
  sampling aggregates every intersecting cell weighted by its true
  spherical overlap area (partial boundary cells count partially via
  8×8 sub-cell integration; cell area is latitude-dependent), with
  intersection-weighted mean/min/max/std/p10–p90 variation and explicit
  missing-data coverage: `sampledAreaKm2`, `nodataAreaKm2`,
  `intersectingCells`, `nodataCells`, `partialCells`, and a
  `coverageRatio` bounded in [0, 1] (SoilGrids nodata bands, e.g.
  river/urban masks, reduce it and are reported, not hidden). Small and
  concave polygons are handled by the same intersection machinery; only
  a polygon whose intersecting cells are ALL nodata falls back to a
  flagged centroid point sample (`subCellPolygon`). Available water
  capacity is derived only via the existing Saxton–Rawls pedotransfer
  (`estimateWaterRetention`); its range is a sensitivity span over the
  approximated texture intervals, explicitly labelled
  `sensitivity-to-approximate-texture-intervals-not-confidence`.
- **Depth discipline**: headline estimates are 0–30 cm depth-weighted
  means, but the SoilGrids Q0.05/Q0.95 uncertainty layers describe
  5–15 cm only. Returned intervals are the 0–30 cm estimate ± half the
  5–15 cm width — an approximation across depths. Every estimate
  carries `uncertaintyInfo` (`calibrated: false`,
  `fieldLevelConfidence: false`); these must never be presented as
  calibrated field-level confidence intervals.
- **API**: `GET /api/farm-evidence?lat&lon[&polygon=[[lon,lat],...]]`
  is backward compatible. Headline soil values become the location-
  specific estimate when the grid covers the farm; the Phase 1 regional
  estimate is preserved verbatim in `soil.regionalEstimate` and remains
  the fallback (`soil.estimateBasis`:
  `soilgrids-grid-point | soilgrids-grid-polygon | regional-fallback`).
- **Caching/Cloudflare**: the grid is a static precomputed import — no
  live WCS calls per request; the route keeps its 1 h cache header.
  Reproduce with `.venv/Scripts/python.exe
  scripts/acquire-phase2-soil-grid.py`; validate with
  `scripts/validate-phase2-soil.py`.
- **Validation against independent ground measurements (limited)**:
  the only openly obtainable Uzbekistan lab dataset with texture/SOC/pH
  is regional: Int. J. Environ. Res. Public Health 2022, 19, 8794,
  Table 1 (Khiva/Kushkupir/Shavat districts, Khorezm; Research Institute
  of Soil Science and Agrochemistry; published fractions sum to ~105%
  as printed). Depth-weighted 0–30 cm measured means vs the Phase 2
  grid mean over the Khorezm ADM1 polygon (6,708 cells): sand
  28.3 vs 18.9%, silt 58.3 vs 47.8% (grid silt is the texture residual),
  clay 18.0 vs 33.3%, SOC 3.7 vs 9.7 g/kg, pH 6.19 vs 7.59. The
  SoilGrids model is therefore materially biased in this irrigated arid
  region (notably clay and SOC high). No bias correction was applied —
  one regional dataset is not a calibration. **Farm-level empirical
  accuracy cannot be verified**: no openly obtainable georeferenced
  Uzbekistan farm soil-test dataset exists. Treat farm values as
  modelled priors with wide, uncalibrated uncertainty; a lab test
  remains the only field truth. The discrepancy is preserved in code as
  `KHOREZM_LAB_VALIDATION` (`lib/soil-grid.ts`, reproduced by
  `scripts/validate-phase2-soil.py`) and is returned with every soil
  response as `soil.validationContext` (`biasCorrectionApplied:
  false`, `farmLevelAccuracyVerified: false`), so consumers cannot
  quote the modelled values without the validation context alongside.
- **Acquisition bug fixed en route**: depth weighting now averages
  valid layers only; `np.nansum` previously turned all-nodata cells
  into fabricated 0.0 values. (The Phase 1 regional file was left
  untouched to preserve the approved foundation.)

## Phase 2 algorithm candidates (biggest expected gains, not built)

1. **Remote-sensing ET calibration (FAO WaPOR / ERA5-Land)**: bias-correct
   regional Kc/ET0 against observed actual ET instead of assuming
   reference conditions — likely the largest accuracy gain nationally.
2. **Reservoir/supply nowcasting**: deliberate ingestion of dated SIC
   ICWC seasonal reports as `reported` storage/flow series feeding
   supply scenarios (still never design-capacity-as-storage).
3. **Soil-moisture assimilation**: ERA5-Land/satellite surface moisture
   to initialise depletion (Dr0) with uncertainty, replacing user guesses.
4. **Salinity yield modifier**: FAO-56 crop salt-tolerance thresholds
   applied only with measured ECe (lab or agency series), as a separate
   documented factor — never merged silently into Ky.
5. **Groundwater coupling where observed**: capillary-rise integration
   switched on only with dated observation-well data (Uzbekhydrogeology
   partnership/agreement is the blocker, not the math).

## What could not be obtained (and why)

- No open machine-readable API was found for Ministry of Water
  Resources, Uzhydromet, Uzbekhydrogeology, or SIAT water series.
  These remain registered manual-review sources; automating them
  requires an official data-sharing route, not scraping.
- GRDC discharge is registration-gated.
- CAWater/ICWC licensing for republication is not explicit — the owner
  should confirm before any public redistribution of ingested figures.
