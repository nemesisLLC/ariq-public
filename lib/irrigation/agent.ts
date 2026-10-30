import {calculatePlan,type PlanInput,type PlanResult} from './core.ts';
import {CallBudget,explanationFacts,localMetaBudget,validateLanguage,type Language} from './explanation.ts';
import {HttpError} from './http.ts';

export const actions=['increase_supply_25pct','extend_window_50pct','restore_closed_canal','no_change'] as const;
type Action=typeof actions[number];
type Proposal={action:Action;canalId:string;reason:string};
type Goal='reduce_unmet_demand'|'test_resilience';
export function permittedActions(value:unknown):Action[]{
  if(!Array.isArray(value)||value.length<1||value.length>4||!value.every(v=>actions.includes(v))||new Set(value).size!==value.length)throw new HttpError(400,'Choose one to four distinct supported simulation actions.');
  return value as Action[];
}
function candidates(scenario:PlanInput,allowed:Action[]){
  return [...new Set<Action>(['no_change',...allowed])].filter(action=>action==='no_change'||(action==='increase_supply_25pct'&&scenario.network.supplyM3>0&&scenario.network.supplyM3*1.25<=1e9)||(action==='extend_window_50pct'&&scenario.network.windowHours*1.5<=336)||(action==='restore_closed_canal'&&scenario.network.edges.some(e=>e.closed)));
}
export function applyIntervention(input:unknown,proposal:Proposal,allowed:Action[]){
  const baseline=calculatePlan(input),scenario=structuredClone(input) as PlanInput;
  if(!proposal||!candidates(scenario,allowed).includes(proposal.action))throw new HttpError(502,'Meta requested a simulation action outside the permitted set.');
  if(proposal.action==='restore_closed_canal'){
    const edge=scenario.network.edges.find(e=>e.id===proposal.canalId&&e.closed);
    if(!edge)throw new HttpError(502,'Meta requested an unknown or already open canal.');
    edge.closed=false;
  }else{
    if(proposal.canalId!=='')throw new HttpError(502,'A canal identifier is only valid for a canal-restoration simulation.');
    if(proposal.action==='increase_supply_25pct')scenario.network.supplyM3*=1.25;
    if(proposal.action==='extend_window_50pct')scenario.network.windowHours*=1.5;
  }
  const candidate=calculatePlan(scenario);
  return {baseline,candidate,scenario,comparison:compare(baseline,candidate)};
}
function compare(before:PlanResult,after:PlanResult){
  return {fieldGateDeltaM3:after.totals.fieldGateM3-before.totals.fieldGateM3,rootZoneDeltaM3:after.totals.rootZoneM3-before.totals.rootZoneM3,unmetDemandDeltaM3:after.totals.unmetM3-before.totals.unmetM3,sourceUseDeltaM3:after.totals.sourceUsedM3-before.totals.sourceUsedM3,deliveryHoursDelta:after.totals.scheduledHours-before.totals.scheduledHours,note:'Modeled differences between two scenarios; not measured savings, a yield prediction, or approval to operate a canal.'};
}

export async function investigate(input:unknown,languageValue:unknown,allowedValue:unknown,goalValue:unknown,options:{fetcher?:typeof fetch;budget?:CallBudget;apiKey?:string;enabled?:boolean}={}){
  const language:Language=validateLanguage(languageValue),allowed=permittedActions(allowedValue);
  if(goalValue!=='reduce_unmet_demand'&&goalValue!=='test_resilience')throw new HttpError(400,'Goal must be reduce_unmet_demand or test_resilience.');
  const goal:Goal=goalValue,baseline=calculatePlan(input),scenario=input as PlanInput;
  if(!(options.enabled??process.env.ARIQ_AI_ENABLED==='true')||!(options.apiKey??process.env.MODEL_API_KEY))throw new HttpError(503,'Meta investigation is disabled; the deterministic planner remains available.');
  const apiKey=options.apiKey??process.env.MODEL_API_KEY,budget=options.budget??localMetaBudget;
  const available=candidates(scenario,allowed),closedIds=scenario.network.edges.filter(e=>e.closed).map(e=>e.id);
  budget.acquire();
  try{
    const response=await (options.fetcher??fetch)('https://api.meta.ai/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),body:JSON.stringify({model:'muse-spark-1.3',reasoning:{effort:'minimal'},max_output_tokens:1200,parallel_tool_calls:false,tool_choice:{type:'function',name:'simulate_intervention'},tools:[{type:'function',name:'simulate_intervention',description:'Run one permitted counterfactual irrigation calculation. This only changes a copied scenario; it never controls equipment or edits the baseline.',strict:true,parameters:{type:'object',additionalProperties:false,properties:{action:{type:'string',enum:available},canalId:{type:'string',enum:['',...closedIds]},reason:{type:'string',description:'Brief rationale in the requested language, without numeric claims, URLs or promises.'}},required:['action','canalId','reason']}}],input:[{role:'developer',content:'You investigate an irrigation simulation by selecting exactly one permitted tool action. Use the supplied computed bottlenecks and goal. Only the listed actions may be simulated. More source supply does not fix a closed route or necessarily fix a time bottleneck. A longer window does not fix an exhausted volume quota. Choose no_change when no permitted action is plausible. All soil, field, supply and network values are scenario inputs. Do not invent observations, sources, yield or savings. Explain your hypothesis in the requested language (uz=Uzbek Latin, ru=Russian, en=English); do not include numbers in the reason. A hypothesis can fail; the deterministic tool will report the actual difference.'},{role:'user',content:JSON.stringify({language,goal,available,closedCanalIds:closedIds,deliveryWindowHours:scenario.network.windowHours,computed:explanationFacts(baseline)})}]})});
    if(!response.ok)throw new HttpError(response.status===429?429:502,'Meta could not select a scenario to investigate.');
    const result=await response.json();
    const calls=(result.output??[]).filter((item:{type?:string})=>item.type==='function_call');
    if(result.status!=='completed'||calls.length!==1||calls[0].name!=='simulate_intervention')throw new HttpError(502,'Meta did not return one supported investigation action.');
    let proposal:Proposal;try{proposal=JSON.parse(calls[0].arguments);}catch{throw new HttpError(502,'Meta returned invalid investigation arguments.');}
    if(!proposal||typeof proposal.reason!=='string'||!proposal.reason.trim()||proposal.reason.length>1000||/\d|https?:\/\//i.test(proposal.reason))throw new HttpError(502,'Meta returned an unsupported investigation rationale.');
    const simulation=applyIntervention(input,proposal,allowed);
    return {kind:'simulation-investigation',model:'muse-spark-1.3',language,goal,proposal,...simulation,trace:[{step:'calculate_baseline',status:'completed'},{step:'meta_selects_permitted_tool',tool:'simulate_intervention',status:'completed'},{step:'validate_and_calculate_counterfactual',status:'completed'},{step:'compare_numeric_results',status:'completed'}],remainingLocalCalls:Math.max(0,budget.limit-budget.used),usage:{inputTokens:result.usage?.input_tokens??null,outputTokens:result.usage?.output_tokens??null}};
  }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(502,'Meta investigation could not be completed. The baseline scenario is unchanged.');}
  finally{budget.release();}
}
