# Frontend Integration Guide (for Codex)

The backend is finished and stable. Build the frontend against these
contracts; do not reimplement science in the browser except where this
guide says the shared engine is the point.

## Ground rules

1. All numbers come from the APIs/modules below. Never invent weather,
   soil, supply, groundwater depth, storage, or yield values.
2. Respect every `kind` field: `forecast`, `modeled`, `reported`,
   `observed`, `estimated`/`modeled-estimate`, `simulated`. Label them
   in the UI with the stable warning IDs (e.g.
   `warning.historical-analog-not-forecast`).
3. Proximity to water is never access to water. Keep that sentence
   wherever distances are shown.
4. Canonical SI everywhere; convert only for display via `lib/units.ts`.
   Language (en/uz/ru) and units must never change a calculation.
5. The public Copilot is disabled (503). Build the UI shell if desired,
   but show an honest disabled state; do not fake AI responses.

## Entry flow (already built — preserve)

`app/page.tsx` renders the Registan entrance (`app/entrance/*`), which
is visually frozen. It session-gates repeat visits, supports
Skip/Replay and reduced motion, preloads the atlas during the intro,
then hands off to `AtlasExperience`. Keep this entry sequence.

## The map (already built — extend, don't restart)

`app/atlas/*` is the accepted direction: country-shaped R3F relief
(precomputed `public/data/uzbekistan-relief-v1.json`), paginated water
layers, GeoNames city markers, MapLibre farm drawing on Esri imagery,
geodesic area, and Analyze wired to the recommendation API.

Useful hooks that already exist:
- `window.__ariqRelief` exposes the loaded relief grid in the browser
  for overlays (elevations, mask, counts).
- Terrain/water data comes from `/api/water-data` — always page with
  `limit`/`offset` until `nextOffset` is null; show `truncated`
  honestly if you stop early.
- Nearest water: GET `/api/water-data/nearest?lat&lon&k` returns
  `distanceKind: 'point' | 'line-segment'`.

## Farm flow contract

1. Drawn polygon = GeoJSON `[lon, lat][]`, validated by
   `validateFarmPolygon` (bow-tie/bounds/area) in `app/atlas/geo.ts`.
2. Area from `geodesicAreaM2`; representative point MUST be
   `interiorPoint` (guaranteed inside, even for concave fields).
3. Analyze: POST `/api/irrigation/recommendation` with
   `{ latitude, longitude, areaHa, cropId, plantingDate }`.
   `applicationEfficiency` is optional — omit it unless the user
   supplies it; when omitted, gross m³ come back `null` (render "—",
   never a guessed number) and `missingInputs` explains why.
4. Render `missingInputs[]` verbatim as the "what's still needed" list.
   Render `provenance.weather.validThrough` as forecast validity.

## New science to surface

### Groundwater panel (scenario, clearly labelled)
POST `/api/groundwater`:
```json
{ "depthToWaterM": 1.4, "depthKind": "user-supplied-scenario",
  "rootDepthM": 0.6, "texture": "loam", "groundwaterEcDsM": 2.1 }
```
Returns capillary-rise low/mid/high (mm/day), waterlogging and salinity
risk with reasons, and warning IDs. `depthKind` must be chosen by the
user/source — the UI copy must say "scenario assumption" unless the user
entered a dated observation. Observation mode: `{ "observations": [...] }`
returns a trend of the supplied record only.

### Soil & fertility panel
POST `/api/soil-fertility` with `analysis`:
- `texture` {sandPct, clayPct, organicMatterPct} → modelled FC/WP.
  Offer "use as soil scenario" explicitly labelled modelled.
- `soil-test` {soilTest:{kind:'soil-test', measuredAt, ecDsM?, pH?, ...}}
  → salinity/pH classes.
- `balance` {cropId, yieldTPerHa, fertilizers[], irrigationWater?,
  manure?} → N/P2O5/K2O inputs vs removal with tendencies. Copy rule:
  "accounting, not a prescription" (warning IDs are returned).
- `leaching` {drainageMmSeason (from a season run), sandPct,
  nitrogenInputKgHa} → screening level + reason.

### Water Futures hookup
POST `/api/irrigation/season` (existing). New integrity behaviour:
cross-year analog seasons keep real provider dates; winter wheat Ky is
1.05; stage-product factors are clamped. Use `daily[].etLimitedByAvailableWater`
to explain hard-dry days if you visualise the balance.

## Freshness UI

GET `/api/data-refresh` (Next) or `/api/data-freshness` (Worker):
per-source `state` (`live | stale | never-updated | manual-review`),
`lastUpdated`, `measurementKind`, `sourceUrl`, `license`. Render
"Last updated" ONLY from `lastUpdated`; `manual-review` sources must not
show a fake timestamp.

## Cloudflare endpoints (same shapes)

The `ariq-api` Worker mirrors: `/api/calculate/plan`,
`/api/calculate/schedule`, `/api/groundwater`, `/api/soil-fertility`,
`/api/data-freshness`, `/api/health`. Prefer the shared pure modules in
a browser Web Worker for large interactive runs, and treat Worker/Next
results as the authoritative recomputation (identical code).

## i18n and units

- Stable message IDs already flow from the engines (`warning.*`,
  `factor.*`, crop IDs). Map them in `lib/i18n-labels.ts` style
  dictionaries for en/uz/ru; never key UI copy off English prose.
- `lib/units.ts` is the only place display conversion happens.

## Performance notes

- The relief is a single 245 KB static asset; do not reintroduce
  per-tile DEM fetching for the national view.
- Paginate water GeoJSON; national rivers alone exceed one page.
- Debounce slider-driven season calls; results are deterministic, so
  cache by input hash in the UI layer if needed.
- Keep the Registan entrance assets and motion untouched (separate
  worktree `ariq-registan`).

## A judge-pleasing idea worth building next

**"Water Passport" for a drawn farm**: one shareable card that combines
— with provenance on every line — the farm's geodesic area, forecast
demand tier, nearest documented water (distances labelled proximity),
a groundwater scenario (user-chosen depth, never faked), a soil
scenario (texture estimate or lab test), and a Water Futures snapshot.
Every number already exists in the APIs above; the magic is the
composition and honesty labelling. A close second: a national
"Morning Water Briefing" generated from the refresh registry —
forecast snapshot, freshness states and source links, zero invented
live reservoir data.
