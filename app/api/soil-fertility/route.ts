import { estimateWaterRetention, classifySoilTest, nutrientBalance, leachingRisk, type SoilTestInput } from '../../../lib/soil-fertility.ts';
import { readJson, json, fail } from '../../../lib/irrigation/http.ts';

/**
 * Soil fertility scenario tools. POST { analysis, ... }:
 * - texture:   { sandPct, clayPct, organicMatterPct } -> modelled FC/WP (Saxton-Rawls)
 * - soil-test: { soilTest } -> salinity/pH classification of lab values
 * - balance:   { cropId, yieldTPerHa, fertilizers?, irrigationWater?, manure? } -> NPK accounting
 * - leaching:  { drainageMmSeason, sandPct, nitrogenInputKgHa } -> screening risk
 * Nothing here prescribes a fertilizer rate.
 */
export async function POST(request: Request) {
  try {
    const body = await readJson(request, 16384) as Record<string, never>;
    switch (body.analysis) {
      case 'texture':
        return json({ ...estimateWaterRetention(body as never), kind: 'soil-texture-estimate' });
      case 'soil-test':
        return json({ kind: 'soil-test-classification', ...classifySoilTest(((body as unknown) as { soilTest: SoilTestInput }).soilTest) });
      case 'balance':
        return json(nutrientBalance(body as never));
      case 'leaching':
        return json({ ...leachingRisk(body as never), kind: 'leaching-risk' });
      default:
        return json({ error: 'analysis must be one of texture, soil-test, balance, leaching.' }, 400);
    }
  } catch (error) {
    return fail(error);
  }
}
