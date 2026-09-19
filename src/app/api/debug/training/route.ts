import {NextRequest,NextResponse} from 'next/server';
import {requireApiUser,ApiAuthError} from '@/lib/serverAuth';
import {getServiceSupabaseClient} from '@/lib/supabaseServer';
import {DeterministicCriticAgent} from '@/lib/ai/improvementPipeline';
export const runtime='nodejs';
const headers={'Cache-Control':'no-store'};
export async function GET(request:NextRequest){try{
 const user=await requireApiUser(request),db=getServiceSupabaseClient();if(!db)throw Error();
 const params=request.nextUrl.searchParams;
 if(params.get('export')==='jsonl'){
  const confidence=Number(params.get('confidence')??0);
  if(!Number.isFinite(confidence)||confidence<0||confidence>1)return NextResponse.json({error:'Confidence must be between 0 and 1'},{status:400});
  const trust=Number(params.get('trust')??.8);if(!Number.isFinite(trust)||trust<0||trust>1)return NextResponse.json({error:'Trust must be between 0 and 1'},{status:400});
  let query=db.from('model_training_examples').select('id,task_type,source_type,source_hash,input_text,final_label,trust_source,trust_score,model_confidence,created_at').eq('user_id',user.id).eq('quality','approved').eq('curation_status','eligible').eq('active',true).eq('contains_sensitive_data',false).gte('trust_score',trust);
  for(const [param,column] of [['task','task_type'],['source','correction_source']] as const){const value=params.get(param);if(value)query=query.eq(column,value);}
  if(params.has('confidence'))query=query.gte('model_confidence',confidence);
  for(const [param,operator] of [['from','gte'],['through','lte']] as const){const value=params.get(param);if(value){const date=new Date(value);if(!Number.isFinite(date.getTime()))return NextResponse.json({error:'Invalid date filter'},{status:400});query=query[operator]('created_at',date.toISOString());}}
  const result=await query.order('created_at').order('id').limit(1001);if(result.error)throw result.error;
  if((result.data?.length??0)>1000)return NextResponse.json({error:'Narrow the date range to at most 1,000 examples; export was not truncated.'},{status:413});
  return new Response((result.data??[]).map(row=>JSON.stringify({messages:[{role:'system',content:`Perform the ASS task ${row.task_type}. Return only grounded structured output.`},{role:'user',content:row.input_text},{role:'assistant',content:JSON.stringify(row.final_label)}],metadata:{id:row.id,task_type:row.task_type,source_type:row.source_type,source_hash:row.source_hash,trust_source:row.trust_source,trust_score:row.trust_score,model_confidence:row.model_confidence}})).join('\n')+((result.data?.length??0)?'\n':''),{headers:{...headers,'Content-Type':'application/x-ndjson','Content-Disposition':'attachment; filename="ass-training.jsonl"'}});
 }
 const [preference,examples]=await Promise.all([db.from('model_training_preferences').select('enabled,retention_days').eq('user_id',user.id).maybeSingle(),db.from('model_training_examples').select('id,task_type,input_text,final_label,correction_source,quality,curation_status,trust_source,trust_score,source_type,source_id,active,created_at').eq('user_id',user.id).eq('active',true).order('created_at',{ascending:false}).limit(50)]);
 if(preference.error||examples.error)throw Error();return NextResponse.json({enabled:preference.data?.enabled??false,examples:examples.data??[]}, {headers});
 }catch(error){return NextResponse.json({error:error instanceof ApiAuthError?error.message:'Training data unavailable'},{status:error instanceof ApiAuthError?error.status:500,headers});}}
export async function POST(request:NextRequest){try{
 const user=await requireApiUser(request),db=getServiceSupabaseClient();if(!db)throw Error();const body=await request.json();
 if(typeof body.enabled==='boolean'){
  const result=await db.from('model_training_preferences').upsert({user_id:user.id,enabled:body.enabled,updated_at:new Date().toISOString()});if(result.error)throw result.error;
 }else if(typeof body.id==='string'&&['approved','rejected'].includes(body.quality)){
  const current=await db.from('model_training_examples').select('id,user_id,task_type,source_type,source_id,input_text,final_label,model_prediction,trust_source,trust_score,quality,curation_status,active').eq('user_id',user.id).eq('id',body.id).maybeSingle();if(current.error)throw current.error;if(!current.data)return NextResponse.json({error:'Example not found'},{status:404});const review=body.quality==='rejected'?{verdict:'REJECT' as const,rationale:['Owner rejected the example'],confidence:1}:new DeterministicCriticAgent().review(current.data as never);const curation=body.quality==='rejected'?'rejected':review.verdict==='APPROVE'?'eligible':review.verdict==='CONFLICT'?'conflict':'proposed';
  const result=await db.from('model_training_examples').update({quality:body.quality,curation_status:curation}).eq('user_id',user.id).eq('id',body.id).select('id');if(result.error)throw result.error;if(!result.data?.length)return NextResponse.json({error:'Example not found'},{status:404});return NextResponse.json({ok:true,critic:review,curation_status:curation},{headers});
 }else return NextResponse.json({error:'Invalid request'},{status:400});
 return NextResponse.json({ok:true},{headers});
 }catch(error){return NextResponse.json({error:error instanceof ApiAuthError?error.message:'Training data update failed'},{status:error instanceof ApiAuthError?error.status:500,headers});}}
export async function PATCH(request:NextRequest){try{
 const user=await requireApiUser(request),db=getServiceSupabaseClient();if(!db)throw Error();const body=await request.json();const days=body.retentionDays;
 if(![30,90,180,365,-1].includes(days))return NextResponse.json({error:'Retention must be 30, 90, 180, 365 days, or forever.'},{status:400});
 const result=await db.from('model_training_preferences').upsert({user_id:user.id,retention_days:days,updated_at:new Date().toISOString()});if(result.error)throw result.error;
 return NextResponse.json({ok:true},{headers});
 }catch(error){return NextResponse.json({error:error instanceof ApiAuthError?error.message:'Retention update failed'},{status:error instanceof ApiAuthError?error.status:500,headers});}}
export async function DELETE(request:NextRequest){try{
 const user=await requireApiUser(request),db=getServiceSupabaseClient();if(!db)throw Error();const id=request.nextUrl.searchParams.get('id');
 let query=db.from('model_training_examples').delete().eq('user_id',user.id);if(id)query=query.eq('id',id);
 const result=await query.select('id');if(result.error)throw result.error;if(id&&!result.data?.length)return NextResponse.json({error:'Example not found'},{status:404});
 return NextResponse.json({ok:true,deleted:result.data?.length??0},{headers});
 }catch(error){return NextResponse.json({error:error instanceof ApiAuthError?error.message:'Training data deletion failed'},{status:error instanceof ApiAuthError?error.status:500,headers});}}
