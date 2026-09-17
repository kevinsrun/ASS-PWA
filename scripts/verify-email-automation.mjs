import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),cache=new Map();
const rows=[],audits=[],writes=[];let failNetwork=false,failPersistence=false;
class Query {
  constructor(table){this.table=table;this.filters=[];}
  select(){return this;} eq(key,value){this.filters.push(row=>row[key]===value);return this;}
  or(){this.filters.push(row=>row.marked_read_at==null || (row.archived_at==null && row.disposition==='MARKETING' && !row.protected_sender));return this;}
  order(){return this;}limit(){return this;}
  update(value){this.value=value;return this;}
  upsert(value){this.inserted=value;return this;}
  then(resolve){
    if(failPersistence && this.table==='email_messages' && this.value?.marked_read_at){failPersistence=false;return Promise.resolve({data:null,error:new Error('fixture DB outage')}).then(resolve);}
    const table=this.table==='automation_audit'?audits:rows;
    if(this.inserted)for(const value of this.inserted){let prior=table.find(row=>row.user_id===value.user_id&&row.source_id===value.source_id&&row.action===value.action);if(prior)Object.assign(prior,value);else table.push({...value});}
    const matched=table.filter(row=>this.filters.every(filter=>filter(row)));
    if(this.value)matched.forEach(row=>Object.assign(row,this.value));
    return Promise.resolve({data:structuredClone(matched),error:null}).then(resolve);
  }
}
function load(name){
  if(name==='@/lib/supabaseServer')return {getServiceSupabaseClient:()=>({from:table=>new Query(table)})};
  if(!name.startsWith('@/'))return require(name);
  if(cache.has(name))return cache.get(name);
  const mod={exports:{}};cache.set(name,mod.exports);
  new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.resolve('src',name.slice(2)+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(load,mod,mod.exports);return mod.exports;
}
const {emailDisposition}=load('@/lib/emailDisposition');
const {defaultAutomationSettings,gmailModifyScope}=load('@/lib/automationSettings');
const {flushProcessedGmailLabels}=load('@/lib/gmailLabelAutomation');
const {publicUnsubscribeAddress,oneClickUnsubscribeTarget}=load('@/lib/emailUnsubscribe');
const promotion={sender:'Shop <sale@retail.test>',subject:'50% off — shop now',text:'Free shipping',headers:{'List-Id':'retail.test'},type:'task',importance:'normal',actionRequired:true,responseNeeded:false};
assert.equal(emailDisposition(promotion,'aggressive').suppressed,true,'Model-predicted action cannot promote obvious retail spam');
for(const text of ['research','financial aid','recruiting','security verification','active application','course syllabus','scholarship'])assert.equal(emailDisposition({...promotion,text},'aggressive').suppressed,false,`Protect ${text}`);
assert.equal(emailDisposition({...promotion,sender:'admin@brown.edu'},'aggressive').protectedSender,true);
assert.equal(emailDisposition({...promotion,sender:'prof@department.example.ac.uk'},'aggressive').suppressed,false);
const newsletter={...promotion,subject:'Weekly digest',text:'Newsletter',type:'no_action',actionRequired:false};
assert.equal(emailDisposition(newsletter,'aggressive').suppressed,true);
assert.equal(emailDisposition(newsletter,'balanced').suppressed,false);
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{writes.push({url,options});if(failNetwork)return new Response(null,{status:503});return Response.json({});};
const fixture=(id,status='processed',account='brown')=>({id,user_id:'user',google_account_id:account,google_message_id:id,processing_status:status,processed_at:status==='processed'?'2026-09-17T10:00:00Z':null,marked_read_at:null,archived_at:null,label_ids:['UNREAD','INBOX'],protected_sender:true,disposition:'IMPORTANT'});
try{
  rows.push(fixture('ready'),fixture('failed','failed'),fixture('processing','processing'),fixture('other','processed','personal'));
  await flushProcessedGmailLabels('user','brown','test-token',null,defaultAutomationSettings);
  assert.equal(writes.length,0,'Missing modify permission never calls Gmail');assert.equal(audits[0].status,'blocked');assert.equal(rows[0].marked_read_at,null);
  await flushProcessedGmailLabels('user','brown','test-token',gmailModifyScope,defaultAutomationSettings);
  assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0].options.body).removeLabelIds,['UNREAD']);assert.ok(rows[0].marked_read_at);assert.equal(audits[0].status,'completed');
  assert.equal(rows[1].marked_read_at,null);assert.equal(rows[2].marked_read_at,null);assert.equal(rows[3].marked_read_at,null,'No cross-account update');
  await flushProcessedGmailLabels('user','brown','test-token',gmailModifyScope,defaultAutomationSettings);assert.equal(writes.length,1,'Successful labels not replayed');
  rows.push({...fixture('junk'),protected_sender:false,disposition:'MARKETING',disposition_confidence:.99});failNetwork=true;
  await flushProcessedGmailLabels('user','brown','test-token',gmailModifyScope,{...defaultAutomationSettings,archive_junk:true});assert.equal(rows.at(-1).marked_read_at,null);assert.equal(audits.at(-1).status,'failed');
  failNetwork=false;failPersistence=true;await flushProcessedGmailLabels('user','brown','test-token',gmailModifyScope,{...defaultAutomationSettings,archive_junk:true});assert.equal(rows.at(-1).marked_read_at,null,'Unpersisted label outcome stays retryable');
  await flushProcessedGmailLabels('user','brown','test-token',gmailModifyScope,{...defaultAutomationSettings,archive_junk:true});assert.ok(rows.at(-1).archived_at);assert.deepEqual(JSON.parse(writes.at(-1).options.body).removeLabelIds,['UNREAD','INBOX']);assert.equal(rows[0].archived_at,null,'Protected correspondence never archived');
  rows.push(fixture('disabled'));const previous=writes.length;await flushProcessedGmailLabels('user','brown','test-token',gmailModifyScope,{...defaultAutomationSettings,mode:'manual'});assert.equal(writes.length,previous,'Manual mode does not modify labels');
}finally{globalThis.fetch=originalFetch;}
for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','100.64.1.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1','2002:7f00:1::1'])assert.equal(publicUnsubscribeAddress(address),false,`Block ${address}`);
assert.equal(publicUnsubscribeAddress('8.8.8.8'),true);assert.equal(publicUnsubscribeAddress('2606:4700:4700::1111'),true);
const headers={'List-Unsubscribe':'<https://mail.retail.test/unsubscribe?opaque=token>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click','DKIM-Signature':'v=1; d=retail.test; h=from:list-unsubscribe:list-unsubscribe-post; b=fixture','Authentication-Results':'mx.google.com; dkim=pass header.i=@retail.test'};
assert.ok(oneClickUnsubscribeTarget(headers,'sale@retail.test'));
assert.equal(oneClickUnsubscribeTarget({...headers,'List-Unsubscribe':'<https://other.test/unsubscribe>'},'sale@retail.test'),null,'Cross-domain preference pages require review');
assert.equal(oneClickUnsubscribeTarget({...headers,'List-Unsubscribe-Post':''},'sale@retail.test'),null,'No automatic GET unsubscribe');
assert.equal(oneClickUnsubscribeTarget({...headers,'Authentication-Results':'mx.google.com; dkim=fail'},'sale@retail.test'),null,'Unsigned/unverified messages not auto-unsubscribed');
console.log('Email automation verified: protected/noise dispositions; durable success-only label changes; account isolation; missing permissions; idempotent label retries; failed persistence; manual mode; protected archiving; public-address restrictions; one-click-only unsubscribe validation. No real emails changed.');
