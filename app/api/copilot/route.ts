import {runCopilot} from '../../../lib/copilot/orchestrator.ts';
import {resolveCopilotConfig} from '../../../lib/copilot/config.ts';
import {readJson,json,fail} from '../../../lib/irrigation/http.ts';
/**
 * Local/Next entry point. Production traffic is served by the Cloudflare
 * Worker (cloudflare/worker.ts), which additionally requires the Durable
 * Object budget. Here the unified config decides: explicit enablement plus
 * a server-side key, or an honest 503. Keys never reach the client.
 */
export function copilotEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const c = resolveCopilotConfig(env);
  return c.enabled && !!c.apiKey;
}
export async function GET(){
  const c = resolveCopilotConfig(process.env);
  return json({kind:'copilot-status', available: c.enabled && !!c.apiKey, model: c.model, contributor: c.contributor});
}
export async function POST(request:Request){
  const c = resolveCopilotConfig(process.env);
  if(!c.enabled || !c.apiKey) return json({error:'The AI Copilot is disabled: enable it explicitly and configure a server-side Meta key.',kind:'copilot-disabled'},503);
  try{return json(await runCopilot(await readJson(request,16384),{apiKey:c.apiKey,enabled:true,model:c.model,maxModelCalls:c.maxModelCalls,maxToolCalls:c.maxToolCalls}));}
  catch(error){return fail(error);}
}
