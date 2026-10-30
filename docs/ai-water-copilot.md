# AI Water Copilot (Feature 6)

`POST /api/copilot` — Meta-powered agent over ARIQ's deterministic
engines. Implementation: [lib/copilot/orchestrator.ts](/lib/copilot/orchestrator.ts),
tools: [lib/copilot/tools.ts](/lib/copilot/tools.ts), actions:
[lib/copilot/actions.ts](/lib/copilot/actions.ts). The pre-existing
investigation agent (`lib/irrigation/agent.ts`, uncommitted work) and
Meta explanation module are preserved unchanged; the copilot reuses
their patterns (server-side `MODEL_API_KEY` + `ARIQ_AI_ENABLED`,
`muse-spark-1.3` Responses API, prose validation) without duplicating
them.

## Request

```json
{ "question": "What happens if rainfall drops by 30% for my cotton near Bukhara?",
  "language": "en", "units": "metric",
  "context": { "latitude": 39.77, "longitude": 64.43, "cropId": "cotton", "areaHa": 5, "plantingDate": "2026-04-15" },
  "permittedTools": ["compare_drought_strategies", "search_water_sources"] }
```

`language` is `en` | `uz` | `ru`; `units` is `metric` | `us` (display
only — all tools compute in canonical SI and results are identical).
`permittedTools` restricts the model's tool set per request.

## Tools (backend-validated, deterministic)

| Tool | Engine reused |
| --- | --- |
| `search_water_sources` | Feature 3 foundation search (Feature 2 records included) |
| `nearby_water_sources` | Feature 3 nearest features — always labelled proximity ≠ water access |
| `regional_water_history` | Feature 3 series (ERA5 modeled, reported statistics) |
| `irrigation_recommendation` | Feature 4 recommendation (forecast, tiered missing-input results) |
| `season_simulation` | Feature 5 ensemble over ERA5 analog years |
| `compare_drought_strategies` | Feature 5 baseline vs drought plus efficiency/frequency alternatives on one analog year |

Arguments are re-validated server-side (coordinates inside Uzbekistan,
supported crops, bounded years/limits/supplies). Non-permitted,
malformed, or unsafe calls are rejected and recorded in `trace`; the
question and context are treated as data, not instructions.

## Response and frontend actions

`{ kind, model, language, units, explanation, toolResults, actions,
trace, usage, partial, warnings }`. All numbers come from tool outputs;
model prose is validated (correct language, no digits, no URLs) and
discarded to a safe partial if it violates policy.

Actions are built by the backend from tool results — the model never
authors coordinates or ids — and each passes
`validateFrontendAction` before returning:

`flyToLocation` · `highlightWaterSources` · `displayForecast` ·
`displayIrrigationSchedule` · `showScenarioComparison` ·
`animateSeasonTimeline` · `displayYieldImpact` · `showSourceEvidence`

Types are exported from [lib/copilot/actions.ts](/lib/copilot/actions.ts)
for Codex to render on the future 3D map. No frontend was built.

## Reliability and budgets

- Per-request limits: 4 model calls, 8 tool calls (configurable in
  tests); process-wide Meta allowance of 30 calls; 25 s timeout per
  Meta call; tool outputs truncated before being returned to the model.
- Disabled or missing credentials return 503 while deterministic ARIQ
  APIs keep working. Model/provider failures and timeouts return 502
  with the same note. Missing farm inputs produce partial tool results
  (Feature 4 tiers), not invented values.

## Live verification (2026-10-27)

With the server's configured credentials, a bounded live smoke run
(real Meta API, `muse-spark-1.3`, max 3 model/tool calls) selected
`search_water_sources` and `nearby_water_sources` for a Samarkand farm
question, executed both deterministically, and returned validated
prose plus `flyToLocation` / `highlightWaterSources` /
`showSourceEvidence` actions in 2 model calls. Two earlier bounded
runs exposed real integration bugs that were fixed (empty tool
arguments → full per-tool schemas; unstructured prose → strict JSON
schema for the final answer). Automated tests use mocked Meta
responses and do not depend on the live API.
