import {runCopilot} from '../../../lib/copilot/orchestrator.ts';
import {readJson,json,fail} from '../../../lib/irrigation/http.ts';
/**
 * Public AI stays OFF until a hard spending cap with distributed (persisted,
 * atomic) enforcement is configured and approved (audit SECURITY.md).
 * Enable deliberately with ARIQ_COPILOT_ENABLED=true plus a configured
 * META_API_KEY on the server. Local development keeps the same default.
 */
export function copilotEnabled(env: Record<string, string | undefined> = process.env): boolean {
  // Accept both names: .env.example documents MODEL_API_KEY (used by the
  // orchestrator and the legacy investigate agent); META_API_KEY is the alias.
  const key = env.META_API_KEY ?? env.MODEL_API_KEY;
  return env.ARIQ_COPILOT_ENABLED === 'true' && typeof key === 'string' && key.length > 0;
}
export async function POST(request:Request){
  if(!copilotEnabled())return json({error:'The AI Copilot is disabled pending an approved spending cap and distributed budget enforcement.',kind:'copilot-disabled'},503);
  try{return json(await runCopilot(await readJson(request,16384)));}
  catch(error){return fail(error);}
}
