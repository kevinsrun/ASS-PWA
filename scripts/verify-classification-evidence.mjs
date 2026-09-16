import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), overrides={};
function load(name){
  if(overrides[name])return overrides[name];
  if(!name.startsWith('@/'))return require(name);
  const loadedModule={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(path.resolve('src',name.slice(2)+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  new Function('require','module','exports',code)(load,loadedModule,loadedModule.exports);return loadedModule.exports;
}
const {validateExtractedItem,segmentDocument}=load('@/lib/classificationGuardrails');
const check=(text,label,kind='miscellaneous',extra={})=>validateExtractedItem({label,confidence:.98,evidenceText:text,required:true,documentType:'syllabus',section:{id:'a',kind,text,location:'line 1'},...extra});
const cases=[
 ['Attendance is worth 10%', 'CALENDAR_EVENT','policies','reference'],
 ['Required textbook: Molecular Biology','TASK','resources','reference'],
 ['Students should understand immune signaling','CALENDAR_EVENT','reference','reference'],
 ['Lecture MWF 10:00–10:50 AM','COURSE_SCHEDULE','schedule','calendar_event'],
 ['Lab meets Thursdays 2:00 PM–5:00 PM','CALENDAR_EVENT','schedule','calendar_event'],
 ['Office hours Tuesday 3 PM–4 PM','OFFICE_HOURS','schedule','calendar_event'],
 ['The experiment ran in 1998','CALENDAR_EVENT','reference','reference'],
 ['Professor contact: smith@example.test','CONTACT_INFO','contact_info','reference'],
 ['Read chapter 2 before class','READING','assignments','task'],
 ['An interesting overview of biology','TASK','miscellaneous','reference'],
 ['Meeting on September 28','CALENDAR_EVENT','schedule','reference'],
];
for(const [text,label,kind,expected]of cases)assert.equal(check(text,label,kind).normalizedType,expected,text);
assert.equal(check('Homework 3 due September 28 at 11:59 PM','ASSIGNMENT','assignments',{dueAt:'2026-09-28T23:59:00-04:00'}).normalizedType,'deadline');
assert.equal(check('Homework 3 due September 28 at 11:59 PM','ASSIGNMENT','assignments',{dueAt:'2026-09-29T23:59:00-04:00'}).normalizedType,'reference');
assert.equal(check('Meeting September 28 at 2 PM','CALENDAR_EVENT','schedule',{evidenceText:'Invented meeting October 5 at 2 PM'}).label,'UNKNOWN');
assert.equal(check('Office hours Tuesday 3 PM–4 PM','OFFICE_HOURS','schedule').required,false);
assert.equal(check('Submit homework due September 28','TASK','assignments',{confidence:.8}).autoCreate,false);
assert.equal(check('Submit homework due September 28','TASK','assignments',{evidenceVerified:false}).autoCreate,false);
assert.deepEqual(segmentDocument('Course description\nBiology overview\nGrading\nParticipation is worth 10%\nCourse schedule\nLecture MWF 10 AM').map(s=>s.kind),['reference','policies','schedule']);
const {planReanalysisMerge}=load('@/lib/reanalysisMerge');
const existing=[{id:'committed',title:'Lecture',review_status:'committed'},{id:'manual',title:'Exam',review_status:'pending',manual_corrected_at:'now'},{id:'ignored',title:'Seminar',review_status:'rejected'},{id:'pending',title:'Homework',review_status:'pending'}];
const incoming=['Lecture','Exam','Seminar','Homework','New task'].map(title=>({title,payload:{evidence_text:title+' source quote'},dueAt:null,normalizedType:'task'}));
const merge=planReanalysisMerge(existing,incoming);
assert.equal(merge.preserved,3);assert.equal(merge.updates.length,1);assert.equal(merge.additions.length,1);
const next=planReanalysisMerge([...existing,{id:'added',title:'New task',review_status:'pending'}],incoming);
assert.equal(next.additions.length,0,'Repeated analysis must not duplicate suggestions');
const {logoutFromAss}=load('@/lib/logout');
function storage(){const map=new Map([['ass_private','sensitive'],['ass:plaid-link-token','private'],['unrelated','keep']]);return {get length(){return map.size},key:i=>[...map.keys()][i],removeItem:key=>map.delete(key),map};}
const local=storage(),session=storage();let cleared=false,redirect='';
await logoutFromAss({signOut:async()=>({error:null}),local,session,clearState:()=>cleared=true,navigate:path=>redirect=path});
assert.equal(local.map.has('ass_private'),false);assert.equal(session.map.has('ass_private'),false);assert.equal(local.map.get('unrelated'),'keep');assert.equal(cleared,true);assert.equal(redirect,'/login');
assert.equal(session.map.has('ass:plaid-link-token'),false);
let persisted;
class Query{constructor(table){this.table=table;}select(){return this;}eq(){return this;}single(){return this;}maybeSingle(){return this;}update(value){persisted=value;return this;}then(resolve){return Promise.resolve({data:this.table==='google_tokens'?{service_health:{}}:{last_successful_sync_at:null},error:null}).then(resolve);}}
overrides['@/lib/supabaseServer']={getServiceSupabaseClient:()=>({from:table=>new Query(table)})};
overrides['@/lib/googleAuth']={listGoogleAccounts:async()=>[{id:'a',connected_email:'user@example.test'}],getGoogleAccessToken:async()=>'fixture'};
const {verifyGoogleServices}=load('@/lib/googleServiceHealth');
const originalFetch=globalThis.fetch;
try{
 globalThis.fetch=async url=>url.includes('gmail')?Response.json({emailAddress:'user@example.test'}):url.includes('drive')?Response.json({files:[]}):Response.json({items:[]});
 const [healthy]=await verifyGoogleServices('owner',undefined,true);
 assert.equal(healthy.gmail.state,'connected');assert.equal(healthy.drive.state,'connected');assert.equal(healthy.calendar.state,'connected');assert.ok(persisted.service_health.gmail.lastSuccessfulApiAt);
 globalThis.fetch=async()=>Response.json({error:{message:'Request had insufficient authentication scopes'}},{status:403});
 const [failed]=await verifyGoogleServices('owner',undefined,true);assert.equal(failed.drive.state,'reconnect');assert.match(failed.drive.error,/permission/);
 await assert.rejects(verifyGoogleServices('owner','foreign',true),/does not belong/);
}finally{globalThis.fetch=originalFetch;}
console.log('Evidence guardrails, document segmentation, safe re-analysis, logout cache clearing, API verification and scope/ownership failures passed.');
