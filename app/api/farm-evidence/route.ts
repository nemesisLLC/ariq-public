import { getFarmEvidence } from '../../../lib/farm-intelligence.ts';
import {readJson,json,fail} from '../../../lib/irrigation/http.ts';
import { buildFarmProfile } from '../../../lib/farm-profile.ts';

/**
 * Farm evidence for a point (Phase 2: optionally a farm polygon).
 * Soil prefers location-specific SoilGrids grid predictions with SoilGrids
 * uncertainty; Phase 1 regional modelled soil remains the fallback.
 * Documented water proximity, ERA5 climate context, SIAT national water
 * context, and an explicit groundwater null (no farm measurement exists).
 * GET /api/farm-evidence?lat=39.65&lon=66.96
 * GET /api/farm-evidence?lat=39.65&lon=66.96&polygon=[[66.9,39.6],[67.0,39.6],[67.0,39.7],[66.9,39.7]]
 * The polygon is a JSON array of [longitude, latitude] points.
 *
 * Unified automatic farm intelligence (additive, backward compatible):
 * when BOTH cropId and plantingDate are supplied, the same evidence
 * response gains a `profile` section from lib/farm-profile.ts — crop
 * calendar and FAO-33 sensitivity, automatic modelled soil fed into the
 * existing Feature 4/Feature 1 irrigation engine, and an optional
 * seeding rate from seedKg (which never affects irrigation).
 * GET /api/farm-evidence?lat=39.65&lon=66.96&cropId=cotton&plantingDate=2026-04-15&seedKg=600
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    if (!params.has('lat') || !params.has('lon')) throw new Error('lat and lon are required');
    let polygon: [number, number][] | undefined;
    if (params.has('polygon')) {
      const parsed: unknown = JSON.parse(params.get('polygon')!);
      if (!Array.isArray(parsed)) throw new Error('polygon must be a JSON array of [longitude, latitude] points');
      polygon = parsed as [number, number][];
    }
    const latitude = Number(params.get('lat'));
    const longitude = Number(params.get('lon'));
    const cropId = params.get('cropId');
    const plantingDate = params.get('plantingDate');
    if ((cropId === null) !== (plantingDate === null)) throw new Error('cropId and plantingDate must be supplied together');
    if (cropId && plantingDate) {
      const profile = await buildFarmProfile({
        latitude, longitude, ...(polygon ? { polygon } : {}),
        cropId, plantingDate,
        ...(params.has('seedKg') ? { seedQuantityKg: Number(params.get('seedKg')) } : {}),
        ...(params.has('areaHa') ? { areaHa: Number(params.get('areaHa')) } : {}),
      });
      // Top level stays exactly the Phase 1/2 evidence contract.
      return Response.json({ ...profile.evidence, profile }, { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } });
    }
    const evidence = getFarmEvidence(latitude, longitude, polygon ? { polygon } : undefined);
    return Response.json(evidence, { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid coordinates.' }, { status: 400 });
  }
}

/** Private advanced profile inputs; same canonical assembler as GET. */
export async function POST(request:Request){
  try {
    const input=await readJson(request,65536);
    const profile=await buildFarmProfile(input as Parameters<typeof buildFarmProfile>[0]);
    return json({...profile.evidence,profile});
  } catch(error) { return fail(error); }
}
