type Limiter = {limit(input:{key:string}):Promise<{success:boolean}>};
export type PublicGuardEnv = {API_RATE_LIMITER?:Limiter};

/** No AI request can reach application/provider code, regardless of flags. */
export async function publicGuard(request:Request,env:PublicGuardEnv):Promise<Response|null>{
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/api/'))return null;
  // The legacy investigation endpoint stays hard-disabled. /api/copilot is
  // no longer blocked here: it falls through to the origin + rate-limiter
  // checks below, and the route itself fails closed unless the unified
  // config, a server-side key and the Durable Object budget all exist.
  if(path==='/api/irrigation/investigate')return Response.json({error:'AI is disabled.',kind:'copilot-disabled'},{status:503});
  const ip=request.headers.get('CF-Connecting-IP');
  // Binding is mandatory on the deployed origin. Fail closed on misconfiguration.
  if(!env.API_RATE_LIMITER){
    if(['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname))return null;
    return Response.json({error:'API protection unavailable.'},{status:503});
  }
  const origin=request.headers.get('origin');
  if((origin&&origin!==new URL(request.url).origin)||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Cross-site API requests are not allowed.'},{status:403});
  const {success}=await env.API_RATE_LIMITER.limit({key:ip||'unknown'});
  return success?null:Response.json({error:'Too many requests. Please try again in a minute.'},{status:429,headers:{'Retry-After':'60','Cache-Control':'no-store'}});
}
