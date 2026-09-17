import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
const calls=[];let failure=503,failFallback=false;
class GoogleGenerativeAI{getGenerativeModel(options){return {model:options.model,generateContent:async()=>{calls.push(options);if(options.model.includes('3.8')||failFallback)throw Object.assign(new Error('Model no longer available'),{status:failure});return {response:{text:()=> 'OK'}};}};}}
process.env.GEMINI_API_KEYS='fixture';delete process.env.GEMINI_MODEL;delete process.env.GEMINI_FALLBACK_MODEL;
const loaded={exports:{}};
new Function('require','module','exports',ts.transpileModule(fs.readFileSync('src/lib/gemini.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(()=>({GoogleGenerativeAI}),loaded,loaded.exports);
assert.equal((await loaded.exports.getGeminiModel().generateContent('test')).response.text(),'OK');assert.equal(calls.length,2);assert.equal(calls[1].model,'gemini-3.6-flash');
for(const status of [401,403,429,500]){failure=status;calls.length=0;await assert.rejects(loaded.exports.getGeminiModel().generateContent('test'));assert.equal(calls.length,1);}
failure=404;calls.length=0;const schema={type:'object',properties:{}};await loaded.exports.getGeminiModel(undefined,schema).generateContent('test');assert.deepEqual(calls[1].generationConfig.responseSchema,schema);
failure=503;failFallback=true;calls.length=0;await assert.rejects(loaded.exports.getGeminiModel().generateContent('test'));assert.equal(calls.length,2);
console.log('Gemini availability fallback is bounded, preserves schemas, and never masks credentials, permission or quota failures.');
