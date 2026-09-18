import {createHash} from 'node:crypto';
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
  const sourceKey=createHash('sha256').update(JSON.stringify([input.sourceType,input.sourceId,input.originalText,input.correctedLabel])).digest('hex');
  const result=await db.from('model_training_examples').upsert({user_id:userId,source_key:sourceKey,task_type:input.sourceType==='email'?'email_triage':input.sourceType==='email_draft'?'response_needed':'document_classification',input_text:input.originalText.slice(0,50000),context_json:{source_type:input.sourceType,user_action:input.userAction},model_prediction:input.predictedLabel??null,model_confidence:typeof input.confidence==='number'&&input.confidence>=0&&input.confidence<=1?input.confidence:null,final_label:input.correctedLabel,correction_source:'USER_CORRECTION',quality:'needs_review'},{onConflict:'user_id,source_key',ignoreDuplicates:true});
  if(result.error)throw result.error;
 }catch{console.warn('[ai-training] Correction candidate collection failed');}
}
