import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),cache=new Map(),tables={email_messages:[],classification_feedback:[],automation_audit:[]};
let posts=[],status=200,destination='8.8.8.8',reviews=[];
class Query {
  constructor(table){this.table=table;this.filters=[];}
  select(){return this;}eq(key,value){this.filters.push(row=>row[key]===value);return this;}gte(key,value){this.filters.push(row=>row[key]>=value);return this;}
  in(key,values){this.filters.push(row=>values.includes(row[key]));return this;}order(){return this;}limit(){return this;}maybeSingle(){this.one=true;return this;}single(){this.one=true;return this;}
  insert(value){this.inserted=value;return this;}update(value){this.updated=value;return this;}
  then(resolve){const table=tables[this.table];let inserted;if(this.inserted){inserted={id:String(table.length+1),...this.inserted};table.push(inserted);}const matched=inserted?[inserted]:table.filter(row=>this.filters.every(filter=>filter(row)));if(this.updated)matched.forEach(row=>Object.assign(row,this.updated));return Promise.resolve({data:structuredClone(this.one?matched[0]??null:matched),error:null}).then(resolve);}
}
const overrides={
  '@/lib/supabaseServer':{getServiceSupabaseClient:()=>({from:table=>new Query(table)})},
  '@/lib/objectCreation':{createAssistantAction:async(_user,input)=>{reviews.push(input);return {created:true};}},
  'node:dns/promises':{lookup:async(host,options)=>{assert.equal(host,'mail.retail.test');assert.equal(options.all,true);return [{address:destination,family:4}];}},
  'node:https':{request:(url,options,callback)=>{const emitter=new EventEmitter();emitter.setTimeout=()=>emitter;emitter.end=body=>{posts.push({url:String(url),options,body});options.lookup('mail.retail.test',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,destination);assert.equal(family,4);});queueMicrotask(()=>callback({statusCode:status,resume(){}}));};return emitter;}},
};
function load(name){if(overrides[name])return overrides[name];if(!name.startsWith('@/'))return require(name);if(cache.has(name))return cache.get(name);const mod={exports:{}};cache.set(name,mod.exports);new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.resolve('src',name.slice(2)+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(load,mod,mod.exports);return mod.exports;}
const {unsubscribeObviousJunk}=load('@/lib/emailUnsubscribe'),{defaultAutomationSettings}=load('@/lib/automationSettings');
const sender='sale@retail.test';const headers={'list-id':'retail.test','list-unsubscribe':'<https://mail.retail.test/unsubscribe?opaque=private-token>','list-unsubscribe-post':'List-Unsubscribe=One-Click','dkim-signature':'v=1; d=retail.test; h=from:list-unsubscribe:list-unsubscribe-post; b=fixture','authentication-results':'mx.google.com; dkim=pass header.i=@retail.test'};
const message=id=>({id,user_id:'user',google_account_id:'brown',google_message_id:id,sender,raw_headers:headers,processing_status:'processed',disposition:'MARKETING',protected_sender:false,disposition_confidence:.99});
tables.email_messages.push(message('one'),message('two'),{...message('critical'),protected_sender:true},{...message('other-owner'),user_id:'other'});
const settings={...defaultAutomationSettings,mode:'aggressive',unsubscribe_junk:true};
await unsubscribeObviousJunk('user','brown',settings);assert.equal(posts.length,0,'Marketing alone does not prove repeated user rejection');
for(let index=0;index<3;index++)tables.classification_feedback.push({user_id:'user',source_type:'email',user_action:'ignore',source_id:String(index),context_json:{sender}});
await unsubscribeObviousJunk('user','brown',{...settings,unsubscribe_junk:false});assert.equal(posts.length,0);
await unsubscribeObviousJunk('user','brown',{...settings,mode:'balanced'});assert.equal(posts.length,0);
await unsubscribeObviousJunk('user','brown',settings);assert.equal(posts.length,1,'One POST per list despite multiple messages; critical/foreign sources excluded');assert.equal(tables.automation_audit[0].status,'completed');
assert.equal(posts[0].options.method,'POST');assert.deepEqual(posts[0].options.headers,{'Content-Type':'application/x-www-form-urlencoded','Content-Length':26});assert.equal(posts[0].body,'List-Unsubscribe=One-Click');assert.equal(JSON.stringify(tables.automation_audit).includes('private-token'),false,'Opaque unsubscribe tokens never appear in audit logs');
await unsubscribeObviousJunk('user','brown',settings);assert.equal(posts.length,1,'Completed external request not replayed');
tables.email_messages[0].raw_headers={...headers,'list-id':'second-list'};status=503;await unsubscribeObviousJunk('user','brown',settings);assert.equal(posts.length,2);assert.equal(tables.automation_audit.at(-1).status,'failed');await unsubscribeObviousJunk('user','brown',settings);assert.equal(posts.length,2,'Uncertain/failing external request requires review, not blind replay');
tables.email_messages[0].raw_headers={...headers,'list-id':'private-address-list'};destination='169.254.169.254';await unsubscribeObviousJunk('user','brown',settings);assert.equal(posts.length,2,'Private DNS destination blocked before HTTPS request');
tables.email_messages[0].raw_headers={...headers,'list-id':'manual-review-list','list-unsubscribe-post':''};await unsubscribeObviousJunk('user','brown',settings);assert.equal(posts.length,2);assert.equal(reviews.at(-1).actionType,'unsubscribe_review');
console.log('Unsubscribe worker verified: explicit permission; aggressive mode; distinct ignore history; per-list dedup; account/owner/protected filtering; RFC POST; pinned DNS; sensitive-token omission; failed-outcome preservation; review fallback. No real unsubscribe performed.');
