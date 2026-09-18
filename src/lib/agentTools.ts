import {SchemaType,type FunctionDeclaration,type Schema} from "@google/generative-ai";
import {verifyGoogleServices,type GoogleServiceHealth} from "@/lib/googleServiceHealth";
import {searchGmailEmails,readGmailThread} from "@/lib/gmailScan";
import {searchDriveFiles,listDriveFolder,downloadDriveFile} from "@/lib/googleDrive";
import {extractOfficeText} from "@/lib/officeText";
import {analyzeFile} from "@/lib/fileIntelligence";
import {reanalyzeSource} from "@/lib/documentReanalysis";
import {executeAssistantActions,type AssistantAction,type AssistantActionResult} from "@/lib/assistantActionExecutor";
import {createEmailDraft,createAssistantAction} from "@/lib/objectCreation";
import {getServiceSupabaseClient} from "@/lib/supabaseServer";
import {permitsInferredAction,type IntentPlan} from "@/lib/intentPlanner";
import {importTextSource} from "@/lib/sourceAnalysis";
import { weatherDecisionContext } from "@/lib/weatherContext";
import { getAutomationSettings, canModifyGmail } from "@/lib/automationSettings";
import { listGoogleAccounts } from "@/lib/googleAuth";
export type AgentSource={label:string;url:string;kind:"gmail"|"drive"|"document"};
export type AgentToolResult={success:boolean;data:unknown;error:string|null;metadata:{tool:string;latencyMs:number;sources:AgentSource[];reconnectUrl?:string}};
export type AgentContext={userId:string;request:string;runId:string;timeZone:string;health:GoogleServiceHealth[];actions:AssistantActionResult[];intentPlan?:IntentPlan;signal?:AbortSignal;onProgress?:(message:string)=>void};
const str:Schema={type:SchemaType.STRING},num:Schema={type:SchemaType.NUMBER};
type Definition={name:string;description:string;properties:Record<string,Schema>;required:string[];progress:string};
const defs:Definition[]=[
 {name:"events_search",description:"Search owned discovered opportunities from the verified MIT official event feed. This is not general web search; coverage is MIT only. Return source links and sync times; interest and registration-pending are not confirmed commitments.",properties:{query:str},required:[],progress:"Checking verified opportunities…"},
 {name:"capabilities_status",description:"Read the actual modular tool registry, connected-service availability and automation permissions. Unavailable web/forms/browser capabilities must never be fabricated.",properties:{},required:[],progress:"Checking available capabilities…"},
 {name:"finance_summary",description:"Read owned stored finance accounts, recent transactions, institution sync status and planning assumptions. Read-only; never transfers money or claims live bank access. Show synchronization timestamps and errors.",properties:{},required:[],progress:"Checking stored finance data…"},
 {name:"weather_context",description:"Use the existing weather risk service for an outdoor/travel event within the next seven days. Return a risk note; null does not prove good weather. Does not move calendar events.",properties:{title:str,date:str,time:str},required:["title","date"],progress:"Checking weather context…"},
 {name:"gmail_search",description:"Search real Gmail using Gmail search syntax. accountId is an owned connected account; omit to search all healthy accounts. Use domain/email in the query when needed.",properties:{query:str,accountId:str},required:["query"],progress:"Searching Gmail…"},
 {name:"gmail_recent",description:"Get recent real Gmail messages, optionally from a particular connected account.",properties:{accountId:str},required:[],progress:"Reading recent email…"},
 {name:"gmail_read",description:"Read a real email thread from a connected account. Use IDs returned by Gmail search.",properties:{accountId:str,threadId:str},required:["accountId","threadId"],progress:"Reading email thread…"},
 {name:"gmail_actionable",description:"Retrieve pending analyzed emails requiring response/action; use Gmail search/read to verify source facts.",properties:{query:str},required:[],progress:"Checking emails needing attention…"},
 {name:"gmail_drafts",description:"Read saved ASS email drafts waiting for review, with their original Google account. Never send.",properties:{},required:[],progress:"Checking prepared replies…"},
 {name:"gmail_createDraft",description:"Create an internal reviewable ASS email draft, never send. Requires account, recipient, subject, body. Inbox offers Save to Gmail Drafts.",properties:{accountId:str,recipient:str,subject:str,body:str,threadId:str,inReplyToMessageId:str,emailSuggestionId:num},required:["accountId","recipient","subject","body"],progress:"Preparing your draft…"},
 {name:"drive_search",description:"Search actual Google Drive file names and content across healthy connected accounts. Use short meaningful search terms.",properties:{query:str,accountId:str},required:["query"],progress:"Looking in Drive…"},
 {name:"drive_read",description:"Read a Drive file using IDs from search. Text/Office content is read directly; PDF/image uses the existing evidence extraction pipeline. Read-only; no conversions/style training.",properties:{accountId:str,fileId:str},required:["accountId","fileId"],progress:"Reading your document…"},
 {name:"drive_folder",description:"List a Drive folder, especially Grow Up. No import or conversion.",properties:{accountId:str,folderName:str},required:["accountId"],progress:"Looking in your folder…"},
 {name:"writing_context",description:"Retrieve only approved high-confidence user-written samples and learned style. Never trains on arbitrary Drive files.",properties:{query:str},required:[],progress:"Checking your writing style…"},
 {name:"documents_search",description:"Find owned previously imported files/text/Drive documents by title before re-analysis.",properties:{query:str},required:["query"],progress:"Finding your imported document…"},
 {name:"documents_reanalyze",description:"Run latest real extraction again for ONE owned imported fileId OR sourceId. Preserve manual decisions; return changes, never auto-convert.",properties:{fileId:str,sourceId:str},required:[],progress:"Re-analyzing your document…"},
 {name:"documents_extract",description:"Save supplied text as an imported source and analyze with the shared evidence pipeline. Suggestions only, no calendar/task creation. Results appear in Inbox.",properties:{text:str,title:str},required:["text"],progress:"Analyzing the source…"},
 {name:"calendar_search",description:"Retrieve current commitments including recurrence, priorities and required/optional status. Results are bounded, not proof of free time; executor verifies overlaps.",properties:{query:str,from:str,through:str},required:[],progress:"Checking calendar…"},
 {name:"tasks_search",description:"Retrieve current open tasks and deadlines, optionally matching title.",properties:{query:str},required:[],progress:"Checking your tasks…"},
 {name:"memory_search",description:"Retrieve relevant personal priorities, classification rules, user corrections and memories. Use for decisions and personalization, not facts about new messages.",properties:{query:str},required:[],progress:"Checking your priorities…"},
 {name:"assistant_createAction",description:"Surface a review suggestion in the shared Inbox action queue. Does not execute the suggested action.",properties:{title:str,summary:str},required:["title","summary"],progress:"Adding a review item…"},
];
const actionNames:Record<string,AssistantAction["type"]>={calendar_create:"create_calendar_event",calendar_update:"update_calendar_event",calendar_delete:"delete_calendar_event",calendar_move:"move_event",tasks_create:"create_task",tasks_update:"reschedule_task",deadlines_create:"create_deadline",calendar_study:"create_study_block"};
for(const [name,type]of Object.entries(actionNames))defs.push({name,description:`Execute ${type} using the existing conflict-aware action service. Only when explicitly requested by the user. Updates/moves/deletes require confirmation; never send email or execute financial actions. Exact IDs required for existing objects. ISO dates need explicit timezone offset.`,properties:{title:str,start:str,end:str,dueAt:str,canonicalEventId:str,localId:num,taskLocalId:num,priority:{...str,format:"enum",enum:["low","medium","high"]},category:str,notes:str,deleteFromGoogle:{type:SchemaType.BOOLEAN}},required:[],progress:"Checking and applying your calendar/task request…"});
export const agentToolDefinitions:FunctionDeclaration[]=defs.map(({name,description,properties,required})=>({name,description,parameters:{type:SchemaType.OBJECT,properties,required}}));
// Gemini function names use underscores; capability metadata exposes stable
// dotted namespaces without building a competing tool implementation.
export const agentToolRegistry = new Map(defs.map(definition=>[definition.name,{...definition,namespace:definition.name.replace("_",".")} ]));
export async function getAgentCapabilitySnapshot(ctx: Pick<AgentContext,"userId"|"health">) {
 const [settings,accounts,institutions]=await Promise.all([getAutomationSettings(ctx.userId),listGoogleAccounts(ctx.userId),resultOf(db().from("plaid_items").select("id,status,last_successful_sync_at,error_code,error_message").eq("user_id",ctx.userId))]);
 const connected=(service:"gmail"|"drive"|"calendar")=>ctx.health.some(account=>account[service].state==="connected");
 return {tools:[...agentToolRegistry.values()].map(tool=>({name:tool.name,namespace:tool.namespace,description:tool.description})),services:{gmail:{available:connected("gmail"),accounts:accounts.map(account=>({id:account.id,email:account.connected_email,canModify:canModifyGmail(account.scope ? String(account.scope):null)}))},calendar:{available:true,googleConnected:connected("calendar"),note:"Local ASS calendar is available; Google account health is checked separately."},drive:{available:connected("drive")},documents:{available:true},tasks:{available:true},finance:{available:true,note:"Owned stored records, not guaranteed live bank access.",institutions},weather:{available:true,note:"Event risk context; API errors are returned by the tool."},web:{available:false,reason:"No web-search tool is configured."},forms:{available:false,reason:"Controlled form extraction and review workflow is not implemented."},events:{available:true,coverage:["MIT official calendar"],backgroundEnabled:settings.discover_opportunities && settings.mode!=="manual",note:"Stored official opportunities only; no general web search or automatic registration."},browser:{available:false,reason:"No app-controlled browser tool is configured."}},permissions:{...settings,automatic_send:false,automatic_form_submission:false,automatic_external_event_deletion:false}};
}
function text(args:Record<string,unknown>,key:string,max=1000){const value=args[key];if(typeof value!=="string"||!value.trim()||value.length>max)throw new Error(`A valid ${key} is required`);return value.trim();}
function db(){const client=getServiceSupabaseClient();if(!client)throw new Error("ASS Cloud is not configured");return client;}
async function resultOf(query:PromiseLike<{data:unknown;error:unknown}>){const result=await query;if(result.error)throw result.error;return result.data;}
function healthy(ctx:AgentContext,service:"gmail"|"drive",accountId?:string){
 const accounts=ctx.health.filter(a=>!accountId||a.id===accountId);
 if(!accounts.length)throw new Error(`No connected ${service} account. Connect it in Settings.`);
 if(accountId&&accounts[0][service].state!=="connected")throw new Error(`${accounts[0].email}: ${accounts[0][service].error ?? "Reconnect this account in Settings"}`);
 const available=accounts.filter(a=>a[service].state==="connected");
 if(!available.length)throw new Error(accounts.map(a=>`${a.email}: ${a[service].error ?? "Reconnect in Settings"}`).join("; "));
 return available;
}
export async function agentCapabilities(userId:string){return verifyGoogleServices(userId,undefined,true);}
export async function executeAgentTool(ctx:AgentContext,name:string,args:Record<string,unknown>):Promise<AgentToolResult>{
 const started=Date.now(),sources:AgentSource[]=[];ctx.onProgress?.(agentToolRegistry.get(name)?.progress ?? "Checking the request…");
 try{
  if(ctx.signal?.aborted)throw new Error("Request cancelled");
  const definition=agentToolRegistry.get(name);if(!definition)throw new Error("Unsupported tool");
  for(const key of definition.required)if(args[key]===undefined)throw new Error(`Missing ${key}`);
  for(const [key,value]of Object.entries(args)){const schema=definition.properties[key];if(!schema)throw new Error(`Unexpected field ${key}`);if(schema.type===SchemaType.STRING&&typeof value!=="string"||schema.type===SchemaType.NUMBER&&(typeof value!=="number"||!Number.isFinite(value))||schema.type===SchemaType.BOOLEAN&&typeof value!=="boolean")throw new Error(`Invalid ${key}`);}
  let data:unknown;
  const accountId=typeof args.accountId==="string"?args.accountId:undefined;
  if(name==="capabilities_status") data=await getAgentCapabilitySnapshot(ctx);
  else if(name==="events_search") {
   const [candidates,state]=await Promise.all([resultOf(db().from("opportunity_candidates").select("id,title,description,source_url,starts_at,location,relevance,reasons,travel_note,eligibility_note,status").eq("user_id",ctx.userId).gte("starts_at",new Date().toISOString()).order("starts_at").limit(100)),resultOf(db().from("opportunity_discovery_state").select("source_key,last_success_at,error_message").eq("user_id",ctx.userId))]);
   const query=typeof args.query==="string"?args.query.toLowerCase().slice(0,300):"";
   const matches=(candidates as Array<Record<string,unknown>>).filter(row=>!query||`${row.title} ${row.description}`.toLowerCase().includes(query)).slice(0,20);
   data={coverage:["MIT official calendar"],candidates:matches,sources:state,calendarWrites:false};
   for(const row of matches)sources.push({kind:"document",label:String(row.title),url:String(row.source_url)});
  } else if(name==="finance_summary") {
   const [accounts,transactions,institutions,assumptions]=await Promise.all([resultOf(db().from("finance_accounts").select("id,name,type,subtype,current_balance,available_balance,updated_at").eq("user_id",ctx.userId).eq("hidden",false)),resultOf(db().from("finance_transactions").select("id,name,merchant_name,amount,occurred_on,pending,category").eq("user_id",ctx.userId).is("removed_at",null).order("occurred_on",{ascending:false}).limit(30)),resultOf(db().from("plaid_items").select("institution_name,status,last_successful_sync_at,error_code,error_message").eq("user_id",ctx.userId)),resultOf(db().from("finance_assumptions").select("*").eq("user_id",ctx.userId).maybeSingle())]);
   data={accounts,transactions,institutions,assumptions,readOnly:true};sources.push({kind:"document",label:"Stored finance records · check last sync",url:"/finance"});
  } else if(name==="weather_context") {
   const date=text(args,"date",10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Use a source-verified event date in YYYY-MM-DD format");
   const time=typeof args.time==="string"?args.time:null;if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error("Use HH:MM for event time");
   data={riskNote:await weatherDecisionContext(ctx.userId,{title:text(args,"title",240),date,time}),note:"No note is not proof of good weather; this service only flags eligible near-term outdoor/travel risks."};
   sources.push({kind:"document",label:"National Weather Service",url:"https://www.weather.gov/"});
  } else if(name==="gmail_search"||name==="gmail_recent"){
   const query=name==="gmail_recent"?"newer_than:7d":text(args,"query",500);
   data=await Promise.all(healthy(ctx,"gmail",accountId).map(async account=>{const emails=await searchGmailEmails(ctx.userId,account.id,query);for(const email of emails){email.url=`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account.email)}#all/${email.threadId ?? email.id}`;sources.push({kind:"gmail",label:`${account.email} — ${email.subject}`,url:email.url});}return {accountId:account.id,accountEmail:account.email,messages:emails};}));
  }else if(name==="gmail_read"){
   const account=healthy(ctx,"gmail",text(args,"accountId"))[0],thread=text(args,"threadId",300);data=await readGmailThread(ctx.userId,account.id,thread);sources.push({kind:"gmail",label:`${account.email} — email thread`,url:`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account.email)}#all/${thread}`});
  }else if(name==="drive_search"){
   data=await Promise.all(healthy(ctx,"drive",accountId).map(async account=>{const files=await searchDriveFiles(ctx.userId,account.id,text(args,"query",300));for(const file of files)sources.push({kind:"drive",label:file.name,url:file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`});return {accountId:account.id,accountEmail:account.email,files};}));
  }else if(name==="drive_folder"){
   healthy(ctx,"drive",text(args,"accountId"));data=await listDriveFolder(ctx.userId,String(args.accountId),typeof args.folderName==="string"?args.folderName:"Grow Up");
  }else if(name==="drive_read"){
   healthy(ctx,"drive",text(args,"accountId"));const file=await downloadDriveFile(ctx.userId,String(args.accountId),text(args,"fileId",300));const office=file.mimeType.includes("officedocument")?extractOfficeText(file.buffer,file.mimeType):null;
   data={name:file.name,content:file.mimeType.startsWith("text/")?file.buffer.toString("utf8").slice(0,20000):office?.slice(0,20000) ?? await analyzeFile(file,ctx.userId),truncated:true};sources.push({kind:"drive",label:file.name,url:file.metadata.webViewLink ?? `https://drive.google.com/file/d/${file.metadata.id}/view`});
  }else if(name==="gmail_createDraft"){
   if(ctx.intentPlan?(!permitsInferredAction(ctx.intentPlan,"EMAIL_RESPONSE")&&!permitsInferredAction(ctx.intentPlan,"EMAIL_DRAFT")):!/\b(draft|write|reply|respond|compose)\b/i.test(ctx.request))throw new Error("Please confirm that you want a response draft.");
   healthy(ctx,"gmail",text(args,"accountId"));const recipient=text(args,"recipient",300);if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipient))throw new Error("A valid recipient is required");
   if(args.emailSuggestionId){const owned=await resultOf(db().from("email_suggestions").select("id").eq("user_id",ctx.userId).eq("google_account_id",args.accountId).eq("id",args.emailSuggestionId).maybeSingle());if(!owned)throw new Error("Email suggestion not found for this account");}
   data=await createEmailDraft(ctx.userId,{googleAccountId:String(args.accountId),emailSuggestionId:typeof args.emailSuggestionId==="number"?args.emailSuggestionId:null,recipient,subject:text(args,"subject",300),body:text(args,"body",12000),threadId:typeof args.threadId==="string"?args.threadId:null,inReplyToMessageId:typeof args.inReplyToMessageId==="string"?args.inReplyToMessageId:null,context:{runId:ctx.runId,generatedFrom:"chat_agent",sent:false}});sources.push({kind:"document",label:"Draft ready · review in Inbox",url:"/inbox"});
  }else if(name==="documents_reanalyze"){
   if(ctx.intentPlan?!permitsInferredAction(ctx.intentPlan,"DOCUMENT_REANALYZE"):!/re.?analy[sz]|analy[sz]e.*again|retry.*analy/i.test(ctx.request))throw new Error("Which document should I analyze again?");data=await reanalyzeSource(ctx.userId,{fileId:args.fileId as string|undefined,sourceId:args.sourceId as string|undefined});sources.push({kind:"document",label:"Updated analysis · Inbox",url:"/inbox"});
  }else if(name==="documents_extract"){data=await importTextSource(ctx.userId,typeof args.title==="string"?args.title:"Chat source",text(args,"text",250000));sources.push({kind:"document",label:"Analysis · review in Inbox",url:"/inbox"});}
  else if(name==="documents_search"){
   const query=text(args,"query",300);data={files:await resultOf(db().from("imported_files").select("id,name,status,classification,last_analyzed_at").eq("user_id",ctx.userId).ilike("name",`%${query}%`).limit(15)),sources:await resultOf(db().from("imported_sources").select("id,source_type,file_metadata,processing_status").eq("user_id",ctx.userId).limit(50))};
  }else if(name==="calendar_search"){
   let query=db().from("plans").select("*").eq("user_id",ctx.userId);if(args.query)query=query.ilike("title",`%${text(args,"query",300)}%`);if(args.from)query=query.gte("date",text(args,"from",30));if(args.through)query=query.lte("date",text(args,"through",30));data=await resultOf(query.order("date").limit(100));
  }else if(name==="tasks_search"){
   let query=db().from("todos").select("*").eq("user_id",ctx.userId).eq("done",false);if(args.query)query=query.ilike("title",`%${text(args,"query",300)}%`);data=await resultOf(query.limit(50));
  }else if(name==="gmail_actionable"){
   data=await resultOf(db().from("email_suggestions").select("id,google_account_id,title,summary,sender,thread_id,response_needed,response_confidence,response_reason,automation_labels,action_required,date,time,confidence").eq("user_id",ctx.userId).eq("status","pending").eq("suppressed",false).or("response_needed.eq.true,action_required.eq.true").limit(20));
  }else if(name==="gmail_drafts"){
   data=await resultOf(db().from("email_drafts").select("id,google_account_id,thread_id,recipient,subject,body,status,gmail_draft_id,created_at").eq("user_id",ctx.userId).in("status",["ready","edited"]).order("created_at",{ascending:false}).limit(20));
  }else if(name==="writing_context"){
   let query=db().from("writing_samples").select("context_type,content,confidence,source_kind").eq("user_id",ctx.userId).eq("span_type","user_written").eq("approved",true).gte("confidence",.9);if(args.query)query=query.ilike("content",`%${text(args,"query",300)}%`);data=await resultOf(query.order("created_at",{ascending:false}).limit(8));
  }else if(name==="memory_search"){
   let query=db().from("personal_memory").select("kind,category,statement,confidence,importance").eq("user_id",ctx.userId).eq("active",true);if(args.query)query=query.ilike("statement",`%${text(args,"query",300)}%`);data={memory:await resultOf(query.order("importance",{ascending:false}).limit(12)),rules:await resultOf(db().from("classification_rules").select("*").eq("user_id",ctx.userId).eq("active",true).limit(12)),corrections:await resultOf(db().from("classification_feedback").select("original_text,user_corrected_label,user_action").eq("user_id",ctx.userId).order("created_at",{ascending:false}).limit(12))};
  }else if(name==="assistant_createAction")data=await createAssistantAction(ctx.userId,{sourceKind:"assistant",sourceId:`${ctx.runId}:${name}:${text(args,"title",240)}`,actionType:"review",title:String(args.title),summary:text(args,"summary",2000),payload:{runId:ctx.runId}});
  else if(actionNames[name]){
   const inferred=name==="calendar_create"?"CALENDAR_CREATE":name==="tasks_create"?"TASK_CREATE":name==="deadlines_create"?"DEADLINE_CREATE":"CALENDAR_MOVE";
   if(ctx.intentPlan?!permitsInferredAction(ctx.intentPlan,inferred):!/\b(add|create|schedule|block|put|move|reschedule|update|change|delete|remove|remind)\b/i.test(ctx.request))throw new Error("Please confirm the change and identify the exact item.");
   const tentative=ctx.intentPlan?.attendance==="maybe";
   const [result]=await executeAssistantActions(ctx.userId,[{...args,tentative,type:actionNames[name],sourceId:`agent:${ctx.runId}:${name}:${JSON.stringify(args)}`} as AssistantAction],{timeZone:ctx.timeZone});ctx.actions.push(result);if(!result.success)return {success:false,data:result,error:result.errorMessage ?? result.summary,metadata:{tool:name,latencyMs:Date.now()-started,sources}};data=result;
  }
  if(JSON.stringify(data)?.length>100000)throw new Error("Too much source content for reliable retrieval. Narrow the search or analyze a smaller section.");
  return {success:true,data,error:null,metadata:{tool:name,latencyMs:Date.now()-started,sources}};
 }catch(error){return {success:false,data:null,error:error instanceof Error?error.message:String(error),metadata:{tool:name,latencyMs:Date.now()-started,sources,reconnectUrl:/google|gmail|drive|reconnect|permission|scope/i.test(String(error))?"/profile":undefined}};}
}
