import { createRemoteJWKSet, jwtVerify } from "jose";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { getGoogleAccessToken } from "@/lib/googleAuth";
import { scanRecentGmailSuggestions } from "@/lib/gmailScan";
import { createAssistantAction } from "@/lib/objectCreation";
import {randomUUID} from "node:crypto";
import {classifyGmailFailure,gmailRetryDecision} from "@/lib/gmailQueuePolicy";
import {structuredLog} from "@/lib/structuredLog";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
function database() {
  const client = getServiceSupabaseClient();
  if (!client) throw new Error("A Supabase server key is not configured");
  return client;
}
export function gmailPushConfiguration() {
  const topic = process.env.GMAIL_PUBSUB_TOPIC?.trim();
  const audience = process.env.GMAIL_PUSH_AUDIENCE?.trim();
  const email = process.env.GMAIL_PUSH_SERVICE_ACCOUNT?.trim();
  const subscription = process.env.GMAIL_PUBSUB_SUBSCRIPTION?.trim();
  return { topic, audience, email, subscription, ready: Boolean(topic && /^projects\/[^/]+\/topics\/[^/]+$/.test(topic) && audience?.startsWith("https://") && email?.endsWith(".gserviceaccount.com") && subscription && /^projects\/[^/]+\/subscriptions\/[^/]+$/.test(subscription)) };
}
export async function validateGmailPush(authorization: string | null, keys: Parameters<typeof jwtVerify>[1] = googleKeys) {
  const config = gmailPushConfiguration();
  if (!config.ready) throw new Error("Gmail push is not configured: topic, subscription, audience and service-account identity are required");
  const token = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) throw new Error("Missing Pub/Sub identity token");
  const { payload } = await jwtVerify(token, keys, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: config.audience, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub"] });
  if (payload.email !== config.email || payload.email_verified !== true) throw new Error("Unexpected Pub/Sub service-account identity");
}
export function decodeGmailPush(body: unknown) {
  const config = gmailPushConfiguration();
  const envelope = body as { subscription?: string; message?: { data?: string; messageId?: string } };
  if (envelope?.subscription !== config.subscription) throw new Error(`Unexpected Pub/Sub subscription: ${typeof envelope?.subscription === "string" ? envelope.subscription.slice(0, 200) : "missing"}`);
  if (!envelope || envelope.subscription !== config.subscription || typeof envelope.message?.messageId !== "string" || envelope.message.messageId.length > 200 || typeof envelope.message.data !== "string" || envelope.message.data.length > 10_000 || !/^[A-Za-z0-9_+/=-]+$/.test(envelope.message.data)) throw new Error("Invalid Pub/Sub envelope");
  const text = Buffer.from(envelope.message.data, "base64url").toString("utf8");
  const decoded = JSON.parse(text) as { emailAddress?: unknown; historyId?: unknown };
  let historyId = decoded.historyId;
  if (typeof historyId === "number") {
    // Live Gmail notifications also contain JSON numbers. Recover the original
    // root-property lexeme, NEVER String(the parsed number): JSON.parse may have
    // already rounded a large cursor. Strings are tokenized as whole units so
    // nested objects and escaped string content cannot impersonate this key.
    const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ?? [];
    let depth = 0;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === "{" || token === "[") depth++;
      else if (token === "}" || token === "]") depth--;
      else if (depth === 1 && token.startsWith('"') && tokens[i + 1] === ":" && JSON.parse(token) === "historyId") historyId = tokens[i + 2];
    }
  }
  if (typeof decoded.emailAddress !== "string" || decoded.emailAddress.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(decoded.emailAddress) || typeof historyId !== "string" || !/^\d{1,30}$/.test(historyId) || BigInt(historyId) <= BigInt(0)) throw new Error("Invalid Gmail notification");
  return { email: decoded.emailAddress, historyId, notificationId: envelope.message.messageId };
}
export async function persistGmailPush(notification: ReturnType<typeof decodeGmailPush>,intakeRequestId: string) {
  const { data, error } = await database().rpc("enqueue_gmail_push", { p_email: notification.email, p_history_id: notification.historyId, p_notification_id: notification.notificationId,p_request_id:intakeRequestId });
  if (error) throw error; // Never acknowledge a notification that wasn't durably saved.
  return Number(data);
}
export async function renewGmailWatches(onlyUserId?: string, onlyAccountId?: string) {
  const config = gmailPushConfiguration();
  if (!config.ready) return { configured: false, renewed: 0, errors: [] as string[] };
  const db = database();
  let query = db.from("google_tokens").select("id,user_id,connected_email").is("disconnected_at", null);
  if (onlyUserId) query = query.eq("user_id", onlyUserId);
  if (onlyAccountId) query = query.eq("id", onlyAccountId);
  const { data: accounts, error } = await query;
  if (error) throw error;
  let renewed = 0;
  const errors: string[] = [];
  for (const account of accounts ?? []) {
    const { data: state, error: readError } = await db.from("gmail_watch_state").select("watch_expiration,last_watch_renewal").eq("user_id", account.user_id).eq("google_account_id", account.id).maybeSingle();
    if (readError) throw readError;
    if (state?.watch_expiration && Date.parse(state.watch_expiration) > Date.now() + 48 * 3600_000 && state.last_watch_renewal && Date.parse(state.last_watch_renewal) > Date.now() - 24 * 3600_000) continue;
    try {
      const token = await getGoogleAccessToken(account.user_id, account.id);
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ topicName: config.topic }), signal: AbortSignal.timeout(20_000), cache: "no-store" });
      const result = await response.json() as { historyId?: string; expiration?: string; error?: { message?: string } };
      if (!response.ok || !result.historyId || !result.expiration) throw new Error(result.error?.message ?? `Gmail watch returned HTTP ${response.status}`);
      const { error: saveError } = await db.from("gmail_watch_state").upsert({ user_id: account.user_id, google_account_id: account.id, watch_expiration: new Date(Number(result.expiration)).toISOString(), watch_history_id: result.historyId, last_watch_renewal: new Date().toISOString(), last_error: null }, { onConflict: "google_account_id" });
      if (saveError) throw saveError;
      // Renewal does NOT replace the processed cursor: pending changes would be lost.
      renewed++;
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "Gmail watch renewal failed";
      errors.push(`${String(account.id).slice(0, 8)}: ${message}`);
      const { error: saveError } = await db.from("gmail_watch_state").upsert({ user_id: account.user_id, google_account_id: account.id, last_error: message }, { onConflict: "google_account_id" });
      if (saveError) throw saveError;
      await createAssistantAction(account.user_id, { sourceKind: "integration", sourceId: `gmail-watch:${account.id}`, actionType: "connection_attention", title: "Gmail push needs attention", summary: `${account.connected_email}: ${message}`, priority: "high", payload: { googleAccountId: account.id, recommendedAction: /401|403|revoked|refresh|scope|invalid_grant/i.test(message) ? "Reconnect Gmail in Profile; check Google Pub/Sub permissions if authorization is healthy" : "Check the Gmail push configuration" } });
    }
  }
  return { configured: true, renewed, errors };
}
export async function processGmailPushQueue(maxAccounts = 2, budgetMs=150_000) {
  const db = database();
  const {data:cooldown,error:cooldownError}=await db.from("ai_provider_cooldowns").select("cooldown_until,reason").eq("provider","gemini").maybeSingle();
  if(cooldownError)throw cooldownError;
  if(cooldown&&Date.parse(cooldown.cooldown_until)>Date.now()){
    structuredLog("warn",{subsystem:"gmail_queue",event:"provider_cooldown",provider:"gemini",cooldown_until:cooldown.cooldown_until,reason:cooldown.reason});
    return [];
  }
  const worker=randomUUID();
  const {data:claimed,error}=await db.rpc("claim_gmail_processing_jobs",{p_limit:maxAccounts,p_worker_id:worker});
  if(error) throw error;
  const results = [];
  const started=Date.now();
  for (const event of claimed ?? []) {
    const jobId=String(event.id),runId=randomUUID();
    structuredLog("info",{subsystem:"gmail_queue",event:"job_started",request_id:event.intake_request_id,run_id:runId,job_id:jobId,user_id:event.user_id,account_id:String(event.google_account_id).slice(0,8),attempt:event.attempts});
    let result = await scanRecentGmailSuggestions(event.user_id, event.google_account_id,undefined,2);
    // Bursts continue draining after the original push response. A bounded
    // budget leaves crash/timeout/backlog recovery to the durable queue + cron.
    for(let pass=0;pass<20 && result.connected && !result.busy && !result.failures.length && Date.now()-started<budgetMs;pass++) {
      const completed=await db.rpc("complete_gmail_pushes",{p_user_id:event.user_id,p_account_id:event.google_account_id});
      if(completed.error) throw completed.error;
      const remaining=await db.from("gmail_processing_queue").select("id").eq("user_id",event.user_id).eq("google_account_id",event.google_account_id).in("status",["queued","retry_wait","processing"]).limit(1);
      if(remaining.error) throw remaining.error;
      if(!result.backlogRemaining && !remaining.data?.length) break;
      const next=await scanRecentGmailSuggestions(event.user_id,event.google_account_id,undefined,2);
      result={...next,suggestions:[...result.suggestions,...next.suggestions],emailsScanned:result.emailsScanned+next.emailsScanned,actionItemsCreated:result.actionItemsCreated+next.actionItemsCreated,draftsCreated:result.draftsCreated+next.draftsCreated,calendarEventsCreated:result.calendarEventsCreated+next.calendarEventsCreated};
    }
    results.push(result);
    if (result.busy) {
      const next=new Date(Date.now()+60_000).toISOString();
      const released=await db.rpc("finish_gmail_job_batch",{p_user_id:event.user_id,p_account_id:event.google_account_id,p_worker_id:worker,p_status:"retry_wait",p_error:"Account processing lease is busy",p_provider_status:null,p_next_attempt_at:next});
      if(released.error)throw released.error;
      continue;
    }
    if(!result.connected) {
      const failed=await db.rpc("finish_gmail_job_batch",{p_user_id:event.user_id,p_account_id:event.google_account_id,p_worker_id:worker,p_status:"failed",p_error:"Gmail connection is unavailable; reconnect required",p_provider_status:401,p_next_attempt_at:null});
      if(failed.error)throw failed.error;
      await createAssistantAction(event.user_id,{sourceKind:"integration",sourceId:`gmail-queue:${event.google_account_id}`,actionType:"connection_attention",title:"Reconnect Gmail",summary:"Queued Gmail processing stopped because the connection is unavailable.",priority:"high",payload:{googleAccountId:event.google_account_id,recommendedAction:"Reconnect Gmail in Profile"}});
      continue;
    }
    if (!result.failures.length) {
      const { error: completionError } = await db.rpc("complete_gmail_pushes", { p_user_id: event.user_id, p_account_id: event.google_account_id });
      if (completionError) throw completionError;
      structuredLog("info",{subsystem:"gmail_queue",event:"job_completed",request_id:event.intake_request_id,run_id:runId,job_id:jobId,user_id:event.user_id,duration_ms:Date.now()-started});
      continue;
    }
    const failure=classifyGmailFailure(result.failures.join("; "));
    const decision=gmailRetryDecision(Number(event.attempts),failure);
    const finished=await db.rpc("finish_gmail_job_batch",{p_user_id:event.user_id,p_account_id:event.google_account_id,p_worker_id:worker,p_status:decision.status,p_error:failure.reason,p_provider_status:failure.status,p_next_attempt_at:decision.nextAttemptAt});
    if(finished.error)throw finished.error;
    if(failure.provider==="gemini"&&failure.retryable&&[429,503].includes(failure.status??0)&&decision.nextAttemptAt){
      const previous=await db.from("ai_provider_cooldowns").select("consecutive_failures").eq("provider","gemini").maybeSingle();
      if(previous.error)throw previous.error;
      const cooldownSave=await db.from("ai_provider_cooldowns").upsert({provider:"gemini",cooldown_until:decision.nextAttemptAt,reason:`HTTP ${failure.status}`,last_429:failure.status===429?new Date().toISOString():undefined,last_503:failure.status===503?new Date().toISOString():undefined,consecutive_failures:Number(previous.data?.consecutive_failures??0)+1,updated_at:new Date().toISOString()});
      if(cooldownSave.error)throw cooldownSave.error;
    }
    if(failure.auth)await createAssistantAction(event.user_id,{sourceKind:"integration",sourceId:`gmail-queue:${event.google_account_id}`,actionType:"connection_attention",title:"Reconnect Gmail",summary:"Gmail authorization stopped queued processing.",priority:"high",payload:{googleAccountId:event.google_account_id,recommendedAction:"Reconnect Gmail in Profile"}});
    if(decision.status==="dead_letter")await createAssistantAction(event.user_id,{sourceKind:"gmail_queue",sourceId:jobId,actionType:"processing_failed",title:"Gmail message processing needs review",summary:"A queued Gmail update exhausted automatic retries.",priority:"high",payload:{jobId,recommendedAction:"Inspect or retry the dead-letter job in Developer Health"}});
    structuredLog(decision.status==="retry_wait"?"warn":"error",{subsystem:"gmail_queue",event:"job_failed",request_id:event.intake_request_id,run_id:runId,job_id:jobId,user_id:event.user_id,status:decision.status,provider:failure.provider,provider_status:failure.status,next_attempt_at:decision.nextAttemptAt,duration_ms:Date.now()-started});
  }
  return results;
}
