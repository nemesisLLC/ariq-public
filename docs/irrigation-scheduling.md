# Advanced irrigation scheduling (Feature 1)

Status: implemented as `ariq-irrigation-v2` in
[lib/irrigation/scheduler.ts](/lib/irrigation/scheduler.ts), exposed at
`POST /api/irrigation/schedule`. The existing `ariq-irrigation-v1` volume
planner in [lib/irrigation/core.ts](/lib/irrigation/core.ts) is unchanged.
Everything produced by either engine is a **simulation** from supplied
inputs (`kind: 'simulation'` is enforced at runtime). Neither engine
measures a field, a canal, or a water supply, and no result here is a
water-saving or yield claim.

## Scientific sources

| Source | What is used | What is not claimed |
| --- | --- | --- |
| FAO Irrigation and Drainage Paper 56, Allen et al. (1998), [contents](https://www.fao.org/4/X0490E/x0490e00.htm) | Penman-Monteith ET0 (Ch. 2), crop coefficients and Kc curve (Ch. 5-6), soil-water availability and stress (Ch. 8) | No locally calibrated Kc, soil, or yield parameters |
| FAO CROPWAT 8.0, [FAO Land & Water](https://www.fao.org/land-water/databases-and-software/cropwat/en/) | Scheduling structure: daily soil-water balance under user-defined supply and management conditions | ARIQ is not CROPWAT and does not reproduce CROPWAT outputs |

Machine-readable copies of these citations, with limits, live in
[lib/irrigation/evidence.ts](/lib/irrigation/evidence.ts).

## Equations (FAO-56 numbering)

- Reference evapotranspiration, FAO Penman-Monteith (Eq. 6), daily step
  with soil heat flux G ≈ 0:
  `ET0 = [0.408·Δ·(Rn − G) + γ·(900/(T+273))·u2·(es − ea)] / [Δ + γ·(1 + 0.34·u2)]`
  with saturation vapour pressure (Eq. 11), mean saturation pressure
  (Eq. 12), slope Δ (Eq. 13), actual vapour pressure from dewpoint or
  RHmax/RHmin (Eq. 17), atmospheric pressure (Eq. 7), psychrometric
  constant γ (Eq. 8), extraterrestrial radiation Ra (Eqs. 21, 23-25),
  clear-sky radiation Rso (Eq. 37), net shortwave (Eq. 38) and net
  longwave (Eq. 39). Caller-supplied ET0 is also accepted; the two paths
  are never mixed within a day.
- Crop demand under standard conditions (Eq. 58): `ETc = Kc · ET0`.
  Kc is either constant or a Chapter 6 Kc curve (constant initial stage,
  linear development, constant mid-season, linear late season), starting
  on the first weather date.
- Soil water (Eqs. 82-83): `TAW = 1000·(θFC − θWP)·Zr`, `RAW = p · TAW`.
- Stress (Eqs. 81, 84): `Ks = 1` for `Dr ≤ RAW`;
  `Ks = (TAW − Dr)/(TAW − RAW)` for `RAW < Dr < TAW`; `0` at TAW.
  Adjusted demand: `ETc adj = Ks · Kc · ET0` (single-coefficient form).
- Daily root-zone balance (Eq. 85, simplified): 
  `Dr,end = clamp(Dr,start + ETc adj − effective rain − irrigation, 0, TAW)`.
  Water above field capacity drains the same day. No capillary rise,
  groundwater, runoff dynamics, infiltration-rate limit, or salinity.

Effective precipitation is `rain · rainRetentionFraction`, an explicit
caller scenario assumption. CROPWAT's USDA-SCS effective-rainfall formula
is a monthly relation and is deliberately **not** applied at a daily step.

## Scheduling model and objective

1. A no-irrigation trajectory per field tracks depletion, Ks and stress
   days, and reports the first date projected depletion exceeds RAW.
2. Irrigation events are generated from a timely-irrigation trajectory:
   on the first day projected depletion would exceed RAW, an event with
   that date as its **deadline** refills depletion to the target fraction.
3. Events are allocated by a deterministic greedy heuristic — explicitly
   **not** a claimed global optimum. Order: deadline ascending, then
   priority descending, then field id, then event sequence. Each event is
   filled as late as feasible on or before its deadline (latest-first
   avoids draining water applied too early), subject to: total supply,
   optional daily supply, serial gate time per day
   (`windowHoursPerDay`, one gate at a time), per-canal daily capacity
   (`maxFlow · window`), canal volume limits, permanent and dated canal
   closures, source flow, and conveyance losses along the field's route.
   Deliveries after a deadline are never scheduled.
4. Reported objective value: 
   `weightedUnmetPriorityM3 = Σ priority · unmet gate m³` (lower is
   better under this stated objective). Per-event `bindingConstraints`
   name what blocked delivery, e.g. `source-supply`,
   `gate-window-before-deadline`, `canal-capacity:<id>`,
   `canal-volume-limit:<id>`, `canal-closure:<id>`, `closed-route:<id>`,
   `daily-supply-limit`.
5. The scheduled trajectory is re-simulated with actual deliveries, so
   predicted stress days, minimum Ks and cumulative `Σ(1 − Ks)` reflect
   the schedule rather than the ideal demand.

Priorities are user preferences for ordering under scarcity. They do not
establish agronomic or economic optimality.

## Reproducible comparison with the previous implementations

Scenario: two 1 ha fields (a: priority 1, b: priority 2), Kc 1.1,
application efficiency 0.75, canal efficiency 0.85, soil TAW 100 mm /
RAW 50 mm starting at 50 mm depletion, 7 days at ET0 6 mm/day, rain
retention 0.8, source 200 m³/h, gate window 8 h/day. Legacy is
[lib/planner.ts](/lib/planner.ts) `allocate()` fed the v2 gross demands;
v1 is `calculatePlan()` over one pooled 56 h window. Reproduce with the
fixtures in [tests/advanced-scheduler.test.ts](/tests/advanced-scheduler.test.ts).

| Scenario | Legacy allocate() | v1 volume plan | v2 deadline scheduler |
| --- | --- | --- | --- |
| Ample supply | 1856 m³ split, no losses/deadlines | 1856 m³ gate, 2183.5 m³ source, deadlines unchecked (own warning) | 1856 m³ gate, 0 after deadline, 0 scheduled stress days (12 without irrigation) |
| Supply 600 m³ | 598 m³ (integer rounding), no losses/deadlines | 510 m³ gate, 1346 m³ unmet | 510 m³ gate, 1346 m³ unmet, priority field b served first, 7 scheduled stress days, reasons reported |
| Branch to b closed | 1856 m³ (closure invisible) | 928 m³ gate, b unmet | 928 m³ gate, b events `impossible-before-deadline`, 0 after deadline |
| 25 mm rain on day 3 | 976 m³ | 976 m³ gate, deadlines unchecked | 976 m³ gate, second events removed by rain, 0 scheduled stress days |

Reading: v1 and v2 agree on volumes when a pooled window happens to be
feasible; they differ in what is guaranteed. Only v2 enforces per-day
windows, dated closures, and deadlines, and predicts stress under the
actual schedule. Legacy `allocate()` ignores soil, canals, losses and
dates entirely. These are model-behaviour differences on synthetic
fixtures — **not** measured water savings or yield effects.

## Limitations

- Serial (one-gate-at-a-time) scheduling is conservative; no concurrent
  hydraulics, travel time, or canal routing is simulated.
- Daily step: intraday timing is an hour offset inside the delivery day
  only. Irrigation is credited to the root zone on its delivery day.
- Ks-adjusted ET reduces modelled demand under stress; it is an FAO-56
  stress indicator, not a yield model. No yield response (Ky) is computed.
- All Kc, soil, efficiency, priority, supply and network values are
  caller assumptions requiring local justification.

## Running

```text
npm test            # includes tests/advanced-scheduler.test.ts
npm run typecheck
npm run build
```
