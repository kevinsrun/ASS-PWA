import {randomUUID} from "crypto";
import {getServiceSupabaseClient} from "@/lib/supabaseServer";
import {getGoogleAccessToken} from "@/lib/googleAuth";

function encodeMessage(headers:Record<string,string|null>,body:string) {
  const lines=Object.entries(headers).filter((entry):entry is [string,string]=>Boolean(entry[1])).map(([key,value])=>`${key}: ${value.replace(/[\r\n]+/g," ")}`);
  return Buffer.from(`${lines.join("\r\n")}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body).toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? ""}`,"utf8").toString("base64url");
}
// Explicit user-triggered Gmail Draft creation. There is intentionally no send method.
export async function createGmailDraft(userId:string,draftId:string,editedBody?:string) {
  const db=getServiceSupabaseClient();if(!db) throw new Error("A Supabase server key is not configured");
  const {data:draft,error}=await db.from("email_drafts").select("*").eq("user_id",userId).eq("id",draftId).maybeSingle();
  if(error) throw error;if(!draft) throw new Error("Draft not found");
  if(draft.gmail_draft_id) return {gmailDraftId:String(draft.gmail_draft_id),duplicate:true};
  if(!["ready","edited"].includes(draft.status)) throw new Error("This draft is not available for Gmail export");
  if(!draft.recipient || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(draft.recipient)) throw new Error("This draft has no valid reply recipient");
  const worker=randomUUID(),args={p_user_id:userId,p_account_id:draft.google_account_id,p_worker_id:worker};
  const {data:lease,error:leaseError}=await db.rpc("acquire_gmail_lease",args);
  if(leaseError) throw leaseError;if(!lease) throw new Error("This Gmail account is currently processing; try again shortly");
  try {
    const {data:fresh,error:readError}=await db.from("email_drafts").select("*").eq("user_id",userId).eq("id",draftId).single();
    if(readError) throw readError;
    if(fresh.gmail_draft_id) return {gmailDraftId:String(fresh.gmail_draft_id),duplicate:true};
    if(!["ready","edited"].includes(fresh.status)) throw new Error("This draft was ignored or changed");
    if(fresh.context_snapshot?.gmailSaveStartedAt) throw new Error("A previous Gmail save has an uncertain outcome. Check Gmail Drafts before retrying; ASS will not create a duplicate blindly.");
    const token=await getGoogleAccessToken(userId,String(fresh.google_account_id));
    const body=String(editedBody ?? fresh.body).trim();if(!body || body.length>20_000) throw new Error("Draft body must contain 1–20,000 characters");
    const {error:startedError}=await db.from("email_drafts").update({body,status:body===fresh.body ? fresh.status : "edited",context_snapshot:{...fresh.context_snapshot,gmailSaveStartedAt:new Date().toISOString()},updated_at:new Date().toISOString()}).eq("user_id",userId).eq("id",draftId);
    if(startedError) throw startedError;
    const raw=encodeMessage({To:String(fresh.recipient),Subject:`=?UTF-8?B?${Buffer.from(String(fresh.subject)).toString("base64")}?=`,"In-Reply-To":fresh.in_reply_to_message_id ?? null,References:fresh.in_reply_to_message_id ?? null,"Message-ID":`<ass-${draftId}@ass-pwa.vercel.app>`},body);
    const response=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({message:{threadId:fresh.thread_id ?? undefined,raw}}),signal:AbortSignal.timeout(20_000),cache:"no-store"});
    const result=await response.json().catch(()=>({})) as {id?:string;error?:{message?:string}};
    if(!response.ok || !result.id) {
      // A definitive client rejection did not create a draft. A timeout/5xx
      // remains uncertain and is not retried automatically.
      if(response.status>=400 && response.status<500) await db.from("email_drafts").update({context_snapshot:fresh.context_snapshot}).eq("user_id",userId).eq("id",draftId);
      throw new Error(result.error?.message ?? `Gmail draft creation failed: HTTP ${response.status}`);
    }
    const {error:saveError}=await db.from("email_drafts").update({status:"saved_to_gmail",gmail_draft_id:result.id,updated_at:new Date().toISOString()}).eq("user_id",userId).eq("id",draftId);
    if(saveError) throw new Error(`Gmail draft was created (${result.id}) but its ASS mapping could not be saved. Check Gmail before retrying.`);
    return {gmailDraftId:result.id,duplicate:false};
  } finally { const {error:releaseError}=await db.rpc("release_gmail_lease",args);if(releaseError) console.error(JSON.stringify({service:"gmail-drafts",stage:"lease-release-failed",message:releaseError.message})); }
}
