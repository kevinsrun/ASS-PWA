"use client";
type Item = {id:string;item_type:string;title:string;description:string;due_at:string|null;confidence:number;normalized_type:string|null;review_status:string;payload?:Record<string,unknown>};
type Props = {items:Item[];busy:string|null;conversionTypes:Record<string,string>;onChange:(id:string,value:string)=>void;onReview:(id:string,action:"approve"|"reject",normalizedType?:string)=>void};
function group(item:Item) {
  if (item.review_status === "rejected") return "Ignored";
  if (item.review_status === "pending" && item.payload?.analysisVersion !== 2) return "Needs re-analysis";
  if (item.item_type === "unknown") return "Unknown";
  if (item.item_type === "policy") return "Policies";
  if (item.item_type === "contact_info") return "Contact information";
  if (item.item_type === "office_hours" && item.normalized_type === "calendar_event") return "Office hours · optional";
  if (item.normalized_type === "calendar_event") return "Calendar events";
  if (item.normalized_type === "deadline") return "Deadlines + tasks";
  if (item.normalized_type === "task") return "Tasks";
  if (item.normalized_type === "project") return "Projects";
  return "Reference information";
}
const order = ["Calendar events","Deadlines + tasks","Tasks","Projects","Office hours · optional","Unknown","Needs re-analysis","Reference information","Policies","Contact information","Ignored"];
export default function ExtractionReview({items,busy,conversionTypes,onChange,onReview}:Props) {
  const groups = new Map<string,Item[]>();
  for (const item of items) { const key=group(item); groups.set(key,[...groups.get(key) ?? [],item]); }
  return <div className="extraction-groups">{order.filter(key=>groups.has(key)).map(key=><details className="extraction-group" key={key} open={["Calendar events","Deadlines + tasks","Tasks","Projects","Office hours · optional","Unknown","Needs re-analysis"].includes(key)}><summary>{key} <span>({groups.get(key)!.length})</span></summary><div className="extraction-list">{groups.get(key)!.map(item=>{
    const pending = ["pending","approved"].includes(item.review_status);
    const unverified = item.payload?.analysisVersion !== 2;
    const selected = conversionTypes[item.id] ?? (unverified ? "reference" : item.normalized_type ?? "reference");
    return <div key={item.id} className="extraction-item"><div><small>{unverified && pending ? "Unverified old analysis" : `${Math.round(Number(item.confidence)*100)}% model confidence${item.confidence<0.7 ? " · uncertain" : item.confidence<0.9 ? " · review required" : " · evidence checked"}`} · {pending ? "Suggested" : item.review_status === "committed" ? "Reviewed" : "Ignored"}</small><strong>{item.title}</strong>{item.due_at&&!unverified ? <time>{new Date(item.due_at).toLocaleString([],{dateStyle:"medium",timeStyle:"short"})}</time> : null}{item.payload?.evidence_text ? <details><summary>Source evidence</summary><blockquote>{String(item.payload.evidence_text)}</blockquote><small>{String(item.payload.source_location ?? "")}</small><p>{String(item.payload.reasoning_summary ?? "")}</p></details> : null}</div>{pending ? <div className="extraction-convert"><select aria-label={`Review ${item.title} as`} value={selected} onChange={event=>onChange(item.id,event.target.value)}><option value="reference">Reference only</option><option value="calendar_event">Calendar event</option><option value="deadline">Deadline + task</option><option value="task">Task</option><option value="project">Project task</option></select><button type="button" className="convert-button" disabled={Boolean(busy)} onClick={()=>onReview(item.id,"approve",selected)}>{busy===item.id ? "Saving…" : selected === "reference" ? "Keep reference" : "Approve"}</button><button type="button" aria-label={`Ignore ${item.title}`} disabled={Boolean(busy)} onClick={()=>onReview(item.id,"reject")}>Ignore</button></div> : null}</div>;
  })}</div></details>)}</div>;
}
