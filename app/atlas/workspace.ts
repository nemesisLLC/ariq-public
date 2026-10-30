import { geodesicAreaM2, interiorPoint, validateFarmPolygon, type LonLat } from './geo.ts';
import type { RecommendationResult } from '../../lib/irrigation/recommendation.ts';
import type { assessGroundwaterScenario, groundwaterTrend } from '../../lib/groundwater.ts';
import type { TextureEstimate, NutrientBalance, classifySoilTest, leachingRisk } from '../../lib/soil-fertility.ts';
import type { compareScenarios, SeasonDaily, SeasonInput, SeasonResult } from '../../lib/irrigation/season.ts';
import type { freshnessReport } from '../../lib/data-refresh.ts';

export type Farm = { version: 1 | 2; name: string; boundary: LonLat[]; cropId: string; plantingDate: string; seedQuantityKg?:number };
export type Analysis = RecommendationResult;
export type GroundwaterResult = ReturnType<typeof assessGroundwaterScenario>;
export type TrendResult = ReturnType<typeof groundwaterTrend>;
export type SoilResults = { suppliedInputs?:Partial<Record<'texture'|'lab'|'balance'|'leaching',Record<string,unknown>>>; texture?: TextureEstimate; lab?: ReturnType<typeof classifySoilTest>; balance?: NutrientBalance; leaching?: ReturnType<typeof leachingRisk> };
export type Comparison = ReturnType<typeof compareScenarios>;
export type Freshness = ReturnType<typeof freshnessReport>[number];
export type SeasonResponse = {
  sensitivity:ReturnType<typeof import('../../lib/irrigation/season.ts').sensitivityAnalysis>;
  ensembleSummary?:unknown;
  kind: string; medianAnalogYear: number; dailyBaseline: SeasonDaily[]; dailyStages: SeasonResult['stages']; seasonDays: number;
  provenance: {weather:{sourceUrls:string[];analogYears:number[]}}; assumptions: string[];
  ensemble: {years:{year:number; totals:SeasonResult['totals']; yieldImpact:SeasonResult['yieldImpact']}[]};
};
export type Nearest = { distanceKm:number; distanceKind?:string; feature:{ id:string; name:string; kind:string; provenance?:unknown; designCapacity?:unknown } };
export type Remote<T> = {status:'idle'|'loading'|'error'|'ready';data?:T;error?:string};
export type SeasonSnapshot = { modified?:SeasonInput; comparison:Comparison; base:SeasonInput; provenance:SeasonResponse['provenance']; years:SeasonResponse['ensemble']['years'] };
export type GroundSnapshot = {result:GroundwaterResult;inputs:{depthKind?:'observed'|'user-supplied-scenario';source?:string;observedAt?:string;depthToWaterM:number;rootDepthM:number;texture:string;groundwaterEcDsM?:number}};
export const CROP_IDS = ['cotton','winter-wheat','maize','alfalfa','tomato','potato','sunflower','melon'] as const;
export const FARM_STORAGE = 'ariq-active-field-v1';

export function parseFarm(value: unknown): Farm {
  const envelope = value as {farm?:unknown};
  const raw = (envelope?.farm ?? value) as Partial<Farm>;
  if (!raw || (raw.version !== 1 && raw.version !== 2) || typeof raw.name !== 'string' || raw.name.length>100 || !Array.isArray(raw.boundary) || raw.boundary.length>200 || !raw.boundary.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))) throw new Error('Invalid field file.');
  const valid = validateFarmPolygon(raw.boundary);
  if (!valid.ok) throw new Error(`Invalid field boundary: ${valid.reason}`);
  if (!CROP_IDS.includes(raw.cropId as typeof CROP_IDS[number]) || typeof raw.plantingDate!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.plantingDate) || !Number.isFinite(Date.parse(raw.plantingDate)) || new Date(raw.plantingDate).toISOString().slice(0,10)!==raw.plantingDate) throw new Error('Choose a valid crop and planting date.');
  if(raw.seedQuantityKg!==undefined&&(!Number.isFinite(raw.seedQuantityKg)||raw.seedQuantityKg<=0||raw.seedQuantityKg>1e7))throw new Error('Invalid seed quantity.');
  return {version:2,...(raw.seedQuantityKg===undefined?{}:{seedQuantityKg:raw.seedQuantityKg}),name:raw.name,boundary:raw.boundary.map(p=>[p[0],p[1]]),cropId:raw.cropId!,plantingDate:raw.plantingDate};
}

export function recommendationInput(farm: Farm, efficiency?:number, soil?:Record<string,number>) {
  const [longitude,latitude]=interiorPoint(farm.boundary);
  return {latitude,longitude,areaHa:geodesicAreaM2(farm.boundary)/10000,cropId:farm.cropId,plantingDate:farm.plantingDate,
    ...(efficiency===undefined?{}:{applicationEfficiency:efficiency}),...(soil?{soil}:{})};
}

export class RequestError extends Error {
  readonly status:number;
  readonly kind?:string;
  constructor(message:string,status:number,kind?:string){super(message);this.name='RequestError';this.status=status;this.kind=kind;}
}
export async function request<T>(url:string, body?:unknown, signal?:AbortSignal):Promise<T> {
  const timeout = AbortSignal.timeout(90_000);
  const response=await fetch(url,{signal:signal?AbortSignal.any([signal,timeout]):timeout,...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  let data;
  try{data=await response.json();}catch{throw new RequestError('The service returned an unreadable response. Please retry.',response.status);}
  if (!response.ok) throw new RequestError(data.error??`Request failed (${response.status})`,response.status,data.kind);
  return data as T;
}

export function download(name:string, value:unknown) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function passportData(farm:Farm, outputs:{profile?:import('../../lib/farm-profile.ts').FarmProfile;recommendation?:Analysis;groundwater?:GroundSnapshot;soil?:SoilResults;season?:SeasonSnapshot;nearest?:Nearest[]}) {
  return {schema:'ariq-water-passport/v1',createdAt:new Date().toISOString(),farm,areaHa:geodesicAreaM2(farm.boundary)/10000,representativePoint:interiorPoint(farm.boundary),...outputs,
    limitations:['Planning boundary, not an official survey.','Proximity is not verified water access.','Forecast, historical scenarios and user inputs are different evidence kinds.','Missing measurements remain unknown. Water-related yield is not a harvest prediction.']};
}
