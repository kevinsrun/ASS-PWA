import {createHash} from "crypto";
import {AsyncLocalStorage} from "node:async_hooks";
import {getServiceSupabaseClient} from "@/lib/supabaseServer";
type UsageScope={userId:string;task:string;pending:Promise<void>[]};
const scopes=new AsyncLocalStorage<UsageScope>();
export function currentAIUser(){return scopes.getStore()?.userId;}
export type UsageEvent="gemini_request"|"gemini_fallback"|"ollama_request"|"deterministic"|"cache_hit"|"escalation"|"local_accepted"|"failure";
export async function recordAIUsage(event:UsageEvent,model?:string,confidence?:number) {
 const scope=scopes.getStore();if(!scope)return;
 try{const db=getServiceSupabaseClient();if(!db)return;const result=await db.from("ai_usage_events").insert({user_id:scope.userId,task_type:scope.task,event_type:event,model,confidence:Number.isFinite(confidence)?confidence:null});if(result.error)throw result.error;}catch{console.warn(JSON.stringify({service:"ai-usage",stage:"write-failed",event}));}
}
export function trackAIUsage(event:UsageEvent,model?:string,confidence?:number){const scope=scopes.getStore();if(scope)scope.pending.push(recordAIUsage(event,model,confidence));}
export async function withAIUsage<T>(userId:string|undefined,task:string,work:()=>Promise<T>):Promise<T>{
 if(!userId)return work();
 return scopes.run({userId,task,pending:[]},async()=>{try{return await work();}finally{const scope=scopes.getStore()!;await Promise.all(scope.pending);}});
}
export function aiCacheKey(input:{content:string;task:string;model:string;promptVersion:string;analysisVersion:string}){return createHash("sha256").update(JSON.stringify({content:input.content,task:input.task,model:input.model,promptVersion:input.promptVersion,analysisVersion:input.analysisVersion})).digest("hex");}
export async function cachedAIResult<T>(input:{userId?:string;content:string;task:string;model:string;promptVersion:string;analysisVersion:string;bypass?:boolean;validate:(value:unknown)=>value is T},compute:()=>Promise<T>):Promise<T>{
 return withAIUsage(input.userId,input.task,async()=>{
 const db=input.userId?getServiceSupabaseClient():null,key=aiCacheKey(input);
 if(db&&!input.bypass){try{const hit=await db.from("ai_result_cache").select("result_json").eq("user_id",input.userId!).eq("cache_key",key).gt("expires_at",new Date().toISOString()).maybeSingle();if(hit.error)throw hit.error;if(hit.data&&input.validate(hit.data.result_json)){trackAIUsage("cache_hit",input.model);return hit.data.result_json;}}catch{console.warn(JSON.stringify({service:"ai-cache",stage:"read-failed",task:input.task}));}}
 let value:T;try{value=await compute();}catch(error){trackAIUsage("failure",input.model);throw error;}
 // Escalation/unknown results may be valid control flow, but are never cacheable.
 if(!input.validate(value))return value;
 if(db){try{const saved=await db.from("ai_result_cache").upsert({user_id:input.userId,cache_key:key,task_type:input.task,model:input.model,prompt_version:input.promptVersion,analysis_version:input.analysisVersion,result_json:value,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+7*86400000).toISOString()},{onConflict:"user_id,cache_key"});if(saved.error)throw saved.error;}catch{console.warn(JSON.stringify({service:"ai-cache",stage:"write-failed",task:input.task}));}}
 return value;
 });
}
