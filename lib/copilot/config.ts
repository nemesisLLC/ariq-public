/**
 * Single Copilot configuration path.
 *
 * Historically two flag names (ARIQ_COPILOT_ENABLED / ARIQ_AI_ENABLED) and
 * two key names (META_API_KEY / MODEL_API_KEY) drifted apart. This resolver
 * is the only place that reads them: the explicit Copilot flag wins, the
 * legacy AI flag is honoured, and either key name works.
 *
 * Model policy: Meta Muse Spark Standard (`muse-spark-1.3`) by default —
 * real farm data never goes to Contributor mode, whose discount permits
 * training use. Contributor is only selectable when explicitly configured
 * AND COPILOT_ALLOW_CONTRIBUTOR=true (approved non-sensitive demos only).
 */
export type CopilotConfig = {
  enabled: boolean;
  apiKey: string | null;
  model: string;
  contributor: boolean;
  budgetTotalMicroUsd: number;
  budgetDailyMicroUsd: number;
  maxModelCalls: number;
  maxToolCalls: number;
};

export const STANDARD_MODEL = 'muse-spark-1.3';
export const CONTRIBUTOR_MODEL = 'muse-spark-1.3-contributor';

/** Published Meta Model API pricing, USD per 1M tokens (checked 2026-10). */
export const PRICING: Record<string, { input: number; cached: number; output: number }> = {
  [STANDARD_MODEL]: { input: 1.25, cached: 0.15, output: 4.25 },
  [CONTRIBUTOR_MODEL]: { input: 0.10, cached: 0.002, output: 0.20 },
};

export function costMicroUsd(usage: { inputTokens?: number; cachedTokens?: number; outputTokens?: number } | null | undefined, model: string): number {
  if (!usage) return 0;
  const p = PRICING[model] ?? PRICING[STANDARD_MODEL];
  const input = usage.inputTokens ?? 0, cached = Math.min(usage.cachedTokens ?? 0, input), out = usage.outputTokens ?? 0;
  return Math.ceil(((input - cached) * p.input + cached * p.cached + out * p.output) / 1_000_000 * 1_000_000);
}

/** Conservative per-request reservation: every permitted model call at its token caps. */
export function reserveMicroUsd(config: Pick<CopilotConfig, 'model' | 'maxModelCalls'>): number {
  const p = PRICING[config.model] ?? PRICING[STANDARD_MODEL];
  const perCall = (8000 * p.input + 1800 * p.output) / 1_000_000 * 1_000_000; // micro-USD
  return Math.ceil(perCall * config.maxModelCalls);
}

function usd(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const n = Number(env[name]);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1_000_000) : fallback;
}

export function resolveCopilotConfig(env: Record<string, string | undefined>): CopilotConfig {
  const enabled = env.ARIQ_COPILOT_ENABLED !== undefined ? env.ARIQ_COPILOT_ENABLED === 'true' : env.ARIQ_AI_ENABLED === 'true';
  const apiKey = env.MODEL_API_KEY ?? env.META_API_KEY ?? null;
  const requested = env.COPILOT_MODEL ?? env.META_MODEL ?? STANDARD_MODEL;
  const contributor = requested.endsWith('-contributor') && env.COPILOT_ALLOW_CONTRIBUTOR === 'true';
  return {
    enabled,
    apiKey: typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : null,
    model: contributor ? requested : STANDARD_MODEL,
    contributor,
    // Tiny hard allowance by default: $5 total, $1/day, until an operator
    // deliberately raises it. No configuration => these conservative caps.
    budgetTotalMicroUsd: usd(env, 'COPILOT_BUDGET_TOTAL_USD', 5_000_000),
    budgetDailyMicroUsd: usd(env, 'COPILOT_BUDGET_DAILY_USD', 1_000_000),
    maxModelCalls: 4,
    maxToolCalls: 8,
  };
}
