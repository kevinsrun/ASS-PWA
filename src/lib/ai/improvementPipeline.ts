import {createHash} from 'node:crypto';

export const TRUST_SCORES={USER_CORRECTION:1,DETERMINISTIC_VERIFIED:1,STRONG_MODEL_REVIEWED:.95,STRONG_MODEL_PSEUDO_LABEL:.8,LOCAL_MODEL_REVIEWED:.6,LOCAL_MODEL_PREDICTION:.2} as const;
export type TrustSource=keyof typeof TRUST_SCORES;
export type CriticVerdict='APPROVE'|'REJECT'|'NEEDS_REVIEW'|'CONFLICT';
export type PipelineExample={id:string;user_id?:string;task_type:string;source_type:string;source_id:string;source_hash?:string;input_text:string;context_json?:Record<string,unknown>;final_label:unknown;model_prediction?:unknown;trust_source:TrustSource;trust_score:number;quality:string;curation_status:string;active:boolean;contains_sensitive_data?:boolean;created_at?:string};
export type CuratedExample=PipelineExample&{source_hash:string;split:'train'|'validation'|'test'};
export type EvalCase={id:string;category:string;expected:Record<string,unknown>;critical?:boolean;error_weight?:number};
export type Prediction={id:string;output?:Record<string,unknown>;confidence?:number;latency_ms?:number;tokens_per_second?:number;memory_bytes?:number;malformed?:boolean};

const secretPatterns=[
 /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password)\s*[:=]\s*[^\s,;]+/gi,
 /\bBearer\s+[A-Za-z0-9._~+\/-]+/gi,
 /\b(?:sk|sb_secret)_[A-Za-z0-9_-]{12,}\b/g,
 /\b\d{12,19}\b/g,
];
export function redactTrainingText(value:string){return secretPatterns.reduce((text,pattern)=>text.replace(pattern,'[REDACTED]'),value).slice(0,50_000);}
export function stableHash(value:string){return createHash('sha256').update(value).digest('hex');}
export function stableIdentity(example:Pick<PipelineExample,'user_id'|'source_type'|'source_id'|'task_type'>){return `${example.user_id??'owner'}:${example.source_type}:${example.source_id}:${example.task_type}`;}
export function deterministicSplit(sourceHash:string):'train'|'validation'|'test'{const bucket=Number.parseInt(sourceHash.slice(0,8),16)%100;return bucket<80?'train':bucket<90?'validation':'test';}

export class LabelingAgent{
 propose(example:Omit<PipelineExample,'trust_source'|'trust_score'|'quality'|'curation_status'|'active'>,prediction:unknown):PipelineExample{
  return {...example,model_prediction:prediction,final_label:prediction,trust_source:'LOCAL_MODEL_PREDICTION',trust_score:TRUST_SCORES.LOCAL_MODEL_PREDICTION,quality:'needs_review',curation_status:'proposed',active:true};
 }
}
export class DeterministicCriticAgent{
 review(example:PipelineExample,prior?:PipelineExample):{verdict:CriticVerdict;rationale:string[];confidence:number}{
  const rationale:string[]=[];const label=example.final_label as Record<string,unknown>;const type=String(label?.type??label?.classification??'UNKNOWN');const text=example.input_text;
  if(!example.source_type||!example.source_id||!example.task_type)rationale.push('Missing stable source identity');
  if(!label||typeof label!=='object')rationale.push('Malformed expected output');
  if(type==='CALENDAR_EVENT'||type==='EVENT'){if(!/\b\d{1,2}[:/]\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text))rationale.push('Calendar event lacks explicit date or time evidence');if(/\b(?:optional|may attend|if interested|example|sample)\b/i.test(text))rationale.push('Event evidence is optional or illustrative');}
  if(type==='DEADLINE'&&!/\b(?:due|deadline|closes?|by|before|no later than)\b/i.test(text))rationale.push('Deadline lacks explicit cutoff language');
  if(prior&&JSON.stringify(prior.final_label)!==JSON.stringify(example.final_label))return{verdict:'CONFLICT',rationale:['A prior canonical correction disagrees'],confidence:1};
  if(rationale.some(item=>item.startsWith('Missing')||item.startsWith('Malformed')))return{verdict:'REJECT',rationale,confidence:1};
  if(rationale.length)return{verdict:'NEEDS_REVIEW',rationale,confidence:.95};
  return{verdict:'APPROVE',rationale:['Deterministic consistency checks passed'],confidence:.9};
 }
}

export class DatasetCurator{
 curate(rows:PipelineExample[],options:{trustThreshold?:number;excludeSensitive?:boolean;benchmarkHashes?:Set<string>}={}):{eligible:CuratedExample[];excluded:Array<{id:string;reason:string}>;distribution:Record<string,number>}{
  const threshold=options.trustThreshold??.8,excluded:Array<{id:string;reason:string}>=[],canonical=new Map<string,PipelineExample>();
  for(const row of [...rows].sort((a,b)=>String(a.created_at??'').localeCompare(String(b.created_at??''))))canonical.set(stableIdentity(row),row);
  const eligible:CuratedExample[]=[];const distribution:Record<string,number>={};
  for(const row of rows){const identity=stableIdentity(row),sourceHash=row.source_hash&&/^[a-f0-9]{64}$/.test(row.source_hash)?row.source_hash:stableHash(identity);
   let reason='';if(canonical.get(identity)?.id!==row.id)reason='superseded';else if(!row.active)reason='inactive';else if(row.quality!=='approved'||row.curation_status!=='eligible')reason='not approved and eligible';else if(row.trust_score<threshold)reason='below trust threshold';else if(!row.source_type||!row.source_id||!row.task_type)reason='missing source identity';else if(options.excludeSensitive!==false&&row.contains_sensitive_data)reason='sensitive';else if(options.benchmarkHashes?.has(sourceHash))reason='golden benchmark contamination';else if(!row.final_label||typeof row.final_label!=='object')reason='malformed output';
   if(!reason&&options.benchmarkHashes?.has(stableHash(row.input_text)))reason='golden benchmark contamination';
   if(reason){excluded.push({id:row.id,reason});continue;}const clean={...row,input_text:redactTrainingText(row.input_text),source_hash:sourceHash,split:deterministicSplit(sourceHash)} as CuratedExample;eligible.push(clean);const label=String((row.final_label as Record<string,unknown>).type??(row.final_label as Record<string,unknown>).classification??'UNKNOWN');distribution[label]=(distribution[label]??0)+1;
  }
  return{eligible,excluded,distribution};
 }
}

const confidenceBuckets=[[0,.5],[.5,.75],[.75,.9],[.9,.95],[.95,1.000001]] as const;
export function evaluatePredictions(cases:EvalCase[],predictions:Prediction[]){
 const byId=new Map(predictions.map(item=>[item.id,item])),classes=new Set<string>(),rows:Array<{expected:string;predicted:string;correct:boolean;weight:number;confidence:number|null;category:string;malformed:boolean;latency:number|null;tokensPerSecond:number|null;memoryBytes:number|null}>=[];
 for(const item of cases){const prediction=byId.get(item.id),expected=String(item.expected.classification??item.expected.type??'UNKNOWN'),predicted=String(prediction?.output?.classification??prediction?.output?.type??'MALFORMED'),malformed=!prediction||prediction.malformed===true||predicted==='MALFORMED',matchesExpected=!malformed&&Object.entries(item.expected).every(([key,value])=>JSON.stringify(prediction?.output?.[key])===JSON.stringify(value));classes.add(expected);classes.add(predicted);rows.push({expected,predicted,correct:matchesExpected,weight:item.error_weight??1,confidence:Number.isFinite(prediction?.confidence)?Number(prediction?.confidence):null,category:item.category,malformed,latency:Number.isFinite(prediction?.latency_ms)?Number(prediction?.latency_ms):null,tokensPerSecond:Number.isFinite(prediction?.tokens_per_second)?Number(prediction?.tokens_per_second):null,memoryBytes:Number.isFinite(prediction?.memory_bytes)?Number(prediction?.memory_bytes):null});}
 const perClass:Record<string,{precision:number;recall:number;f1:number;support:number}>={};for(const label of classes){const tp=rows.filter(r=>r.expected===label&&r.predicted===label).length,fp=rows.filter(r=>r.expected!==label&&r.predicted===label).length,fn=rows.filter(r=>r.expected===label&&r.predicted!==label).length;const precision=tp/(tp+fp||1),recall=tp/(tp+fn||1);perClass[label]={precision,recall,f1:2*precision*recall/(precision+recall||1),support:tp+fn};}
 const calibration=confidenceBuckets.map(([min,max])=>{const bucket=rows.filter(r=>r.confidence!==null&&r.confidence>=min&&r.confidence<max);return{range:`${min.toFixed(2)}-${Math.min(max,1).toFixed(2)}`,count:bucket.length,accuracy:bucket.length?bucket.filter(r=>r.correct).length/bucket.length:null};});
 const totalWeight=rows.reduce((sum,row)=>sum+row.weight,0),penalty=rows.filter(r=>!r.correct).reduce((sum,row)=>sum+row.weight,0),latencies=rows.flatMap(r=>r.latency===null?[]:[r.latency]),throughput=rows.flatMap(r=>r.tokensPerSecond===null?[]:[r.tokensPerSecond]),memory=rows.flatMap(r=>r.memoryBytes===null?[]:[r.memoryBytes]);
 const categoryAccuracy=(name:string)=>{const selected=rows.filter(r=>r.category===name);return selected.length?selected.filter(r=>r.correct).length/selected.length:null;};
 return{total:rows.length,correct:rows.filter(r=>r.correct).length,accuracy:rows.length?rows.filter(r=>r.correct).length/rows.length:0,weighted_score:totalWeight?1-penalty/totalWeight:0,per_class:perClass,false_calendar_event_rate:rows.filter(r=>r.expected!=='EVENT').length?rows.filter(r=>r.expected!=='EVENT'&&r.predicted==='EVENT').length/rows.filter(r=>r.expected!=='EVENT').length:0,deadline_accuracy:categoryAccuracy('deadline_extraction'),response_needed_accuracy:categoryAccuracy('response_needed'),required_optional_accuracy:categoryAccuracy('required_optional'),tool_routing_accuracy:categoryAccuracy('tool_routing'),malformed_rate:rows.length?rows.filter(r=>r.malformed).length/rows.length:0,average_latency_ms:latencies.length?latencies.reduce((a,b)=>a+b,0)/latencies.length:null,average_tokens_per_second:throughput.length?throughput.reduce((a,b)=>a+b,0)/throughput.length:null,peak_memory_bytes:memory.length?Math.max(...memory):null,calibration};
}

export type EvaluationMetrics=ReturnType<typeof evaluatePredictions>;
export function promotionDecision(candidate:EvaluationMetrics,current:EvaluationMetrics,config:{criticalRecall?:number;maxLatencyRatio?:number}={}){
 const criticalRecall=config.criticalRecall??.9,maxLatencyRatio=config.maxLatencyRatio??1.5,candidateCritical=Math.min(...['DEADLINE','EVENT','TASK'].map(label=>candidate.per_class[label]?.recall??1));
 const gates={overall:candidate.accuracy>=current.accuracy,weighted:candidate.weighted_score>current.weighted_score,false_calendar:candidate.false_calendar_event_rate<=current.false_calendar_event_rate,malformed:candidate.malformed_rate<=current.malformed_rate,critical_recall:candidateCritical>=criticalRecall,latency:current.average_latency_ms===null||candidate.average_latency_ms===null||candidate.average_latency_ms<=current.average_latency_ms*maxLatencyRatio};
 return{eligible:Object.values(gates).every(Boolean),gates};
}

const safeLocalDefaults=new Set(['email_triage','newsletter_detection','spam_classification','reference_detection','response_preclassification']);
export function localTaskPermission(task:string,raw=process.env.LOCAL_MODEL_TASKS){if(!raw)return safeLocalDefaults.has(task);try{const parsed=JSON.parse(raw) as Record<string,boolean>;return parsed[task]===true;}catch{return false;}}

export class PromotionAgent{decide(candidate:EvaluationMetrics,current:EvaluationMetrics){return promotionDecision(candidate,current);}}
export class RollbackAgent{plan(active:string,target:string){if(!active||!target||active===target)throw new Error('Rollback requires distinct active and target model tags');return{from:active,to:target,requiresRebuild:false,humanApprovalRequired:true};}}
