# ARIQ Feature Systems — branded technology, honestly described

Product-facing names for what ARIQ actually built. No API or module
was renamed; these names group existing, tested systems for
presentation. Every claim below is bounded by the stated limitations.

---

## 1. ARIQ FieldDNA™ — every farm has a fingerprint
**One sentence**: FieldDNA reads a farm's location and assembles its
soil, water, climate and crop identity automatically — the farmer
draws a field; ARIQ does the science intake.
**Behind it**: Phase 1/2 soil intelligence (`lib/farm-intelligence.ts`,
`lib/soil-grid.ts`, `lib/data-intelligence/soil-grid.json`) — ISRIC
SoilGrids 2.0 at ~1 km with spherical polygon aggregation and
missing-data coverage, Saxton–Rawls water retention
(`lib/soil-fertility.ts`), documented water proximity, ERA5 climate
context, SIAT national statistics, and the unified assembler
`buildFarmProfile` (`lib/farm-profile.ts`).
**What's distinctive**: it refuses to stay silent about quality —
every value carries provenance, SoilGrids Q-ranges are labelled
cross-depth approximations, an independent Khorezm laboratory
validation (with its unfavourable discrepancy) travels with every
response, and unknowns (groundwater, current moisture, supply) are
returned as explicit unknowns, not filled in.
**Problem it solves**: farmers and agronomists normally need soil
maps, statistics portals and three spreadsheets before the first
useful number exists. FieldDNA makes it one selection.
**Limits / legitimate claims**: soil is a modelled prior, NOT a lab
result (regionally biased in Khorezm; lab test outranks it). Claim:
"best available modelled estimate with honest uncertainty", never
"measured soil".
**Say it live**: "Every field in Uzbekistan already has a scientific
fingerprint — soil, water, climate, risk. FieldDNA reads it in
seconds, and it tells you exactly how much to trust each line."

## 2. ARIQ FlowLogic™ — irrigation decisions with reasons
**One sentence**: FlowLogic turns weather, crop and soil into daily
irrigation demand, stress deadlines and — when water is short — a
fair allocation that explains itself.
**Behind it**: the FAO-56 engines (`lib/irrigation/scheduler.ts`,
`core.ts`) — Penman–Monteith ET0 (benchmarked to FAO Example 18),
Kc curves, Ks stress, deadline-aware greedy allocation under canal,
gate and supply constraints with binding-constraint explanations —
driven by live Open-Meteo forecasts through
`lib/irrigation/recommendation.ts`.
**What's distinctive**: an explicit, testable objective (minimise
priority-weighted unmet water), mass-conserving daily balance, and
the honesty rule that "impossible" means "this heuristic could not
schedule it", never a fake proof. Shortage is a first-class citizen:
who gets water, who doesn't, and why.
**Problem it solves**: irrigation by habit wastes water in wet weeks
and loses yield in dry ones; rationing without reasons breeds
conflict. FlowLogic gives timing, volumes and justifications.
**Limits / legitimate claims**: exact FAO arithmetic on modelled
inputs; needs farmer supply data for schedules, and assumes (never
invents) starting soil moisture. Claim: "FAO-56 decision support",
not "measured field state".
**Say it live**: "FlowLogic doesn't just say 'irrigate Tuesday'. It
says how much, by when, and — when the canal can't serve everyone —
who waits and exactly why."

## 3. ARIQ Water Futures — rehearse the season before living it
**One sentence**: Water Futures lets a farmer or planner replay their
crop season against real historical weather years and test drought,
evaporative-demand and rationing strategies side by side.
**Behind it**: `lib/irrigation/season.ts` + `season-weather.ts` —
full-season FAO-56 balance over ERA5 historical analog ensembles,
FAO-33 relative yield response, scenario comparison and sensitivity
ranking.
**What's distinctive**: scenarios are real past years at the farm's
own coordinates (labelled scenarios, never dressed as forecasts),
yield stays relative unless a farmer supplies a potential-yield
baseline, and ensemble spread is presented as spread — not dressed
up as a confidence interval.
**Problem it solves**: the cost of a wrong strategy is paid in
August; Water Futures moves the experiment to before planting.
**Limits / legitimate claims**: water-only yield effects (no pests,
nutrients, salinity); analog years are not predictions. Claim:
"strategy comparison under real historical weather", not "yield
forecast".
**Say it live**: "Before a farmer bets a season on a strategy, Water
Futures has already lived that season five times — in 2019's weather,
2021's drought, and the year the canal ran short."

## 4. ARIQ HydroAtlas™ — the verified water map of Uzbekistan
**One sentence**: HydroAtlas is ARIQ's evidence base of the nation's
water — 5,978 documented rivers, canals, reservoirs and structures
with sources, plus the official statistics layer.
**Behind it**: Feature 2/3 foundation (`lib/data-foundation.ts`,
`lib/water-sources.ts`, `lib/data-intelligence/siat-water.json`) —
OSM + CAWater inventories, SIAT Ministry of Water Resources series
(2013–2025), GeoJSON with honest pagination, line-aware proximity.
**What's distinctive**: provenance is structural — every record knows
whether it is observed, reported or modelled; design capacity is
never presented as today's storage; proximity never claims
connectivity or water rights.
**Problem it solves**: planners and farmers argue from rumours about
water infrastructure; HydroAtlas gives one cited, queryable truth.
**Limits / legitimate claims**: inventory and reported statistics,
not live levels or flows. Claim: "documented and cited", never
"real-time water availability".
**Say it live**: "Under every ARIQ answer sits HydroAtlas — every
major river, canal and reservoir we could verify, each with its
source attached. If we can't cite it, we don't show it as fact."

## 5. ARIQ GroundLens™ — honest groundwater scenarios
**One sentence**: GroundLens explores what a water table at a given
depth would mean — capillary contribution, waterlogging and salinity
risk — without ever pretending to know the depth beneath your farm.
**Behind it**: `lib/groundwater.ts` — FAO-56 balance with the
capillary-rise term, texture-range scenario parameters returned as
low/mid/high, FAO-29 salinity hazard, observation-trend fitting on
caller-supplied dated measurements.
**Problem it solves**: shallow saline groundwater silently shapes
Aral-basin farming; GroundLens makes the risk discussable with real
physics while the depth stays the farmer's or agency's number.
**Limits / legitimate claims**: scenario-grade only; no open
farm-level depth dataset exists and ARIQ returns `null` rather than
guess. Claim: "what-if intelligence", never "your groundwater is at
X metres".
**Say it live**: "GroundLens will never invent the water table under
your field. Give it a measured depth and it shows what that depth
does to your roots, your salts, and your season."

## 6. ARIQ TerraPulse™ — modelled soil moisture, with its doubts attached
**One sentence**: TerraPulse estimates how depleted a farm's root
zone is right now from ERA5-Land land-model reanalysis — as a
range that visibly moves irrigation deadlines.
**Behind it**: Phase 3 (`lib/irrigation/soil-moisture.ts`) —
ERA5-Land θ (0–100 cm, ~9 km) converted to a depletion fraction
against the farm's own FC/WP, ±0.05 m³/m³ uncertainty propagated into
wetter/central/drier scenarios run through FlowLogic.
**What's distinctive**: the uncertainty is the product: three engine
runs turn a stated sensitivity bracket into "stress between Thursday and
Sunday", and the known dry bias over irrigated land (the model has no
irrigation) is printed next to the number.
**Problem it solves**: the single most-skipped input in irrigation —
"how wet is my soil today?" — stops being a guess that blocks the
whole calculation.
**Limits / legitimate claims**: a 9 km modelled cell, days old, NOT a
measurement; local accuracy unverified (no open Uzbek in-situ
network). Claim: "modelled scenario with explicit timing range",
never "your soil moisture is X%".
**Say it live**: "TerraPulse turns a coarse land-model estimate into several
starting-water scenarios, and shows how those assumptions change stress
timing. Nine kilometres describes spatial resolution, never altitude.
A field measurement is still needed to establish actual moisture."

## 7. ARIQ Copilot — the conversation layer (access, not new science)
**One sentence**: Copilot lets a farmer ask questions in English,
Uzbek or Russian while every number still comes from the deterministic
systems above.
**Behind it**: Feature 6 (`lib/copilot/*`) — a gated Meta-model
orchestrator over validated tools and frontend actions; disabled
unless explicitly enabled with server credentials and budget gates.
**Limits**: it inherits every limit above and adds none of its own
numbers. Claim: "guided access to the engines", not "AI agronomist".
