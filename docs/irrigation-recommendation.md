# Location-based irrigation recommendation (Feature 4)

`POST /api/irrigation/recommendation` — for a farm anywhere in
Uzbekistan (coordinates are validated against the national extent;
there is no fixed city list). No frontend changes.

## Request

```json
{
  "latitude": 39.65, "longitude": 66.96,
  "cropId": "cotton",
  "areaHa": 2, "plantingDate": "2026-04-15", "applicationEfficiency": 0.75,
  "soil": { "fieldCapacity": 0.30, "wiltingPoint": 0.10, "rootDepthM": 0.5,
            "depletionFraction": 0.5, "initialDepletionMm": 50 },
  "supply": { "availableWaterM3": 5000, "sourceMaxFlowM3PerHour": 200,
              "canalMaxFlowM3PerHour": 150, "canalEfficiency": 0.9,
              "windowHoursPerDay": 8 }
}
```

- `cropId` is one of `cotton`, `winter-wheat`, `maize`, `alfalfa`,
  `tomato`, `potato`, `sunflower`, `melon` (FAO-56 Tables 11-12 typical
  Kc curves, cited per crop in
  [lib/irrigation/recommendation.ts](/lib/irrigation/recommendation.ts),
  not locally calibrated), or supply `kc` / `kcCurve` directly.
- `plantingDate` positions the Kc curve inside the forecast horizon
  (Feature 1 scheduler `kcStartDayIndex`).
- `soil` and `supply` are optional but never invented. The SoilGrids
  REST API is deliberately not used (provider-paused); no other soil
  source is substituted silently.

## Response tiers (`calculationTier`)

| Tier | When | Contains |
| --- | --- | --- |
| `demand-only` | Soil missing, or initial depletion unknown | Daily ETc/effective-rain deficit (no soil-storage accounting), `missingInputs` explains the rest |
| `demand-and-stress-no-schedule` | Soil complete, supply missing | Feature 1 outlook: depletion, Ks stress, first stress date, irrigation events with deadlines; `schedule: null` |
| `demand-stress-and-schedule` | Soil + full supply supplied | Feature 1 schedule (events, deliveries, totals) guaranteed on/before deadlines under the stated canal/supply/window limits |
| `not-yet-planted` | Planting after the 7-day forecast | No demand; reason stated |

Every response carries `provenance`: weather is `forecast` (Open-Meteo,
provider FAO-56 ET0, liquid rain + showers), crop coefficients are
`reference` or `user-supplied`, soil/supply are `user-supplied-assumed`
or `missing`, and the result is `simulated`. Measured soil moisture and
yield are always explicitly `false` — nothing here is measured.

## Weather retrieval, caching, failure

Forecasts reuse [lib/weather.ts](/lib/weather.ts) (`fetchWeather`,
7-day Open-Meteo forecast with units/grid validation) behind a 30-minute
in-memory cache keyed by coordinates rounded to 3 decimals
(`ForecastCache`). On provider failure a stale cached forecast is
served and marked `stale-after-failure`; with no cache the API returns
HTTP 502 with `kind: 'forecast-unavailable'` and structured
`missingInputs`. No weather is ever fabricated.

## Numerical consistency

Demand, depletion, stress and scheduling are computed by the Feature 1
scheduler (`calculateFieldOutlook` / `calculateSchedule` in
[lib/irrigation/scheduler.ts](/lib/irrigation/scheduler.ts)); tests in
[tests/recommendation.test.ts](/tests/recommendation.test.ts) assert
exact equality with direct scheduler calls, across regions (Samarkand,
Tashkent, Nukus), crops, drought and rainfall fixtures, mocked provider
downtime, cache behaviour, and invalid inputs.
