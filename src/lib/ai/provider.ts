import type {Schema} from '@google/generative-ai';
import {getGeminiModel,rotateGeminiKey} from '@/lib/gemini';
import {generateOllamaJSON} from '@/lib/ai/ollama';
export type AITask='classify'|'extract'|'draft'|'plan';
export type AIScenario='success'|'429'|'503'|'timeout'|'slow_response'|'invalid_json'|'low_confidence'|'high_confidence'|'unavailable';
export type AIRequest={task:AITask;prompt:string;schema:Schema;timeoutMs:number};
export interface AIProvider{name:string;generateStructured(request:AIRequest):Promise<unknown>}

export class MockAIProvider implements AIProvider{
 name='mock';constructor(private scenario:AIScenario='success',private value:unknown=[]){ }
 async generateStructured(){
  if(this.scenario==='429')throw new Error('Mock provider HTTP 429');
  if(this.scenario==='503')throw new Error('Mock provider HTTP 503');
  if(this.scenario==='timeout')throw new DOMException('Mock provider timeout','TimeoutError');
  if(this.scenario==='slow_response')await new Promise(resolve=>setTimeout(resolve,50));
  if(this.scenario==='unavailable')throw new Error('Mock provider unavailable');
  if(this.scenario==='invalid_json')return '{invalid json';
  if(this.scenario==='low_confidence')return [{...this.value as object,confidence:.4,escalate:true}];
  if(this.scenario==='high_confidence')return [{...this.value as object,confidence:.99,escalate:false}];
  return structuredClone(this.value);
 }
}
class GeminiAIProvider implements AIProvider{
 name='gemini';async generateStructured(request:AIRequest){
  let result;try{result=await getGeminiModel(undefined,request.schema).generateContent(request.prompt,{timeout:request.timeoutMs});}
  catch(error){if(!String(error).includes('429'))throw error;rotateGeminiKey();result=await getGeminiModel(undefined,request.schema).generateContent(request.prompt,{timeout:request.timeoutMs});}
  return JSON.parse(result.response.text().replace(/```json|```/g,'').trim());
 }
}
class OllamaAIProvider implements AIProvider{
 name='ollama';async generateStructured(request:AIRequest){return (await generateOllamaJSON(request.prompt,request.schema as unknown as Record<string,unknown>)).value;}
}
let testProvider:AIProvider|undefined;
export function setAIProviderForTests(provider?:AIProvider){if(process.env.NODE_ENV==='production')throw new Error('Provider injection is disabled in production');testProvider=provider;}
export function getAIProvider():AIProvider{
 if(testProvider)return testProvider;
 const mode=process.env.AI_PROVIDER?.trim().toLowerCase()||'router';
 if(mode==='mock')return new MockAIProvider((process.env.AI_MOCK_SCENARIO as AIScenario)||'success');
 if(mode==='ollama')return new OllamaAIProvider();
 if(mode==='gemini'||mode==='router')return new GeminiAIProvider();
 throw new Error(`Unsupported AI_PROVIDER: ${mode}`);
}
