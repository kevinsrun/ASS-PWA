import {loadSourceModule as load} from './load-source-module.mjs';
const db=load('@/lib/supabaseServer').getServiceSupabaseClient();if(!db)throw new Error('Cloud Tasks is not configured');
const owners=await db.from('google_tokens').select('user_id').is('disconnected_at',null);if(owners.error)throw owners.error;const ids=[...new Set((owners.data??[]).map(row=>row.user_id))],userId=process.env.ASS_TEST_USER_ID??(ids.length===1?ids[0]:null);if(!userId)throw new Error('Set ASS_TEST_USER_ID; refusing an unscoped backfill');
const accounts=await load('@/lib/googleServiceHealth').verifyGoogleServices(userId,undefined,true);if(accounts.some(account=>account.gmail.state!=='connected'))throw new Error('Verify Gmail authentication before backfill');
const pattern=/\b(?:application|apply|form|submit|due|register|registration|respond|complete|upload)\b/i;
async function allRows(query){const data=[];for(let offset=0;;offset+=500){const page=await query().range(offset,offset+499);if(page.error)throw page.error;data.push(...(page.data??[]));if((page.data??[]).length<500)return {data};}}
const suggestions=await allRows(()=>db.from('email_suggestions').select('id,google_account_id,external_id,title,summary').eq('user_id',userId).eq('status','pending').eq('suppressed',false).order('id'));
const sources=await allRows(()=>db.from('imported_sources').select('id,content').eq('user_id',userId).order('id'));
const files=await allRows(()=>db.from('file_extractions').select('id,imported_file_id,imported_source_id,source_text,summary').eq('user_id',userId).order('created_at',{ascending:false}).order('id'));
const emails=(suggestions.data??[]).filter(item=>pattern.test(`${item.title}\n${item.summary}`));
const documents=new Map();for(const source of sources.data??[])if(pattern.test(source.content??''))documents.set(`source:${source.id}`,{sourceId:source.id});
const seen=new Set();for(const file of files.data??[]){if(!file.imported_file_id||seen.has(file.imported_file_id))continue;seen.add(file.imported_file_id);if(pattern.test(`${file.source_text??''}\n${file.summary??''}`)){if(file.imported_source_id)documents.delete(`source:${file.imported_source_id}`);documents.set(`file:${file.imported_file_id}`,{fileId:file.imported_file_id});}}
console.log(JSON.stringify({stage:'backfill-inventory',candidateEmails:emails.length,candidateDocuments:documents.size,apply:process.argv.includes('--apply')}));
if(!process.argv.includes('--apply'))process.exit(0);
// Do not churn historical source state when the configured provider is unavailable.
try{await load('@/lib/gemini').getGeminiModel(undefined,undefined,'low').generateContent('Return only OK.',{timeout:20000});}catch(error){console.error(JSON.stringify({stage:'backfill-blocked',reason:'Gemini generation must succeed before historical reclassification',error:error.message}));process.exit(1);}
for(const item of emails){const result=await load('@/lib/gmailScan').scanRecentGmailSuggestions(userId,item.google_account_id,item.external_id,1);console.log(JSON.stringify({stage:'email-backfill',sourceId:item.id,analyzed:result.emailsScanned,errors:result.failures}));if(result.failures.length)process.exitCode=1;}
for(const scope of documents.values()){try{const result=await load('@/lib/documentReanalysis').reanalyzeSource(userId,scope);console.log(JSON.stringify({stage:'document-backfill',scope,fulfillment:result.fulfillment}));}catch(error){console.log(JSON.stringify({stage:'document-backfill-failed',scope,error:error.message}));process.exitCode=1;}}
