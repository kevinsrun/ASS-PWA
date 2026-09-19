"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useAuth} from '@/providers/AuthProvider';
type Example={id:string;task_type:string;input_text:string;final_label:string;quality:string;correction_source:string};
type Dataset={enabled:boolean;retention_days?:number;examples:Example[]};
const labels={task:'Task type',source:'Label provenance',confidence:'Minimum model confidence',from:'From (local time)',through:'Through (local time)'};
export default function Training(){
 const {session}=useAuth(),token=session?.access_token;
 const currentToken=useRef(token);currentToken.current=token;
 const [data,setData]=useState<Dataset|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [filters,setFilters]=useState({task:'',source:'',confidence:'',from:'',through:''});
 useEffect(()=>{
  setData(null);setError('');setBusy(false);if(!token)return;
  const abort=new AbortController();
  void fetch('/api/debug/training',{headers:{Authorization:`Bearer ${token}`},signal:abort.signal,cache:'no-store'})
   .then(async r=>{const b=await r.json();if(!r.ok)throw Error(b.error);if(!abort.signal.aborted)setData(b);})
   .catch(e=>{if(!abort.signal.aborted)setError(String(e));});
  return()=>abort.abort();
 },[token]);
 async function update(body:object){
  if(!token||busy)return;setBusy(true);setError('');
  try{
   const r=await fetch('/api/debug/training',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(!r.ok)throw Error((await r.json()).error);
   if(currentToken.current!==token)return;
   const fresh=await fetch('/api/debug/training',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
   if(!fresh.ok)throw Error('Unable to refresh examples');
   const next=await fresh.json();if(currentToken.current===token)setData(next);
  }catch(e){if(currentToken.current===token)setError(String(e));}
  finally{if(currentToken.current===token)setBusy(false);}
 }
 async function mutate(method:'PATCH'|'DELETE',body?:object,id?:string){
  if(!token||busy)return;setBusy(true);setError('');
  try{const r=await fetch(`/api/debug/training${id?`?id=${encodeURIComponent(id)}`:''}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error((await r.json()).error);if(currentToken.current!==token)return;const fresh=await fetch('/api/debug/training',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!fresh.ok)throw Error('Unable to refresh examples');setData(await fresh.json());}
  catch(e){if(currentToken.current===token)setError(String(e));}finally{if(currentToken.current===token)setBusy(false);}
 }
 async function download(){
  if(!token||busy)return;setBusy(true);setError('');
  try{
   const params=new URLSearchParams({export:'jsonl'});
   Object.entries(filters).forEach(([key,value])=>{if(value)params.set(key,key==='from'||key==='through'?new Date(value).toISOString():value);});
   const r=await fetch(`/api/debug/training?${params}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
   if(!r.ok)throw Error((await r.json()).error);
   const blob=await r.blob();if(currentToken.current!==token)return;
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ass-training.jsonl';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){if(currentToken.current===token)setError(String(e));}
  finally{if(currentToken.current===token)setBusy(false);}
 }
 return <main className="settings-page training-page">
  <header className="settings-header"><p>Developer</p><h1>Training data</h1><Link href="/debug/ai">Back to AI Usage</Link></header>
  <p>Collect future classification corrections for offline evaluation. Nothing trains automatically or uploads externally.</p>
  {error?<p role="alert">{error}</p>:null}
  {!token?<p>Sign in to manage your data.</p>:!data?<p role="status">Loading…</p>:<>
   <section className="settings-group"><label className="settings-row"><input type="checkbox" checked={data.enabled} disabled={busy} onChange={e=>void update({enabled:e.target.checked})}/>Collect correction candidates</label></section>
   <section className="settings-group"><label className="settings-row">Retention period<select value={data.retention_days??90} disabled={busy} onChange={e=>void mutate('PATCH',{retentionDays:Number(e.target.value)})}>{[[30,'30 days'],[90,'90 days'],[180,'180 days'],[365,'365 days'],[-1,'Forever']].map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><button className="settings-row" disabled={busy||!data.examples.length} onClick={()=>{if(window.confirm('Permanently delete all collected training examples?'))void mutate('DELETE');}}>Delete all training data</button></section>
   <p>Off by default. Turning collection off stops new collection; existing examples remain. Text may contain personal information—review and redact offline before sharing.</p>
   <h2>Export dataset</h2>
   <section className="settings-group" aria-label="Export filters">
    <label className="settings-row">Task type<select value={filters.task} onChange={e=>setFilters({...filters,task:e.target.value})}><option value="">All tasks</option>{['email_triage','document_classification','response_needed'].map(task=><option key={task}>{task}</option>)}</select></label>
    <label className="settings-row">Label provenance<select value={filters.source} onChange={e=>setFilters({...filters,source:e.target.value})}><option value="">All sources</option>{['USER_CORRECTION','DETERMINISTIC_VALIDATION','GEMINI_VERIFIED','SYSTEM_VERIFIED','GEMINI_PSEUDO_LABEL'].map(source=><option key={source}>{source}</option>)}</select></label>
    {(['confidence','from','through'] as const).map(key=><label className="settings-row" key={key}>{labels[key]}<input value={filters[key]} type={key==='confidence'?'number':'datetime-local'} min={key==='confidence'?0:undefined} max={key==='confidence'?1:undefined} step={key==='confidence'?0.01:undefined} onChange={e=>setFilters({...filters,[key]:e.target.value})}/></label>)}
    <button className="settings-row" disabled={busy} onClick={()=>void download()}>Export approved examples · JSONL</button>
   </section>
   <p>Only approved examples. No historical backfill or teacher-generated labels. Exports over 1,000 records require a narrower date range.</p>
   <h2>Recent candidates</h2>
   {!data.examples.length?<p>No examples collected.</p>:data.examples.map(example=><section className="settings-group training-example" key={example.id}>
    <p>{example.task_type} · {example.quality} · {example.correction_source}</p>
    <details><summary>Review input and label</summary><pre>{example.input_text}</pre><p>Label: {example.final_label}</p></details>
    <div className="training-actions"><button disabled={busy||example.quality==='approved'} onClick={()=>void update({id:example.id,quality:'approved'})}>Approve</button><button disabled={busy||example.quality==='rejected'} onClick={()=>void update({id:example.id,quality:'rejected'})}>Reject</button><button disabled={busy} onClick={()=>{if(window.confirm('Permanently delete this training example?'))void mutate('DELETE',undefined,example.id);}}>Delete</button></div>
   </section>)}
  </>}
 </main>;
}
