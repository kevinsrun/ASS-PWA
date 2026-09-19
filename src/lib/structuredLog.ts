import {randomUUID} from 'node:crypto';
const forbidden=/token|secret|authorization|password|body|content|api.?key/i;
export function requestId(headers?:Headers){return headers?.get('x-vercel-id')?.slice(0,160)||randomUUID();}
export function structuredLog(level:"info"|"warn"|"error",event:Record<string,unknown>){
 const safe=Object.fromEntries(Object.entries(event).filter(([key])=>!forbidden.test(key)).map(([key,value])=>[key,typeof value==='string'?value.slice(0,500):value]));
 const line=JSON.stringify({level,timestamp:new Date().toISOString(),...safe});
 if(level==='error')console.error(line);else if(level==='warn')console.warn(line);else console.info(line);
}
