import fs from "node:fs";import path from "node:path";import ts from "typescript";import {createRequire} from "node:module";
const require=createRequire(import.meta.url),cache=new Map();
function sourcePath(name,importer){
 const base=name.startsWith('@/')?path.resolve('src',name.slice(2)):path.resolve(path.dirname(importer),name);
 return path.extname(base)?base:`${base}.ts`;
}
export function loadSourceModule(name,importer=path.resolve('src','__root__.ts')){
 const file=sourcePath(name,importer);if(cache.has(file))return cache.get(file).exports;
 const loadedModule={exports:{}};cache.set(file,loadedModule);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)(request=>request.startsWith('@/')||request.startsWith('.')?loadSourceModule(request,file):require(request),loadedModule,loadedModule.exports);
 return loadedModule.exports;
}
