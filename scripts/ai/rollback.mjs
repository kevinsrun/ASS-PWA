import {args,database,run} from './common.mjs';

const options=args();
if(!options.apply){console.log(JSON.stringify({stage:'rollback_plan',human_approval_required:true,target:options.tag??null,requires_rebuild:false}));process.exit(0);}
if(process.env.HUMAN_MODEL_PROMOTION_APPROVED!=='true')throw new Error('Explicit human approval environment is required');
const userId=String(options['user-id']??''),deploymentId=String(options['deployment-id']??''),tag=String(options.tag??''),alias=String(options.alias??'ass-local-production');
if(!userId||!deploymentId||!tag)throw new Error('Apply requires --user-id, --deployment-id and --tag');
const db=database();
if(options['execute-ollama']!==true)throw new Error('Rollback activation requires --execute-ollama so runtime and registry cannot diverge');
const active=await db.from('model_deployments').select('ollama_model_name').eq('user_id',userId).eq('status','active').single();
if(active.error)throw active.error;
run('ollama',['cp',tag,alias]);
const rolledBack=await db.rpc('rollback_model_deployment',{p_user_id:userId,p_target_deployment_id:deploymentId,p_approved_by:userId,p_notes:`Ollama alias ${alias} rolled back after human approval`});
if(rolledBack.error){run('ollama',['cp',active.data.ollama_model_name,alias]);throw rolledBack.error;}
console.log(JSON.stringify({stage:'rollback_complete',deployment_id:rolledBack.data,tag,alias}));
