import {getServiceSupabaseClient} from '@/lib/supabaseServer';

// Candidates only: a correction is not automatically a reviewed training label.
export async function collectCorrection(userId:string,input:{sourceType:string;sourceId:string;originalText?:string;predictedLabel?:string|null;confidence?:number|null;correctedLabel?:string|null;userAction:string}){
 if(!input.correctedLabel?.trim()||!input.originalText?.trim())return;
 // Draft feedback contains generated draft text, not incoming-mail evidence.
 if(!['email','file'].includes(input.sourceType))return;
 // RSVP preferences are not document/email classification ground truth.
 if(['going','not_going','maybe'].includes(input.correctedLabel))return;
 try{
  const db=getServiceSupabaseClient();if(!db)return;
  const preference=await db.from('model_training_preferences').select('enabled').eq('user_id',userId).maybeSingle();
  if(preference.error||!preference.data?.enabled)return;
  const taskType=input.sourceType==='email'?'email_triage':'document_classification';
  const result=await db.rpc('collect_model_training_correction',{p_user_id:userId,p_source_type:input.sourceType,p_source_id:input.sourceId,p_task_type:taskType,p_input_text:input.originalText.slice(0,50000),p_context_json:{source_type:input.sourceType,user_action:input.userAction},p_model_prediction:input.predictedLabel??null,p_model_confidence:typeof input.confidence==='number'&&input.confidence>=0&&input.confidence<=1?input.confidence:null,p_final_label:input.correctedLabel});
  if(result.error)throw result.error;
 }catch{console.warn('[ai-training] Correction candidate collection failed');}
}
