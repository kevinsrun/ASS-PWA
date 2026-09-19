import {getServiceSupabaseClient} from '@/lib/supabaseServer';
export async function recordShadowPrediction(input:{userId:string;candidateId:string;taskType:string;sourceHash:string;productionOutput:unknown;candidateOutput:unknown;candidateConfidence?:number;latencyMs?:number}){
 const db=getServiceSupabaseClient();if(!db)throw new Error('Supabase server key is not configured');
 const result=await db.from('model_shadow_predictions').insert({user_id:input.userId,candidate_id:input.candidateId,task_type:input.taskType,source_hash:input.sourceHash,production_output:input.productionOutput,candidate_output:input.candidateOutput,candidate_confidence:input.candidateConfidence,agreed:JSON.stringify(input.productionOutput)===JSON.stringify(input.candidateOutput),latency_ms:input.latencyMs});if(result.error)throw result.error;
 // Shadow output is audit-only: this helper deliberately returns no action/result.
}
export async function queueHardExample(input:{userId:string;trainingExampleId?:string;sourceType:string;sourceId:string;taskType:string;reason:string;errorCategory?:string;difficultyScore:number;disagreementScore:number}){
 const db=getServiceSupabaseClient();if(!db)throw new Error('Supabase server key is not configured');const result=await db.from('model_hard_examples').upsert({user_id:input.userId,training_example_id:input.trainingExampleId,source_type:input.sourceType,source_id:input.sourceId,task_type:input.taskType,reason:input.reason,error_category:input.errorCategory,difficulty_score:input.difficultyScore,disagreement_score:input.disagreementScore,status:'queued'},{onConflict:'user_id,source_type,source_id,task_type,reason'});if(result.error)throw result.error;
}
