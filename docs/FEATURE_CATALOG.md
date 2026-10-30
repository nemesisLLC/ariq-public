# ARIQ Feature Catalog

Every implemented algorithm, API, data source and reusable module. All
scientific calculations are canonical SI, deterministic, and performed by
pure TypeScript modules independent of any UI. Results always distinguish
observed / reported / modeled / forecast / estimated / simulated values.

Conventions: depths and water quantities in mm unless stated; volumes m³;
areas ha (1 mm over 1 ha = 10 m³); flows m³/hour.

---

## 1. Irrigation scheduling v1 — `lib/irrigation/core.ts`

- **What**: Horizon volume planning: FAO-56 ETc demand per field, then
  demand×priority weighted max-min progressive filling over a rooted-tree
  canal network with source, canal and serial gate-time constraints.
- **Method**: ETc = Kc·ET0 (FAO-56 Eq. 58); TAW = 1000(FC−WP)·rootDepth
  (Eq. 82); RAW = p·TAW (Eq. 83); daily balance (Eq. 85). Internal mass
  invariants are asserted (source = gate + conveyance loss, etc.).
- **Call**: `calculatePlan(input)` / POST `/api/irrigation/plan`.
- **Frontend**: legacy-compatible planner scenarios; prefer v2 for new UI.
- **Limits**: timely daily irrigation is assumed for demand; the single
  delivery window is not matched to daily deadlines (stated in output).
- **Tests**: `tests/irrigation.test.ts`, `tests/planner.test.ts`.

## 2. Advanced scheduler v2 — `lib/irrigation/scheduler.ts`

- **What**: Deadline-aware daily scheduling: Penman–Monteith ET0, Kc
  curves, Ks stress, ideal irrigation events, latest-feasible-day greedy
  allocation over daily canal/gate/supply resources, deliveries, binding
  constraint explanations, `calculateFieldOutlook` (demand/stress only).
- **Method**: FAO-56 Eq. 6 (PM), Eq. 11–39 supporting terms, Eq. 58,
  Eq. 81 (ETc adj), Eq. 82–85. Objective is explicit: minimise
  priority-weighted unmet volume under the greedy heuristic.
- **Audit fixes (2026-10-28)**:
  - M01: actual ET is bounded by physically available root-zone water;
    `DailyState.etLimitedByAvailableWater` flags bounded days; daily mass
    conserves exactly.
  - M02: FAO Eq. 39 relative radiation Rs/Rso capped at 1.
  - M03: events carry `feasibilityProven: false`; "impossible" means
    "not scheduled by this heuristic", never a proof of infeasibility.
- **Benchmark**: FAO-56 Example 18 (Uccle) reproduces 3.88 mm/day.
- **Call**: `calculateSchedule(input)`, `calculateFieldOutlook(field,
  weather, retention)` / POST `/api/irrigation/schedule`.
- **Limits**: serial gate, no hydraulics/travel time, no groundwater or
  salinity in this engine (see §8 for the groundwater balance variant).
- **Tests**: `tests/advanced-scheduler.test.ts`, `tests/science-audit.test.ts`.

## 3. Location recommendation — `lib/irrigation/recommendation.ts`

- **What**: Farm point → Open-Meteo forecast → v2 outlook/schedule tiers
  (demand-only → demand+stress → demand+schedule), with explicit
  `missingInputs` and provenance (forecast grid, valid-through, kinds).
- **Audit fixes**:
  - M07: `applicationEfficiency` is optional. Millimetre demand never
    needs it; gross m³ are `null` (never silently assumed) without it,
    and a delivery schedule is withheld.
  - M08: stale-after-failure forecasts die at a hard 6 h cutoff
    (`MAX_STALE_FORECAST_MS`) or when all forecast days have passed.
- **Call**: `recommend(input, { fetcher, cache, nowMs })` /
  POST `/api/irrigation/recommendation`.
- **Limits**: Uzbekistan bbox gate; forecast is a model grid, not field
  weather; soil/supply are never invented.
- **Tests**: `tests/recommendation.test.ts`, `tests/science-audit.test.ts`.

## 4. Season simulation & yield — `lib/irrigation/season.ts`, `season-weather.ts`, `season-demos.ts`

- **What**: Full-season daily simulation, stage summaries, FAO-33
  relative yield, ensembles over historical analog years, scenario
  comparison and one-at-a-time sensitivity.
- **Method**: FAO-56 Kc/Ks balance; FAO-33/FAO-66 Ya/Ym = 1 − Ky(1 −
  ETa/ETm). Water-only impact; t/ha only from a caller-supplied potential
  yield. Ensemble low/median/high are scenario spread, not confidence
  intervals.
- **Audit fixes**:
  - M01: same available-water ET bound as v2, per-day conservation.
  - M04: analog seasons keep the provider calendar across New Year;
    `analogYear` is start-year metadata only; ERA5 is pinned
    (`models=era5`).
  - M05: missing rain/ET0 or broken calendars reject; units checked.
  - M06: winter wheat Ky corrected to FAO-66 Table 1 value 1.05
    (spring wheat is 1.15).
  - M09: stage-product retention factors are clamped to [0, 1] each.
- **Call**: `simulateSeason`, `simulateEnsemble`, `compareScenarios`,
  `sensitivityAnalysis`, `fetchAnalogYear(s)` / POST `/api/irrigation/season`.
- **Tests**: `tests/season.test.ts`, `tests/science-audit.test.ts`.

## 5. Water sources (Feature 2) — `lib/water-sources.ts`

- **What**: Verified named reservoirs/rivers with coordinates, design
  capacity (never presented as measured storage), provenance, quality
  metadata. Search, bbox, single-record APIs.
- **Call**: GET `/api/water-sources`, `/api/water-sources/[id]`.
- **Tests**: `tests/water-sources.test.ts`.

## 6. Nationwide data foundation — `lib/data-foundation.ts` + `lib/data-foundation/*.json`

- **What**: 5,978 unified features (OSM waterways/infrastructure +
  CAWater inventory), 14 regional polygons, 45 historical/statistical
  series, source catalog and conflicts register. Uniform grid index.
- **Audit fixes**:
  - G01: GeoJSON honours limit/offset and returns `total`, `returned`,
    `nextOffset`, `truncated`. National rivers are 1,429 records — page
    through them; the atlas now fetches all pages.
  - G03: `nearestWaterFeatures` measures point features and
    point-to-segment distance to rivers/canals (`distanceKind`).
    Proximity never implies connectivity or access.
  - G04 (documented, not yet merged): OSM and CAWater keep separate
    evidence records for some physical structures; renderers should
    dedupe by proximity/name when counting (see atlas reservoirs).
- **Call**: GET `/api/water-data` (`format=geojson` supported),
  `/api/water-data/regions`, `/nearest`, `/series`, `/catalog`.
- **Limits**: named OSM features only; simplification to ~40 pts/way;
  region assignment is by feature anchor, not containment.
- **Tests**: `tests/data-foundation.test.ts`.

## 7. Weather — `lib/weather.ts`

- **What**: Open-Meteo forecast fetch with unit/missing-value validation
  (null rain never becomes zero), provenance and grid coordinates.
- **Call**: GET `/api/weather?lat&lon`; engines use `fetchWeather`
  through the bounded cache in §3.

## 8. Groundwater — `lib/groundwater.ts` (NEW)

- **What**: Scenario-grade groundwater intelligence:
  `capillaryRise` (texture parameter ranges, exponential decay beyond the
  fringe), `groundwaterRisks` (waterlogging; FAO-29 EC salinity hazard),
  `simulateGroundwaterBalance` (FAO-56 Eq. 85 with the CR term, ET and CR
  bounded, exact conservation), `groundwaterTrend` (least squares over
  caller-supplied dated observations), `assessGroundwaterScenario`.
- **Rules**: a depth is always typed `observed | historical | reported |
  user-supplied-scenario`; regional/historical data is never presented
  as a current farm measurement; capillary output is low/mid/high.
- **Call**: POST `/api/groundwater` (assessment or `{observations}`).
  Also on the Worker (§13).
- **Tests**: `tests/groundwater-soil.test.ts`.

## 9. Soil fertility — `lib/soil-fertility.ts` (NEW)

- **What**: `estimateWaterRetention` (Saxton & Rawls 2006 pedotransfer →
  FC/WP/TAW per metre), `classifySoilTest` (FAO-29 ECe salinity, pH
  bands for user lab inputs), `nutrientBalance` (fertilizer + irrigation
  N + manure inputs vs harvest removal coefficients; tendencies, never a
  prescription), `leachingRisk` (screening from simulated drainage,
  sand %, N input).
- **Call**: POST `/api/soil-fertility` with `analysis` =
  `texture | soil-test | balance | leaching`. Also on the Worker.
- **Limits**: texture estimates are coarse modelled values (not SoilGrids,
  not lab results); removal coefficients are published reference
  midpoints, not Uzbekistan-calibrated; no field rate is prescribed
  without soil-test calibration.
- **Tests**: `tests/groundwater-soil.test.ts`.

## 10. Data refresh — `lib/data-refresh.ts` (NEW)

- **What**: Fixed trusted-source registry (Open-Meteo forecast 6 h,
  ERA5 archive 30 d, CAWater catalogue check yearly, SIAT and IGRAC
  registered for manual review), schema validation, content-hash dedupe,
  last-verified fallback, `freshnessReport` for honest "Last Updated".
- **Security**: https allowlist hosts only, 15 s timeout, no crawler.
- **Call**: GET `/api/data-refresh`; Worker Cron runs `refreshAll`.
- **Tests**: `tests/data-refresh.test.ts` (mocked failure, dedupe,
  schema rejection, manual-review honesty).

## 11. AI Copilot — `lib/copilot/*`, `lib/irrigation/explanation.ts`, `agent.ts`

- **What**: Meta-model orchestrator over deterministic tools with
  validated frontend actions (Feature 6 + uncommitted investigation work,
  preserved untouched).
- **Gate (NEW)**: POST `/api/copilot` returns 503 `copilot-disabled`
  unless `ARIQ_COPILOT_ENABLED=true` AND a server `META_API_KEY` exist.
  Public enablement additionally requires an approved spending cap with
  persisted atomic enforcement (see SECURITY notes in
  docs/CLOUDFLARE_ARCHITECTURE.md). The Worker always returns 503.
- **Tests**: `tests/copilot.test.ts`, `tests/security-gates.test.ts`.

## 12. Atlas geometry — `app/atlas/geo.ts`, `terrain.ts`

- **What**: Equirectangular relief projection, scanline country mask,
  geodesic area (Chamberlain–Duquette), representative/interior points,
  polygon validation.
- **Audit fixes**: G02 projection scale corrected (east/north ratio =
  cos 41.32°); G05 `validateFarmPolygon` (bow-tie, bounds, area) and
  `interiorPoint` (guaranteed inside, used for farm analysis).
- **Performance**: `public/data/uzbekistan-relief-v1.json` (245 KB,
  Int16 elevations + mask, generated from the terrarium pipeline in
  `terrain.ts`) replaces 40 elevation-tile requests; live tiles remain
  the fallback. Regenerate by loading the atlas once and exporting
  `window.__ariqRelief` (see git history for the export harness).
- **Tests**: `tests/atlas-geo.test.ts`, `tests/science-audit.test.ts`.

## 13. Cloudflare Worker — `cloudflare/worker.ts`, `wrangler.jsonc`

- **What**: `ariq-api` Worker: `/api/health`, `/api/data-freshness`,
  `/api/calculate/plan|schedule`, `/api/groundwater`,
  `/api/soil-fertility`, `/api/copilot` (503), Static Assets from
  `public/`, Cron `15 */6 * * *` refresh into Cache API snapshots.
- **Verified locally**: workerd served all endpoints; a triggered cron
  fetched real Open-Meteo data and freshness reported `live`.
- Full detail: docs/CLOUDFLARE_ARCHITECTURE.md.

## 13b. Registan entrance — `app/entrance/*`

- **What**: The accepted cinematic entry (procedurally built portal,
  GSAP camera journey of 5.8 s, threshold fade into the atlas).
  Trilingual (en/uz/ru), Skip/Replay, `prefers-reduced-motion` support,
  session gate (`ariq-entered`), and it preloads the atlas + relief in
  the background while the intro plays (`loadReliefData` is a shared,
  retryable promise for this reason).
- **Frozen**: visuals, lighting, materials, motion and the large Enter
  button must not change. See `docs/registan-entrance.md`.
- **Tests**: `tests/entrance-journey.test.ts`.

## 13c. Data sources registry — `docs/DATA_SOURCES.md`

Canonical source per variable (Ministry of Water Resources, Uzhydromet,
SIC ICWC/BWO, AQUASTAT, IGRAC, GRDC, GRACE-FO, SoilGrids, GRDC…),
deduplication rules, and the algorithm integration map. The
machine-readable form is `SOURCE_REGISTRY` in `lib/data-refresh.ts`;
every entry carries `canonicalFor`.

## 13d. Farm-intelligence evidence layer — `lib/farm-intelligence.ts` (Phase 1)

- **What**: `getFarmEvidence(lat, lon)` / GET `/api/farm-evidence` —
  region containment, SoilGrids regional soil statistics with Q-ranges
  and a Saxton–Rawls retention scenario, line-aware documented-water
  proximity, ERA5 regional climate means, SIAT national water context
  (datasets 3505–3513, 2013–2025), and an explicit groundwater null.
- **Data**: `lib/data-intelligence/siat-water.json`,
  `lib/data-intelligence/soil-regions.json`; regenerate with
  `.venv/Scripts/python.exe scripts/acquire-phase1-data.py`.
- **Rules**: modelled soil is never a lab result; national statistics
  are never downscaled; groundwater depth is never estimated.
- **Tests**: `tests/farm-intelligence.test.ts` (six regional farms).

## 13e. Unified automatic farm intelligence — `lib/farm-profile.ts`

- **What**: `buildFarmProfile({latitude, longitude | polygon, cropId,
  plantingDate, seedQuantityKg?})` — from land + crop + planting date
  alone it assembles Phase 1/2 evidence (`getFarmEvidence`), feeds the
  Phase 2 modelled soil (FC/WP via Saxton–Rawls) plus FAO-56 Table 22
  root-depth/depletion references into the existing Feature 4 → Feature 1
  irrigation engine, adds the FAO-56 stage calendar, FAO-33 Ky
  sensitivity, and a seeding rate (kg/ha) against a general reference
  range. No new algorithms; every engine is reused, not duplicated.
- **API**: GET `/api/farm-evidence?lat&lon[&polygon][&cropId&plantingDate][&seedKg][&areaHa]`
  — without crop parameters the Phase 1/2 response is unchanged; with
  both `cropId` and `plantingDate` the same response gains a `profile`
  section. One without the other is a 400.
- **Rules**: seed quantity NEVER changes irrigation results (regression
  tested); unknowns stay unknown (current soil depletion, groundwater
  depth, water supply/connectivity, lab test, point-only area — volumes
  and kg/ha are withheld, mm demand is not); polygon area is geodesic
  and labelled not-cadastral; forecast failure returns an evidence-only
  profile, never invented weather.
- **Tests**: `tests/farm-profile.test.ts` (11 cases incl. seed-invariance
  of irrigation, crop contrasts, forecast outage, stale planting date,
  invalid inputs).

## 13f. Automatic soil moisture (Phase 3) — `lib/irrigation/soil-moisture.ts`

- **Question**: can satellite/reanalysis soil moisture defensibly set a
  farm's *initial root-zone depletion* so farmers need not guess it?
- **Products investigated**:
  - *ERA5-Land (ECMWF)* — volumetric θ at 0–7/7–28/28–100 cm, 0.1°
    (~9 km), hourly, few-days lag, key-free via Open-Meteo. **Critical
    limit: no irrigation scheme**, so over irrigated land moisture is
    rain-driven and can run dry-biased in season; literature validation
    shows useful correlation but material bias (ubRMSE ~0.04–0.06 m³/m³
    in favourable networks, worse uncalibrated). **Integrated as a
    labelled scenario only.**
  - *SMAP L4 (NASA)* — true root-zone (0–100 cm) product, 9 km, best
    accuracy of the three (ubRMSE ~0.05 at core sites), assimilation
    senses surface irrigation wetting. Not integrated: NASA Earthdata
    credentials, EASE-Grid processing, up to ~7-day latency. Revisit
    with a credentialed pipeline.
  - *Copernicus CGLS Soil Water Index (ASCAT)* — daily ~0.1°, but SWI is
    a saturation index (0–100%), not volumetric θ; converting to
    depletion stacks porosity assumptions per pixel. Not integrated.
  - No openly obtainable Uzbekistan in-situ soil-moisture network was
    found, so **local empirical accuracy cannot be verified**; claims
    rest on global validation literature, stated as such.
- **Method**: depletion fraction (FC−θ)/(FC−WP) from depth-weighted
  ERA5-Land θ (observed to ≤1 m, fraction applied to the full root
  zone) × TAW; θ uncertainty ±0.05 m³/m³ gives wetter/central/drier
  depletions. The farm profile runs the EXISTING FAO-56 engine at all
  three and reports the resulting first-stress-date range. Cross-model
  pairing (FC/WP from SoilGrids/Saxton–Rawls, θ from ERA5-Land) is a
  stated assumption; θ is clamped, never recalibrated.
- **Rules**: scenario never overrides a farmer-supplied depletion,
  never labelled a measurement; source failure produces
  `unavailable-source-failure` and substitutes nothing; the profile's
  main irrigation still lists current depletion as unknown.
- **Tests**: `tests/soil-moisture.test.ts` (fetch completeness,
  depletion math/clamps, three-scenario stress ordering, source
  failure, farmer-override precedence).

## 14. Shared utilities

- `lib/units.ts` — SI ↔ US conversions (single source; display only).
- `lib/i18n-labels.ts` — stable en/uz/ru label identifiers.
- `lib/irrigation/http.ts` — local JSON API guard: bounded bodies,
  loopback-alias origins (localhost ↔ 127.0.0.1, same scheme+port) are
  the same site; everything else cross-site is rejected.
- `lib/district.ts`, `lib/planner.ts` — legacy helpers kept for
  compatibility.

## Data sources and licences (summary)

| Source | Use | Kind | Licence note |
|---|---|---|---|
| FAO-56 / FAO-33 / FAO-66 | Methods, Kc, Ky | reference | FAO publications; cite, no data redistribution issue |
| Open-Meteo forecast/archive | Weather, ERA5 analogs | forecast/modeled | CC BY 4.0; free tier non-commercial, no SLA — confirm hackathon eligibility |
| Mapzen/AWS Terrain Tiles | DEM (relief asset) | modeled | AWS Open Data terms, attribution retained |
| OpenStreetMap | Waterways, boundaries | reported/observed mix | ODbL |
| CAWater-Info / ICWC | Reservoir inventory, yearbooks | reported | No explicit open licence found — confirm before republication |
| SIAT / UzStat | National statistics | reported | Portal terms |
| IGRAC GGIS | Groundwater context | observed (regional) | Per-dataset terms; never farm-level |
| Saxton & Rawls 2006 | Soil pedotransfer | method | Journal method citation |
| GeoNames via Open-Meteo Geocoding | City coordinates | reported | CC BY |
