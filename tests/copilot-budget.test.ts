import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBudget, budgetReserve, budgetReconcile, budgetStatus } from '../lib/copilot/budget-core.ts';
import { resolveCopilotConfig, costMicroUsd, reserveMicroUsd, STANDARD_MODEL, CONTRIBUTOR_MODEL } from '../lib/copilot/config.ts';

const DAY = '2026-10-30';
const caps = { totalMicroUsd: 1000, dailyMicroUsd: 400 };

test('budget reserves atomically, rejects overspend, and reconciles to actual cost', () => {
  let s = emptyBudget(DAY);
  const r1 = budgetReserve(s, caps, 'a', 300, DAY); assert.equal(r1.ok, true); s = r1.state;
  // Concurrent-style second reservation that would exceed the daily cap fails.
  const r2 = budgetReserve(s, caps, 'b', 200, DAY); assert.equal(r2.ok, false); assert.equal(r2.reason, 'daily-budget-exhausted');
  // Replay of the same reservation id is idempotent, not double-charged.
  const replay = budgetReserve(s, caps, 'a', 300, DAY); assert.equal(replay.ok, true); assert.equal(replay.state.totalSpentMicroUsd, 300);
  // Reconcile down to the real (smaller) cost.
  s = budgetReconcile(s, 'a', 40);
  const st = budgetStatus(s, caps, DAY);
  assert.equal(st.totalSpentMicroUsd, 40); assert.equal(st.openReservations, 0);
  // Failed requests reconcile to zero and release the hold entirely.
  const r3 = budgetReserve(s, caps, 'c', 350, DAY); assert.equal(r3.ok, true); s = budgetReconcile(r3.state, 'c', 0);
  assert.equal(budgetStatus(s, caps, DAY).totalSpentMicroUsd, 40);
});

test('budget day rollover resets only the daily counter', () => {
  let s = emptyBudget(DAY);
  s = budgetReserve(s, caps, 'a', 400, DAY).state;
  const st = budgetStatus(s, caps, '2026-10-31');
  assert.equal(st.daySpentMicroUsd, 0); assert.equal(st.totalSpentMicroUsd, 400);
});

test('config unification: flags, key names, contributor gating, conservative defaults', () => {
  assert.equal(resolveCopilotConfig({}).enabled, false);
  assert.equal(resolveCopilotConfig({ ARIQ_AI_ENABLED: 'true' }).enabled, true); // legacy alias
  assert.equal(resolveCopilotConfig({ ARIQ_COPILOT_ENABLED: 'false', ARIQ_AI_ENABLED: 'true' }).enabled, false); // explicit wins
  assert.equal(resolveCopilotConfig({ MODEL_API_KEY: 'k' }).apiKey, 'k');
  assert.equal(resolveCopilotConfig({ META_API_KEY: 'k2' }).apiKey, 'k2');
  const standard = resolveCopilotConfig({});
  assert.equal(standard.model, STANDARD_MODEL);
  assert.equal(standard.budgetTotalMicroUsd, 5_000_000); // $5 hard default
  assert.equal(standard.budgetDailyMicroUsd, 1_000_000); // $1/day
  // Contributor silently requested without approval falls back to Standard.
  assert.equal(resolveCopilotConfig({ COPILOT_MODEL: CONTRIBUTOR_MODEL }).model, STANDARD_MODEL);
  const demo = resolveCopilotConfig({ COPILOT_MODEL: CONTRIBUTOR_MODEL, COPILOT_ALLOW_CONTRIBUTOR: 'true' });
  assert.equal(demo.model, CONTRIBUTOR_MODEL); assert.equal(demo.contributor, true);
});

test('cost accounting uses published Standard pricing; reservation covers worst case', () => {
  // 1M input + 1M output on Standard = $1.25 + $4.25 = $5.50.
  assert.equal(costMicroUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, STANDARD_MODEL), 5_500_000);
  assert.equal(costMicroUsd(null, STANDARD_MODEL), 0);
  const cfg = resolveCopilotConfig({});
  const reserve = reserveMicroUsd(cfg);
  assert.ok(reserve > 0 && reserve < cfg.budgetDailyMicroUsd, `reserve ${reserve} must fit a meaningful number of requests per day`);
});
