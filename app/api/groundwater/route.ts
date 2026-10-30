import { assessGroundwaterScenario, groundwaterTrend, type GroundwaterObservation } from '../../../lib/groundwater.ts';
import { readJson, json, fail } from '../../../lib/irrigation/http.ts';

/**
 * Groundwater scenario assessment. The caller supplies the depth and its
 * evidence kind; ARIQ never invents a farm water table. POST either
 * { depthToWaterM, depthKind, rootDepthM, texture, groundwaterEcDsM? }
 * or { observations: GroundwaterObservation[] } for a record trend.
 */
export async function POST(request: Request) {
  try {
    const body = await readJson(request, 16384) as Record<string, unknown>;
    if (Array.isArray(body.observations)) {
      return json({ kind: 'groundwater-observation-trend', trend: groundwaterTrend(body.observations as GroundwaterObservation[]) });
    }
    const depthKind = body.depthKind;
    if (depthKind !== 'observed' && depthKind !== 'historical' && depthKind !== 'reported' && depthKind !== 'user-supplied-scenario') {
      return json({ error: 'depthKind must name the evidence kind of the supplied depth (observed, historical, reported, or user-supplied-scenario). ARIQ does not guess it.' }, 400);
    }
    return json({
      kind: 'groundwater-scenario-assessment',
      suppliedEvidence: {kind:depthKind,source:typeof body.source==='string'?body.source.slice(0,300):null,observedAt:typeof body.observedAt==='string'?body.observedAt:null},
      ...assessGroundwaterScenario({
        depthToWaterM: body.depthToWaterM as number,
        depthKind,
        rootDepthM: body.rootDepthM as number,
        texture: body.texture as never,
        ...(typeof body.groundwaterEcDsM === 'number' ? { groundwaterEcDsM: body.groundwaterEcDsM } : {}),
      }),
    });
  } catch (error) {
    return fail(error);
  }
}
