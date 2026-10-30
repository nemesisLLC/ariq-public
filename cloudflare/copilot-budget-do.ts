/**
 * CopilotBudgetDO — the hard, global, atomic spending allowance for the
 * Meta Copilot. One named instance ("global") serializes every reservation,
 * so concurrent Worker isolates/regions cannot overspend. State lives in
 * the object's SQLite storage (durable, free-tier friendly).
 *
 * Protocol (POST JSON):
 *  {op:'reserve', id, amountMicroUsd, caps}   -> {ok, reason?}
 *  {op:'reconcile', id, actualMicroUsd}       -> {ok:true}
 *  {op:'status', caps}                        -> budgetStatus(...)
 * Fails closed: any storage error surfaces as HTTP 500 and callers must
 * refuse the model call.
 */
import { emptyBudget, budgetReserve, budgetReconcile, budgetStatus, type BudgetState, type BudgetCaps } from '../lib/copilot/budget-core.ts';

// Minimal ambient Durable Object shapes (repo typecheck avoids
// @cloudflare/workers-types; wrangler supplies the real runtime).
type SqlStorage = { exec(query: string, ...params: unknown[]): { toArray(): Record<string, unknown>[] } };
type DOState = { storage: { sql: SqlStorage } };

const day = () => new Date().toISOString().slice(0, 10);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export class CopilotBudgetDO {
  private state: DOState;
  constructor(state: DOState) {
    this.state = state;
    this.state.storage.sql.exec('CREATE TABLE IF NOT EXISTS budget (id INTEGER PRIMARY KEY CHECK (id=1), payload TEXT NOT NULL)');
  }
  private load(): BudgetState {
    const rows = this.state.storage.sql.exec('SELECT payload FROM budget WHERE id=1').toArray();
    if (!rows.length) return emptyBudget(day());
    try { return JSON.parse(rows[0].payload as string) as BudgetState; } catch { return emptyBudget(day()); }
  }
  private save(s: BudgetState) {
    this.state.storage.sql.exec('INSERT INTO budget (id,payload) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', JSON.stringify(s));
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const body = await request.json() as { op?: string; id?: string; amountMicroUsd?: number; actualMicroUsd?: number; caps?: BudgetCaps };
      const caps = body.caps ?? { totalMicroUsd: 5_000_000, dailyMicroUsd: 1_000_000 };
      if (body.op === 'status') return json(budgetStatus(this.load(), caps, day()));
      if (body.op === 'reserve' && body.id && typeof body.amountMicroUsd === 'number') {
        const r = budgetReserve(this.load(), caps, body.id, Math.round(body.amountMicroUsd), day());
        this.save(r.state);
        return json({ ok: r.ok, reason: r.reason ?? null }, r.ok ? 200 : 429);
      }
      if (body.op === 'reconcile' && body.id) {
        this.save(budgetReconcile(this.load(), body.id, body.actualMicroUsd ?? 0));
        return json({ ok: true });
      }
      return json({ error: 'unknown budget operation' }, 400);
    } catch {
      return json({ error: 'budget storage unavailable' }, 500);
    }
  }
}
