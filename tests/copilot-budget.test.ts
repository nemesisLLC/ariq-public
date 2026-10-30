import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyBudget, budgetReserve, budgetReconcile, budgetStatus } from '../lib/copilot/budget-core.ts';
import { resolveCopilotConfig, costMicroUsd, reserveMicroUsd, STANDARD_MODEL, CONTRIBUTOR_MODEL } from '../lib/copilot/config.ts';
import { CopilotBudgetDO } from '../cloudflare/copilot-budget-do.ts';
import worker from '../cloudflare/worker.ts';

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

class FakeSql {
  rows: Record<string, unknown>[] = [];
  exec(query: string, ...params: unknown[]) {
    if (query.startsWith('SELECT')) return { toArray: () => this.rows };
    if (query.startsWith('INSERT')) this.rows = [{ payload: params[0] }];
    return { toArray: () => [] };
  }
}
const doPost = (d: CopilotBudgetDO, body: unknown) => d.fetch(new Request('https://budget/', { method: 'POST', body: JSON.stringify(body) }));
const CAPS = { totalMicroUsd: 5_000_000, dailyMicroUsd: 1_000_000 };

test('Durable Object: corrupt stored state fails closed and never resets to zero', async () => {
  const sql = new FakeSql();
  const d = new CopilotBudgetDO({ storage: { sql } } as never);
  const okRes = await doPost(d, { op: 'reserve', id: 'x1', amountMicroUsd: 700_000, caps: CAPS });
  assert.equal(okRes.status, 200);
  sql.rows = [{ payload: '{not json' }];
  const corrupt = await doPost(d, { op: 'reserve', id: 'x2', amountMicroUsd: 100, caps: CAPS });
  assert.equal(corrupt.status, 500); // fail closed; a zero-reset would have returned 200
  const status = await doPost(d, { op: 'status', caps: CAPS });
  assert.equal(status.status, 500);
  sql.rows = [{ payload: '{"totalSpentMicroUsd":"lots","daySpentMicroUsd":0,"reservations":{}}' }];
  assert.equal((await doPost(d, { op: 'status', caps: CAPS })).status, 500); // wrong shape also fails closed
});

test('Durable Object: concurrent reservations cannot overspend the daily cap', async () => {
  const d = new CopilotBudgetDO({ storage: { sql: new FakeSql() } } as never);
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => doPost(d, { op: 'reserve', id: `c${i}`, amountMicroUsd: 300_000, caps: CAPS })));
  const accepted = results.filter(r => r.status === 200).length;
  assert.equal(accepted, 3); // 3 x $0.30 <= $1 daily cap; the rest are refused
  const st = await (await doPost(d, { op: 'status', caps: CAPS })).json() as { daySpentMicroUsd: number };
  assert.equal(st.daySpentMicroUsd, 900_000);
});

function fakeBudgetStub(calls: { op: string; actualMicroUsd?: number }[], reserveOk = true) {
  return {
    idFromName: (n: string) => n,
    get: () => ({
      fetch: async (req: Request) => {
        const b = await req.json() as { op: string; actualMicroUsd?: number };
        calls.push(b);
        if (b.op === 'reserve') return new Response(JSON.stringify({ ok: reserveOk, reason: reserveOk ? null : 'daily-budget-exhausted' }), { status: reserveOk ? 200 : 429 });
        return new Response(JSON.stringify({ ok: true }));
      },
    }),
  };
}
const workerEnv = (stub: unknown) => ({ ARIQ_COPILOT_ENABLED: 'true', MODEL_API_KEY: 'test-key', COPILOT_BUDGET: stub }) as never;
const postCopilot = () => new Request('https://ariq.example/api/copilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'hi', language: 'en' }) });

test('worker: partial provider failure keeps the full reservation (no zero-cost refund)', async () => {
  const originalFetch = globalThis.fetch;
  let metaCalls = 0;
  globalThis.fetch = (async (url: unknown) => { if (String(url).includes('api.meta.ai')) { metaCalls++; return new Response('provider down', { status: 500 }); } return originalFetch(url as never); }) as typeof fetch;
  try {
    const calls: { op: string; actualMicroUsd?: number }[] = [];
    const res = await worker.fetch(postCopilot(), workerEnv(fakeBudgetStub(calls)), {} as never);
    assert.equal(res.status, 500); // provider failure surfaces as an error
    assert.ok(metaCalls >= 1);
    const reconcile = calls.find(c => c.op === 'reconcile');
    assert.ok(reconcile && (reconcile.actualMicroUsd ?? 0) > 0, 'failed requests must not reconcile to zero');
    assert.equal(reconcile!.actualMicroUsd, reserveMicroUsd(resolveCopilotConfig({})));
  } finally { globalThis.fetch = originalFetch; }
});

test('worker: budget exhaustion stops before any provider call', async () => {
  const originalFetch = globalThis.fetch;
  let metaCalls = 0;
  globalThis.fetch = (async (url: unknown) => { if (String(url).includes('api.meta.ai')) metaCalls++; return new Response('{}', { status: 200 }); }) as typeof fetch;
  try {
    const calls: { op: string }[] = [];
    const res = await worker.fetch(postCopilot(), workerEnv(fakeBudgetStub(calls, false)), {} as never);
    assert.equal(res.status, 429);
    assert.equal(metaCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('cost accounting uses published Standard pricing; reservation covers worst case', () => {
  // 1M input + 1M output on Standard = $1.25 + $4.25 = $5.50.
  assert.equal(costMicroUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, STANDARD_MODEL), 5_500_000);
  assert.equal(costMicroUsd(null, STANDARD_MODEL), 0);
  const cfg = resolveCopilotConfig({});
  const reserve = reserveMicroUsd(cfg);
  assert.ok(reserve > 0 && reserve < cfg.budgetDailyMicroUsd, `reserve ${reserve} must fit a meaningful number of requests per day`);
});
