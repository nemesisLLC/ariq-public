/**
 * ARIQ Cloudflare Worker — bounded API surface (see docs/CLOUDFLARE_ARCHITECTURE.md).
 *
 * What runs here and why:
 * - Pure, deterministic scientific engines shared with the Next.js app
 *   (irrigation plan/schedule, groundwater, soil fertility). No Node APIs,
 *   small inputs with hard byte caps, JSON in/out. Heavy national datasets
 *   and 3D rendering stay out of the Worker (browser + static assets).
 * - A Cron Trigger refreshing the trusted-source registry into the Cache
 *   API (per-colo snapshot; freshness is reported honestly, never faked).
 * - The AI Copilot is DISABLED here (503) until an approved spending cap
 *   with persisted atomic enforcement exists.
 *
 * Secrets: none are required for this surface. META_API_KEY, if ever used,
 * must be added with `wrangler secret put` — never as a plain var.
 */
import { calculatePlan } from '../lib/irrigation/core.ts';
import { calculateSchedule } from '../lib/irrigation/scheduler.ts';
import { assessGroundwaterScenario, groundwaterTrend, type GroundwaterObservation } from '../lib/groundwater.ts';
import { estimateWaterRetention, classifySoilTest, nutrientBalance, leachingRisk, type SoilTestInput } from '../lib/soil-fertility.ts';
import { SOURCE_REGISTRY, refreshAll, freshnessReport, type RefreshStore, type Snapshot } from '../lib/data-refresh.ts';

type Env = Record<string, string | undefined> & { COPILOT_BUDGET?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } } };
// Minimal ambient shapes so the repo typecheck does not require
// @cloudflare/workers-types; wrangler supplies the real ones at runtime.
type ExecutionContext = { waitUntil: (p: Promise<unknown>) => void; passThroughOnException?: () => void };
type ScheduledController = { cron: string; scheduledTime: number; noRetry?: () => void };

const json = (data: unknown, status = 200, cache = 'no-store'): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new Error(`Request body exceeds ${maxBytes} bytes`);
  const text = await request.text();
  if (text.length > maxBytes) throw new Error(`Request body exceeds ${maxBytes} bytes`);
  try { return JSON.parse(text); } catch { throw new Error('Request body must be valid JSON'); }
}

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Calculation failed';
  const status = /exceeds|must|invalid|Invalid|required|unknown/i.test(message) ? 400 : 500;
  return json({ error: message }, status);
}

const snapshotKey = (id: string) => new Request(`https://ariq.internal/snapshots/${id}`);
async function readSnapshots(): Promise<Map<string, Snapshot>> {
  const cache = (caches as unknown as { default: Cache }).default;
  const snapshots = new Map<string, Snapshot>();
  for (const s of SOURCE_REGISTRY) {
    const hit = await cache.match(snapshotKey(s.id));
    if (hit) snapshots.set(s.id, (await hit.json()) as Snapshot);
  }
  return snapshots;
}
async function writeSnapshot(s: Snapshot): Promise<void> {
  const cache = (caches as unknown as { default: Cache }).default;
  await cache.put(snapshotKey(s.sourceId), new Response(JSON.stringify(s), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' } }));
}

export default {
  async fetch(request: Request, _env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') {
        return json({ ok: true, runtime: 'cloudflare-workers', service: 'ariq-api', time: new Date().toISOString(), registrySources: SOURCE_REGISTRY.length }, 200, 'public, max-age=60');
      }
      if (url.pathname === '/api/data-freshness' && request.method === 'GET') {
        const snapshots = await readSnapshots();
        const view: RefreshStore = { get: (id) => snapshots.get(id) ?? null, set: () => {} };
        return json({ kind: 'data-freshness', generatedAt: new Date().toISOString(), sources: freshnessReport(view, Date.now()) });
      }
      if (url.pathname === '/api/copilot' && request.method === 'GET') {
        // Public status probe: never invokes the model, never spends.
        const { resolveCopilotConfig } = await import('../lib/copilot/config.ts');
        const config = resolveCopilotConfig(_env);
        let budget: unknown = null;
        if (_env.COPILOT_BUDGET) {
          try {
            const stub = _env.COPILOT_BUDGET.get(_env.COPILOT_BUDGET.idFromName('global'));
            const r = await stub.fetch(new Request('https://budget/status', { method: 'POST', body: JSON.stringify({ op: 'status', caps: { totalMicroUsd: config.budgetTotalMicroUsd, dailyMicroUsd: config.budgetDailyMicroUsd } }) }));
            if (r.ok) budget = await r.json();
          } catch { /* status only; POST still fails closed */ }
        }
        return json({ kind: 'copilot-status', available: config.enabled && !!config.apiKey && !!_env.COPILOT_BUDGET, model: config.model, contributor: config.contributor, budget });
      }
      if (url.pathname === '/api/copilot') {
        // Budget-enforced Meta Copilot. Fails closed at every layer:
        // unified config off, no server key, or no budget object => 503
        // and NO model call. Reservation precedes any provider request;
        // reconciliation uses actual token usage from the response.
        const { resolveCopilotConfig, reserveMicroUsd, costMicroUsd } = await import('../lib/copilot/config.ts');
        const config = resolveCopilotConfig(_env);
        if (!config.enabled || !config.apiKey || !_env.COPILOT_BUDGET) {
          return json({ error: 'The AI Copilot is unavailable: it requires explicit enablement, a server-side Meta key and the budget object.', kind: 'copilot-disabled' }, 503);
        }
        const caps = { totalMicroUsd: config.budgetTotalMicroUsd, dailyMicroUsd: config.budgetDailyMicroUsd };
        const stub = _env.COPILOT_BUDGET.get(_env.COPILOT_BUDGET.idFromName('global'));
        const reservationId = `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        const reserved = await stub.fetch(new Request('https://budget/reserve', { method: 'POST', body: JSON.stringify({ op: 'reserve', id: reservationId, amountMicroUsd: reserveMicroUsd(config), caps }) }));
        if (!reserved.ok) {
          const why = await reserved.json().catch(() => null) as { reason?: string } | null;
          return json({ error: 'The Copilot usage budget is exhausted. Deterministic ARIQ tools remain available.', kind: 'copilot-budget-exhausted', reason: why?.reason ?? 'budget' }, 429);
        }
        try {
          const { runCopilot } = await import('../lib/copilot/orchestrator.ts');
          const body = await readBoundedJson(request, 16384);
          const result = await runCopilot(body, { apiKey: config.apiKey, enabled: true, model: config.model, maxModelCalls: config.maxModelCalls, maxToolCalls: config.maxToolCalls }) as { usage?: { totalUsage?: { inputTokens: number; cachedTokens: number; outputTokens: number } } };
          const actual = costMicroUsd(result.usage?.totalUsage, config.model);
          await stub.fetch(new Request('https://budget/reconcile', { method: 'POST', body: JSON.stringify({ op: 'reconcile', id: reservationId, actualMicroUsd: actual }) }));
          return json({ ...result, budget: { model: config.model, contributor: config.contributor, reconciledMicroUsd: actual } });
        } catch (error) {
          await stub.fetch(new Request('https://budget/reconcile', { method: 'POST', body: JSON.stringify({ op: 'reconcile', id: reservationId, actualMicroUsd: 0 }) })).catch(() => {});
          throw error;
        }
      }
      if (request.method === 'POST' && url.pathname === '/api/calculate/plan') {
        return json(calculatePlan(await readBoundedJson(request, 65536)));
      }
      if (request.method === 'POST' && url.pathname === '/api/calculate/schedule') {
        return json(calculateSchedule(await readBoundedJson(request, 131072)));
      }
      if (request.method === 'POST' && url.pathname === '/api/groundwater') {
        const body = (await readBoundedJson(request, 16384)) as Record<string, unknown>;
        if (Array.isArray(body.observations)) return json({ kind: 'groundwater-observation-trend', trend: groundwaterTrend(body.observations as GroundwaterObservation[]) });
        if (body.depthKind !== 'observed' && body.depthKind !== 'historical' && body.depthKind !== 'reported' && body.depthKind !== 'user-supplied-scenario') {
          return json({ error: 'depthKind must name the evidence kind of the supplied depth.' }, 400);
        }
        return json({ kind: 'groundwater-scenario-assessment', ...assessGroundwaterScenario(body as never) });
      }
      if (request.method === 'POST' && url.pathname === '/api/soil-fertility') {
        const body = (await readBoundedJson(request, 16384)) as Record<string, never>;
        switch (body.analysis) {
          case 'texture': return json({ ...estimateWaterRetention(body as never), kind: 'soil-texture-estimate' });
          case 'soil-test': return json({ kind: 'soil-test-classification', ...classifySoilTest(((body as unknown) as { soilTest: SoilTestInput }).soilTest) });
          case 'balance': return json(nutrientBalance(body as never));
          case 'leaching': return json({ ...leachingRisk(body as never), kind: 'leaching-risk' });
          default: return json({ error: 'analysis must be one of texture, soil-test, balance, leaching.' }, 400);
        }
      }
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not found on the Worker API surface. The full application API remains in the Next.js app.' }, 404);
      return json({ error: 'ariq-api serves /api/* only; the website is served by the Next.js app / Static Assets.' }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  },

  async scheduled(_event: ScheduledController, _env: Env, ctx: ExecutionContext): Promise<void> {
    // Refresh the registry into per-colo cache snapshots. Failures keep the
    // last verified snapshot (handled inside refreshSource).
    const snapshots = await readSnapshots();
    const store: RefreshStore = {
      get: (id) => snapshots.get(id) ?? null,
      set: (s) => { snapshots.set(s.sourceId, s); },
    };
    const outcomes = await refreshAll({ store });
    for (const o of outcomes) {
      if (o.status === 'updated') ctx.waitUntil(writeSnapshot(o.snapshot));
    }
  },
};
