import assert from 'node:assert/strict';
import {NextRequest} from 'next/server.js';
import {loadSourceModule as load} from './load-source-module.mjs';
const auth=load('@/lib/serverAuth');let signedIn=true;
auth.requireApiUser=async()=>{if(!signedIn)throw new auth.ApiAuthError('Unauthorized',401);return {id:'owner'};};
let filters={},rowCount=1;
class Query{constructor(){filters={};}select(){return this;}eq(k,v){filters[k]=v;return this;}gte(k,v){filters[`gte_${k}`]=v;return this;}lte(k,v){filters[`lte_${k}`]=v;return this;}order(){return this;}limit(){return this;}then(resolve){return Promise.resolve({data:Array.from({length:rowCount},()=>({id:'fixture',task_type:'email_triage',source_type:'email',source_hash:'hash',input_text:'Synthetic reference date\nnot a deadline',final_label:{type:'REFERENCE'},trust_source:'USER_CORRECTION',trust_score:1,model_confidence:0.6})),error:null}).then(resolve);}}
load('@/lib/supabaseServer').getServiceSupabaseClient=()=>({from:()=>new Query()});
const {GET}=load('@/app/api/debug/training/route');
const request=query=>new NextRequest(`https://example.test/api/debug/training?export=jsonl&${query}`);
let response=await GET(request('task=email_triage&source=USER_CORRECTION&confidence=0.5&from=2026-01-01T00%3A00%3A00Z'));
assert.equal(response.status,200);assert.equal(filters.user_id,'owner');assert.equal(filters.quality,'approved');assert.equal(filters.curation_status,'eligible');assert.equal(filters.contains_sensitive_data,false);assert.equal(filters.task_type,'email_triage');assert.equal(filters.correction_source,'USER_CORRECTION');assert.equal(filters.gte_model_confidence,0.5);assert.equal(filters.gte_trust_score,.8);
const line=JSON.parse((await response.text()).trim());assert.equal(line.messages[1].content,'Synthetic reference date\nnot a deadline');assert.equal(JSON.parse(line.messages[2].content).type,'REFERENCE');assert.equal(line.metadata.trust_source,'USER_CORRECTION');assert(!('user_id' in line));assert(!('context_json' in line));
response=await GET(request('confidence=2'));assert.equal(response.status,400);response=await GET(request('from=bad-date'));assert.equal(response.status,400);
rowCount=1001;response=await GET(request(''));assert.equal(response.status,413,'never silently truncate export');
rowCount=0;response=await GET(request(''));assert.equal(await response.text(),'','empty export contains no invented records');
signedIn=false;response=await GET(request(''));assert.equal(response.status,401);
console.log('Training export fixtures passed: authentication, owner/approved filter, provenance/task/confidence/date filters, JSONL escaping, empty export, invalid filters, explicit size boundary. Storage/auth mocked.');
