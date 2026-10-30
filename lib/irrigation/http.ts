export class HttpError extends Error { status:number;constructor(status:number,message:string){super(message);this.status=status;} }

const LOOPBACK_HOSTS=['127.0.0.1','localhost','[::1]'];
// Deployment origin allowlist and cross-site checks, not authentication.
// The public Worker separately applies API rate limits and hard-disables AI.
const PRIVATE_ORIGIN='https://ariq-private.nezzoval.workers.dev';
export function requireLocalRequest(request:Request){
  const url=new URL(request.url);
  if(!LOOPBACK_HOSTS.includes(url.hostname)&&url.origin!==PRIVATE_ORIGIN)throw new HttpError(403,'This API is available only on localhost or the ARIQ deployment.');
  const origin=request.headers.get('origin');
  // Loopback aliases (127.0.0.1 vs localhost) are the same local site: Next may
  // report the request URL under `localhost` while the browser sends the
  // numeric Origin. Only the alias may differ — scheme and port must match.
  let originOk=!origin;
  if(origin){
    try{
      const o=new URL(origin);
      originOk=o.protocol===url.protocol&&o.port===url.port&&(o.origin===url.origin||(LOOPBACK_HOSTS.includes(o.hostname)&&LOOPBACK_HOSTS.includes(url.hostname)));
    }catch{originOk=false;}
  }
  if(!originOk||request.headers.get('sec-fetch-site')==='cross-site')throw new HttpError(403,'Cross-site requests are not allowed.');
}

export async function readJson(request:Request,maxBytes=65536):Promise<unknown>{
  requireLocalRequest(request);
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new HttpError(415,'Send an application/json request.');
  const declared=request.headers.get('content-length');
  if(declared&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw new HttpError(413,'Request body is too large.');
  if(!request.body)throw new HttpError(400,'A JSON request body is required.');
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes){await reader.cancel();throw new HttpError(413,'Request body is too large.');}chunks.push(value);}
    const combined=new Uint8Array(length);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined));}catch{throw new HttpError(400,'Request body must contain valid JSON.');}
  }finally{reader.releaseLock();}
}

export function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}
export function fail(error:unknown){
  if(error instanceof HttpError)return json({error:error.message},error.status);
  if(error instanceof Error&&error.name==='InputError')return json({error:error.message},400);
  return json({error:'The calculation could not be completed. Check the inputs and retry.'},500);
}
