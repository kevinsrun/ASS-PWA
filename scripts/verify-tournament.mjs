import assert from 'node:assert/strict';
import {loadSourceModule as load} from './load-source-module.mjs';
const {classifyModelProvider,classifyTournamentFailure,runTournament}=load('@/lib/ai/tournament');
assert.equal(classifyModelProvider('gemma4:31b:cloud'),'OLLAMA_CLOUD');
assert.equal(classifyModelProvider('gemma3:4b'),'LOCAL');
for(const error of ['ollama cloud is disabled: remote model is unavailable','stream disconnected before completion','Ollama returned HTTP 503'])assert.equal(classifyTournamentFailure(new Error(error),'OLLAMA_CLOUD').code,'CLOUD_PROVIDER_UNAVAILABLE');
const persisted=[],calls=[];
const results=await runTournament([{name:'gemma4:31b:cloud'},{name:'gemma3:4b'}],{
 isInstalled:async model=>model==='gemma3:4b',
 benchmark:async model=>{calls.push(model);if(model.endsWith(':cloud'))throw new Error('stream disconnected before completion: ollama cloud is disabled: remote model is unavailable');return{correct:12,total:12,accuracy:1};},
 persist:async result=>{persisted.push(result);},wait:async()=>{},
},{cloudRetryLimit:2,cloudRetryBaseMs:0});
assert.equal(results[0].provider_status,'CLOUD_PROVIDER_UNAVAILABLE');
assert.equal(results[0].display_status,'UNAVAILABLE / RETRY LATER');
assert.equal(results[0].quality_eligible,false);
assert.equal(results[0].metrics,undefined,'unavailable cloud references do not receive a benchmark score');
assert.equal(results[0].attempts,3,'cloud retries are capped');
assert.equal(results[1].provider,'LOCAL');
assert.equal(results[1].provider_status,'AVAILABLE');
assert.equal(results[1].quality_eligible,true);
assert.deepEqual(calls,['gemma4:31b:cloud','gemma4:31b:cloud','gemma4:31b:cloud','gemma3:4b']);
assert.equal(persisted.length,2);
console.log('Tournament regression tests passed: remote unavailable, stream disconnect, 503 classification, capped cloud retries, and local continuation without cloud dependency.');
