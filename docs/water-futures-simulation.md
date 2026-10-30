# Water Futures: season simulation and yield-impact engine (Feature 5)

API: `POST /api/irrigation/season`. Engine:
[lib/irrigation/season.ts](/lib/irrigation/season.ts), historical weather:
[lib/irrigation/season-weather.ts](/lib/irrigation/season-weather.ts),
demos: [lib/irrigation/season-demos.ts](/lib/irrigation/season-demos.ts).
No frontend was built.

## Scientific basis and what this is not

| Reference | Used for |
| --- | --- |
| FAO-56 (Allen et al. 1998), Ch. 8 | ETc = Kc·ET0, Ks stress (Eqs. 81/84), TAW/RAW (82/83), daily balance (85) — reusing Feature 1 functions |
| FAO-33 (Doorenbos & Kassam 1979) via FAO-66 (Steduto et al. 2012, *Crop yield response to water*), Table 1 | Seasonal Ky: cotton 0.85, winter wheat 1.15, maize 1.25, alfalfa 1.1, tomato 1.05, potato 1.1, sunflower 0.95, watermelon 1.1 (melon proxy, labelled) |
| FAO AquaCrop (methodology review only) | Architecture contrast: AquaCrop simulates canopy growth, biomass and harvest index daily. **This engine is not AquaCrop** and makes no such claims |
| Open-Meteo Historical Weather API (ERA5) | Historical analog years: modeled reanalysis, labelled `historical-analog`, never a long-range forecast |

AquaCrop licensing note: AquaCrop v7 core Fortran is distributed by FAO
as open source via GitHub (KULeuven/FAO), and AquaCrop-OS exists
separately. ARIQ deliberately does not embed a Fortran/Python service:
the FAO-33 method is implementable exactly in the existing TypeScript
engine, deterministic and testable, with no new runtime dependency.

## Model

Daily, per crop stage (FAO-56 Kc curve from Feature 4): Ks from
start-of-day depletion, ETa = Ks·Kc·ET0, effective rain = rain ×
retention, irrigation triggered before projected depletion passes RAW
(refill to target), limited by season supply, per-event cap and a
minimum interval (frequency). Drainage above field capacity leaves the
root zone; depletion is clamped to [0, TAW] and mass balance is tested.

Yield impact (water only): `Ya/Ym = 1 − Ky·(1 − ETa/ETm)` seasonally,
or the stage-product form `Π(1 − Kyi·(1 − ETai/ETmi))` **only** when the
caller supplies `kyByStage`. Built-in stage output is vulnerability
from simulated stage ET deficit and stress days — model-derived, not
FAO stage Ky. Tonnes/hectare appear only when the caller supplies
`potentialYieldTPerHa`; otherwise percentages/relative indices only.
Nutrients, disease, pests, salinity, heat injury and management are
excluded by construction and stated in every result.

What-if inputs: `rainFactor`, `et0Factor` (temperature is represented
only through this labelled simplified ET0 sensitivity — no
Penman-Monteith recalculation without full meteorology), season supply
and supply reductions, irrigation frequency, application efficiency,
planting date (weather/Kc alignment), and crop choice. Comparisons
return before/after deltas for demand, irrigation, stress, unmet water
and relative yield.

Uncertainty: ensembles over supplied historical analog years with
10th/50th/90th ordered outcomes, explicitly "scenario spread, not a
statistically calibrated confidence interval". One-at-a-time
sensitivity ranks rainfall, heat (ET0), efficiency, frequency and
supply factors deterministically.

Basic inputs (location, crop, area, planting date) run on an
illustrative loam reference preset and 0.65 efficiency, both labelled
`illustrative-reference`/`assumed` in output and never described as the
farmer's field. Advanced inputs override them.

## Units and languages

All math is canonical SI. [lib/units.ts](/lib/units.ts) centralizes
ha↔acres, mm↔inches, °C↔°F, m³↔US gallons, t/ha↔lb/acre with round-trip
tests; display conversion cannot change results. Stable ids
(`crop.*`, `metric.*`, `warning.*`, `scenario.*`, `factor.*`) localize
through [lib/i18n-labels.ts](/lib/i18n-labels.ts) in English, Uzbek and
Russian; tests assert every emitted warning code has all three labels.

## Demo scenarios (reproducible, labelled synthetic fixtures)

1. `demo.samarkand-cotton-drought` — Samarkand cotton, rain ×0.7 +
   supply −40% vs baseline.
2. `demo.karakalpakstan-maize-supply-cut` — Nukus-area maize, supply
   −40% + 14-day frequency under a hot spell.
3. `demo.fergana-wheat-rainfall` — Fergana winter wheat, rain ×1.2.

They run in tests; fixtures are ERA5-shaped synthetic series with
assumptions listed per demo, not measured regional seasons.

## Limitations (honest)

- FAO-33 is an empirical seasonal relation, far simpler than AquaCrop:
  no canopy/biomass dynamics, no CO2, fertility, salinity, or pest
  effects; Ky values are literature references requiring local
  validation before agronomic decisions.
- Daily bucket soil model: no infiltration-rate limits, runoff dynamics,
  groundwater, capillary rise, or salinity (inherited FAO-56 simplified
  balance from Feature 1).
- Irrigation is credited the day it is triggered; canal hydraulics and
  delivery windows within the season are represented only by supply,
  frequency and event caps (Feature 1 handles dated delivery windows on
  the 7-day horizon).
- ERA5 analog years are reanalysis at a grid point, not farm weather
  stations; ensemble spread reflects those years only.
- Stage Ky product form requires caller-supplied stage Ky; the shipped
  vulnerability ranking is simulated stress exposure, not measured
  stage sensitivity.
