"use client";

import {useCallback,useEffect,useState} from 'react';
import {useAuth} from '@/providers/AuthProvider';

type Registry={
 ollama:{enabled:boolean;model?:string};current:{ollama_model_name:string}|null;
 datasets:Array<{name:string;version:number;example_count:number;invalidated_at:string|null}>;
 runs:Array<{base_model:string;method:string;status:string;created_at:string}>;
 candidates:Array<{id:string;name:string;version:number;status:string;eval_score:number|null;weighted_eval_score:number|null}>;
 evaluations:Array<{status:string;metrics:Record<string,number>;gates_passed:boolean}>;
 permissions:Array<{task_type:string;enabled:boolean;min_accuracy:number;min_confidence:number}>;
 baseline:{model_name:string;correct:number;total:number;accuracy:number};shadow_predictions:number;
 cost_metrics:{deterministic_requests:number;local_requests:number;cloud_requests:number;gemini_requests_avoided:number;estimated_cloud_cost_avoided_usd:number;local_resolution_rate:number;average_recorded_latency_ms:number|null};
};

export default function Models(){
 const {session}=useAuth(),token=session?.access_token;
 const [data,setData]=useState<Registry|null>(null),[error,setError]=useState('');
 const load=useCallback(async()=>{if(!token)return;const response=await fetch('/api/debug/models',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!response.ok){setError('Model registry unavailable');return;}setError('');setData(await response.json());},[token]);
 useEffect(()=>{void load();},[load]);
 if(!token)return <main className="settings-page"><h1>Local Models</h1><p>Sign in to view the model registry.</p></main>;
 return <main className="settings-page">
  <header className="settings-header"><p>Developer · offline-first</p><h1>Local Model Pipeline</h1><button onClick={()=>void load()}>Refresh</button></header>
  {error?<p role="alert">{error}</p>:null}
  {!data?<p role="status">Loading…</p>:<>
   <section className="settings-group" aria-label="Current local model">
    <div className="settings-row"><span>Production local model</span><strong>{data.current?.ollama_model_name??'None approved'}</strong></div>
    <div className="settings-row"><span>Configured Ollama model</span><strong>{data.ollama.model??'Not configured'}</strong></div>
    <div className="settings-row"><span>Ollama runtime</span><strong>{data.ollama.enabled?'Configured':'Disabled'}</strong></div>
    <div className="settings-row"><span>Gemma 4B baseline</span><strong>{data.baseline.correct}/{data.baseline.total} · {(data.baseline.accuracy*100).toFixed(0)}%</strong></div>
    <div className="settings-row"><span>Shadow predictions</span><strong>{data.shadow_predictions}</strong></div>
   </section>
   <section className="settings-group" aria-label="Vertical integration metrics">
    <div className="settings-row"><span>Deterministic / local / cloud</span><strong>{data.cost_metrics.deterministic_requests} / {data.cost_metrics.local_requests} / {data.cost_metrics.cloud_requests}</strong></div>
    <div className="settings-row"><span>Gemini requests avoided</span><strong>{data.cost_metrics.gemini_requests_avoided}</strong></div>
    <div className="settings-row"><span>Estimated cloud cost avoided</span><strong>${data.cost_metrics.estimated_cloud_cost_avoided_usd.toFixed(2)}</strong></div>
    <div className="settings-row"><span>Local resolution rate</span><strong>{(data.cost_metrics.local_resolution_rate*100).toFixed(1)}%</strong></div>
    <div className="settings-row"><span>Recorded average latency</span><strong>{data.cost_metrics.average_recorded_latency_ms===null?'Unknown':`${Math.round(data.cost_metrics.average_recorded_latency_ms)} ms`}</strong></div>
   </section>
   <h2>Datasets</h2>
   {!data.datasets.length?<p>No sealed datasets yet.</p>:data.datasets.map(item=><section className="settings-group" key={`${item.name}-${item.version}`}><div className="settings-row"><span>{item.name} v{item.version}</span><strong>{item.example_count} examples{item.invalidated_at?' · invalidated':''}</strong></div></section>)}
   <h2>Candidates</h2>
   {!data.candidates.length?<p>No candidates registered. The current production model is unchanged.</p>:data.candidates.map(item=><section className="settings-group" key={item.id}><div className="settings-row"><span>{item.name} v{item.version}</span><strong>{item.status}</strong></div><div className="settings-row"><span>Accuracy / weighted</span><strong>{item.eval_score??'—'} / {item.weighted_eval_score??'—'}</strong></div></section>)}
   <h2>Per-task permissions</h2>
   <section className="settings-group">{data.permissions.length?data.permissions.map(item=><div className="settings-row" key={item.task_type}><span>{item.task_type}</span><strong>{item.enabled?'Enabled':'Disabled'} · ≥{Math.round(item.min_accuracy*100)}% accuracy · ≥{Math.round(item.min_confidence*100)}% confidence</strong></div>):<div className="settings-row"><span>Default safety policy</span><strong>Only bounded low-risk triage</strong></div>}</section>
   <p>Promotion and rollback require the local CLI, passing evaluation gates, and explicit human approval. Candidates shown here never take production actions automatically.</p>
  </>}
 </main>;
}
