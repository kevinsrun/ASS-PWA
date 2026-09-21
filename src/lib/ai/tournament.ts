export type ModelProvider='LOCAL'|'OLLAMA_CLOUD'|'OTHER_CLOUD';
export type ProviderStatus='AVAILABLE'|'CLOUD_PROVIDER_UNAVAILABLE'|'FAILED';

export type TournamentModel={name:string;provider?:ModelProvider;sizeBytes?:number};
export type TournamentFailure={code:'CLOUD_PROVIDER_UNAVAILABLE'|'MODEL_UNAVAILABLE'|'MODEL_EXECUTION_FAILED';message:string;retryable:boolean};
export type TournamentResult={
 model:string;provider:ModelProvider;provider_status:ProviderStatus;display_status:string;quality_eligible:boolean;
 attempts:number;error?:TournamentFailure;metrics?:Record<string,unknown>;
};
export type TournamentDependencies={
 isInstalled:(model:string)=>Promise<boolean>;
 benchmark:(model:string)=>Promise<Record<string,unknown>>;
 persist:(result:TournamentResult)=>Promise<void>;
 wait?:(milliseconds:number)=>Promise<void>;
};

const CLOUD_UNAVAILABLE=/ollama cloud is disabled|remote model is unavailable|stream disconnected before completion|\b503\b|service unavailable/i;

export function classifyModelProvider(model:string,explicit?:ModelProvider):ModelProvider{
 if(explicit)return explicit;
 return /:cloud$/i.test(model)?'OLLAMA_CLOUD':'LOCAL';
}

export function classifyTournamentFailure(error:unknown,provider:ModelProvider):TournamentFailure{
 const message=error instanceof Error?error.message:String(error);
 if(provider==='OLLAMA_CLOUD'&&CLOUD_UNAVAILABLE.test(message))return{code:'CLOUD_PROVIDER_UNAVAILABLE',message,retryable:true};
 return{code:provider==='LOCAL'?'MODEL_UNAVAILABLE':'MODEL_EXECUTION_FAILED',message,retryable:false};
}

function unavailableResult(model:string,provider:ModelProvider,attempts:number,error:TournamentFailure):TournamentResult{
 return {model,provider,provider_status:'CLOUD_PROVIDER_UNAVAILABLE',display_status:'UNAVAILABLE / RETRY LATER',quality_eligible:false,attempts,error};
}

/** Runs each candidate in isolation. Cloud references are diagnostic-only and cannot alter local scores. */
export async function runTournament(models:TournamentModel[],dependencies:TournamentDependencies,options:{cloudRetryLimit?:number;cloudRetryBaseMs?:number}={}):Promise<TournamentResult[]>{
 const cloudRetryLimit=Math.max(0,Math.min(options.cloudRetryLimit??2,3));
 const cloudRetryBaseMs=Math.max(0,options.cloudRetryBaseMs??250);
 const wait=dependencies.wait??(milliseconds=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds)));
 const results:TournamentResult[]=[];
 for(const candidate of models){
  const provider=classifyModelProvider(candidate.name,candidate.provider);
  if(provider==='LOCAL'&&!(await dependencies.isInstalled(candidate.name))){
   const result:TournamentResult={model:candidate.name,provider,provider_status:'FAILED',display_status:'NOT INSTALLED',quality_eligible:false,attempts:0,error:{code:'MODEL_UNAVAILABLE',message:'Model is not installed locally',retryable:false}};
   await dependencies.persist(result);results.push(result);continue;
  }
  let attempts=0;
  for(;;){
   attempts++;
   try{
    const metrics=await dependencies.benchmark(candidate.name);
    const result:TournamentResult={model:candidate.name,provider,provider_status:'AVAILABLE',display_status:provider==='OLLAMA_CLOUD'?'CLOUD REFERENCE':'AVAILABLE',quality_eligible:provider==='LOCAL',attempts,metrics};
    await dependencies.persist(result);results.push(result);break;
   }catch(error){
    const failure=classifyTournamentFailure(error,provider);
    if(failure.code==='CLOUD_PROVIDER_UNAVAILABLE'){
     if(attempts<=cloudRetryLimit){await wait(Math.min(cloudRetryBaseMs*2**(attempts-1),2000));continue;}
     const result=unavailableResult(candidate.name,provider,attempts,failure);
     await dependencies.persist(result);results.push(result);break;
    }
    const result:TournamentResult={model:candidate.name,provider,provider_status:'FAILED',display_status:'FAILED',quality_eligible:false,attempts,error:failure};
    await dependencies.persist(result);results.push(result);break;
   }
  }
 }
 return results;
}
