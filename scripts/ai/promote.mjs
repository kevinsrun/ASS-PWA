import fs from 'node:fs';
import {args,database,pipeline,run} from './common.mjs';

const options=args();
const candidate=JSON.parse(fs.readFileSync(String(options.candidate??''),'utf8')).metrics;
const current=JSON.parse(fs.readFileSync(String(options.current??''),'utf8')).metrics;
const decision=pipeline.promotionDecision(candidate,current);
if(!decision.eligible)throw new Error(`Candidate rejected: ${JSON.stringify(decision.gates)}`);
if(!options.apply){console.log(JSON.stringify({stage:'promotion_eligible',human_approval_required:true,...decision}));process.exit(0);}
if(process.env.HUMAN_MODEL_PROMOTION_APPROVED!=='true')throw new Error('Explicit human approval environment is required');
const candidateId=String(options['candidate-id']??''),userId=String(options['user-id']??''),tag=String(options.tag??''),alias=String(options.alias??'ass-local-production');
if(!candidateId||!userId||!tag)throw new Error('Apply requires --candidate-id, --user-id and --tag');
const db=database();
const activate=options['execute-ollama']===true;
const active=activate?await db.from('model_deployments').select('ollama_model_name').eq('user_id',userId).eq('status','active').maybeSingle():{data:null,error:null};
if(active.error)throw active.error;
if(activate)run('ollama',['cp',tag,alias]);
const scored=await db.from('model_candidates').update({status:'approved',approved_at:new Date().toISOString(),eval_score:candidate.accuracy,weighted_eval_score:candidate.weighted_score}).eq('id',candidateId).eq('user_id',userId).in('status',['candidate','evaluating','approved']).select('id').single();
if(scored.error)throw scored.error;
if(activate){
 const promoted=await db.rpc('promote_model_candidate',{p_user_id:userId,p_candidate_id:candidateId,p_approved_by:userId,p_notes:`Ollama alias ${alias} activated after human approval`});
 if(promoted.error){if(active.data?.ollama_model_name)run('ollama',['cp',active.data.ollama_model_name,alias]);else run('ollama',['rm',alias]);throw promoted.error;}
 console.log(JSON.stringify({stage:'promotion_complete',candidate_id:candidateId,deployment_id:promoted.data,alias,...decision}));
}else{
 const audit=await db.from('model_pipeline_audit').insert({user_id:userId,stage:'promotion',action:'approve',object_type:'model_candidate',object_id:candidateId,status:'approved',details:{gates:decision.gates,tag,alias,ollama_alias_updated:false}});
 if(audit.error)throw audit.error;
 console.log(JSON.stringify({stage:'candidate_approved',candidate_id:candidateId,alias,...decision}));
}
