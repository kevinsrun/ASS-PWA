import fs from 'node:fs';
import path from 'node:path';
import {loadSourceModule as load} from '../load-source-module.mjs';

// The CLI runs directly against the developer's local daemon, independent of deployment env files.
process.env.OLLAMA_ENABLED??='true';
const {runTournament,classifyModelProvider}=load('@/lib/ai/tournament');
const {generateOllamaJSON,ollamaConfiguration}=load('@/lib/ai/ollama');
const {evaluatePredictions}=load('@/lib/ai/improvementPipeline');
const {localEmailTriagePrompt,localEmailTriageSchema}=load('@/lib/ai/emailTriage');
const models=process.argv.slice(2).filter(value=>!value.startsWith('--'));
if(!models.length)throw new Error('Use npm run ai:tournament -- <installed-local-model> [...]. Cloud references must be explicit :cloud tags.');
const benchmark=fs.readFileSync('benchmarks/ass-golden-eval.v1.jsonl','utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line));
const configuration=ollamaConfiguration(),baseUrl=configuration.baseUrl.replace(/\/$/,'');
const tags=await fetch(`${baseUrl}/api/tags`).then(async response=>{if(!response.ok)throw new Error(`Ollama returned HTTP ${response.status} while listing models`);return response.json();});
const installed=new Set((tags.models??[]).flatMap(model=>[model.name,model.model].filter(Boolean)));
const timestamp=new Date().toISOString().replace(/[:.]/g,'-');
const output=path.resolve('artifacts/ai/tournaments',`${timestamp}.json`);
fs.mkdirSync(path.dirname(output),{recursive:true});
const persisted=[];
const results=await runTournament(models.map(name=>({name,provider:classifyModelProvider(name)})),{
 isInstalled:async model=>installed.has(model),
 benchmark:async model=>{
  const predictions=[];
  for(const item of benchmark){
   const input={...item.input,sender:'benchmark@example.invalid',snippet:item.input.body};
   const result=await generateOllamaJSON(localEmailTriagePrompt(input),localEmailTriageSchema,model);
   const value=result.value;
   predictions.push({id:item.id,output:value,confidence:value?.confidence,latency_ms:result.latencyMs,malformed:!value||typeof value!=='object'});
  }
  return evaluatePredictions(benchmark,predictions);
 },
 persist:async result=>{persisted.push(result);fs.writeFileSync(output,JSON.stringify({benchmark:'ass-golden-eval.v1',created_at:new Date().toISOString(),results:persisted},null,2)+'\n');},
},{cloudRetryLimit:2});
console.log(JSON.stringify({stage:'tournament_complete',output,results},null,2));
