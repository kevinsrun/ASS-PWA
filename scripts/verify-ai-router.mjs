import assert from 'node:assert/strict';
import {loadSourceModule as load} from './load-source-module.mjs';
const {routeAIRequest,executeAIRequest}=load('@/lib/ai/router');
const {validLowRiskTriage,consequentialEmail,preclassifyEmail}=load('@/lib/ai/emailTriage');
const {generateOllamaJSON}=load('@/lib/ai/ollama');
let modelCalls=0;
const providers={deterministic:async()=>false,local:async()=>{modelCalls++;throw new Error('offline');},gemini:async()=>{modelCalls++;return 'escalated';},validateLocal:()=>true};
assert.equal((await executeAIRequest({task:'calendar_overlap',content:'intervals'},providers)).route,'DETERMINISTIC');
assert.equal(modelCalls,0,'overlap never calls a model');
await assert.rejects(executeAIRequest({task:'permissions',content:''},{...providers,deterministic:undefined}),/resolver/);
assert.equal(routeAIRequest({task:'spam_classification',content:'retail bulk',importance:'low',context:{localEnabled:true}}).route,'LOCAL_GEMMA');
assert.equal(routeAIRequest({task:'email_triage',content:'Ambiguous deadline',importance:'high',ambiguity:.8,context:{localEnabled:true}}).route,'GEMINI_HIGH');
const fallback=await executeAIRequest({task:'email_triage',content:'bulk',context:{localEnabled:true}},providers);
assert.equal(fallback.route,'GEMINI_HIGH');assert.equal(fallback.escalated,true);
await assert.rejects(executeAIRequest({task:'email_triage',content:'bulk',context:{localEnabled:true,privacy:'local_only'}},providers),/privacy/);
await assert.rejects(executeAIRequest({task:'email_triage',content:'bulk',context:{localEnabled:true,geminiAvailable:false}},providers),/retry/);
for(const confidence of [.72,NaN,1.2]){const output=await executeAIRequest({task:'email_triage',content:'bulk',context:{localEnabled:true}},{...providers,local:async()=>({value:'bad',confidence,escalate:false})});assert.equal(output.route,'GEMINI_HIGH');}
const bulk={subject:'Weekly digest',sender:'news@example.com',body:'Our weekly digest is ready.',snippet:'Our weekly digest is ready.',bulk:true};
const prediction={classification:'NEWSLETTER',confidence:.99,escalate:false,evidence:'Our weekly digest is ready.'};
assert.equal(validLowRiskTriage(bulk,prediction),true);
for(const body of ['Registration closes Friday.','Please complete the form.','Research opportunity announcement.','Invoice payment due.','Your appointment is confirmed.'])assert.equal(consequentialEmail({...bulk,body}),true);
assert.equal(consequentialEmail({...bulk,sender:'advisor@brown.edu'}),true);
assert.equal(validLowRiskTriage(bulk,{...prediction,classification:'EVENT'}),false,'local events never auto-commit');
assert.equal(validLowRiskTriage(bulk,{...prediction,evidence:'invented evidence'}),false);
const originalFetch=globalThis.fetch;const original={enabled:process.env.OLLAMA_ENABLED,model:process.env.OLLAMA_MODEL,base:process.env.OLLAMA_BASE_URL};
try{
process.env.OLLAMA_ENABLED='true';process.env.OLLAMA_MODEL='fixture-gemma';process.env.OLLAMA_BASE_URL='http://localhost:11434';
globalThis.fetch=async(url,options)=>{assert.equal(url,'http://localhost:11434/api/generate');const body=JSON.parse(options.body);assert.equal(body.stream,false);assert.equal(body.model,'fixture-gemma');return new Response(JSON.stringify({done:true,model:body.model,response:JSON.stringify(prediction)}));};
assert.equal((await preclassifyEmail(bulk)).classification,'NEWSLETTER');
globalThis.fetch=async()=>{throw new Error('connection refused');};assert.equal(await preclassifyEmail(bulk),null,'local failure keeps email in Gemini batch');
globalThis.fetch=async()=>new Response(JSON.stringify({done:true,model:'fixture-gemma',response:JSON.stringify({...prediction,classification:'EVENT'})}));assert.equal(await preclassifyEmail(bulk),null);
process.env.OLLAMA_BASE_URL='http://untrusted.example';await assert.rejects(generateOllamaJSON('test',{}),/trusted HTTPS/);
}finally{globalThis.fetch=originalFetch;for(const [key,value] of Object.entries({OLLAMA_ENABLED:original.enabled,OLLAMA_MODEL:original.model,OLLAMA_BASE_URL:original.base})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
console.log('AI router passed: deterministic zero-model resolution, protected-email escalation, confidence/evidence gates, local-only privacy, quota preservation, Ollama schema and unavailable-provider fallback. Provider calls mocked; no live model benchmark claimed.');
