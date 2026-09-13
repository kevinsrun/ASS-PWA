import { createHash, randomUUID } from "crypto";
import { createCalendarEvent } from "@/lib/calendarEventService";
import { getGeminiModel, rotateGeminiKey } from "@/lib/gemini";
import { addMinutesToLabel, formatTimeLabel } from "@/lib/dateTime";
import { getGoogleAccessToken, listGoogleAccounts } from "@/lib/googleAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import type { EmailIntelligenceItem, PlanCategory } from "@/lib/types";

type GmailMessageList = { messages?: Array<{ id: string; threadId?: string }> };
type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
};
type Classification = {
  id: string;
  type: EmailIntelligenceItem["type"];
  importance: EmailIntelligenceItem["importance"];
  actionRequired: boolean;
  title: string;
  summary: string;
  rationale: string;
  date: string | null;
  time: string | null;
  duration: number;
  category: PlanCategory;
  confidence: number;
  recommendations: string[];
  responseNeeded: boolean;
  suggestedReply: string;
};

const intelligenceTypes = new Set<EmailIntelligenceItem["type"]>([
  "task", "deadline", "meeting", "reminder", "project_update", "scholarship",
  "research", "club_event", "financial_aid", "travel", "interview", "invoice", "no_action",
]);
const importanceLevels = new Set<EmailIntelligenceItem["importance"]>(["low", "normal", "high", "urgent"]);
const planCategories = new Set<PlanCategory>(["school", "fitness", "work", "health", "personal", "finance", "other"]);

function safeClassification(message: GmailMessage, candidate?: Partial<Classification>): Classification {
  const type = intelligenceTypes.has(candidate?.type as EmailIntelligenceItem["type"])
    ? candidate!.type as EmailIntelligenceItem["type"]
    : "no_action";
  const importance = importanceLevels.has(candidate?.importance as EmailIntelligenceItem["importance"])
    ? candidate!.importance as EmailIntelligenceItem["importance"]
    : "normal";
  const category = planCategories.has(candidate?.category as PlanCategory)
    ? candidate!.category as PlanCategory
    : "other";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(candidate?.date ?? "")) ? String(candidate!.date) : null;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(candidate?.time ?? "")) ? String(candidate!.time) : null;
  return {
    id: message.id,
    type,
    importance,
    actionRequired: Boolean(candidate?.actionRequired),
    title: String(candidate?.title ?? header(message, "Subject") ?? "Email").slice(0, 240),
    summary: String(candidate?.summary ?? message.snippet ?? "").slice(0, 1200),
    rationale: String(candidate?.rationale ?? "No reliable action was detected.").slice(0, 1200),
    date,
    time,
    duration: Math.max(15, Math.min(1440, Number(candidate?.duration) || 60)),
    category,
    confidence: Math.max(0, Math.min(1, Number(candidate?.confidence) || 0)),
    recommendations: Array.isArray(candidate?.recommendations)
      ? candidate.recommendations.map(String).filter(Boolean).slice(0, 4)
      : [],
    responseNeeded: Boolean(candidate?.responseNeeded),
    suggestedReply: String(candidate?.suggestedReply ?? "").slice(0, 8000),
  };
}

function header(message: GmailMessage, name: string) {
  return message.payload?.headers?.find(
    (item) => item.name.toLowerCase() === name.toLowerCase()
  )?.value ?? "";
}

async function gmailFetch<T>(url: string, accessToken: string, attempt = 0): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 10_000)
      : 600 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return gmailFetch<T>(url, accessToken, attempt + 1);
  }
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Gmail returned HTTP ${response.status}${details ? `: ${details.slice(0, 300)}` : ""}`);
  }
  return (await response.json()) as T;
}

async function fetchMessages(ids: string[], accessToken: string) {
  const messages: GmailMessage[] = [];
  // Gmail applies per-user rate limits. Small batches prevent a first scan from
  // turning 25 parallel metadata calls into a burst-limit failure.
  for (let index = 0; index < ids.length; index += 4) {
    messages.push(...await Promise.all(
      ids.slice(index, index + 4).map((id) => gmailFetch<GmailMessage>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Date&metadataHeaders=Message-ID`,
        accessToken
      ))
    ));
  }
  return messages;
}

async function classify(messages: GmailMessage[], context: string) {
  if (messages.length === 0) return [];
  const input = messages.map((message) => ({
    id: message.id,
    subject: header(message, "Subject"),
    sender: header(message, "From"),
    received: header(message, "Date"),
    snippet: message.snippet ?? "",
  }));
  const prompt = `You are the email intelligence layer of a private executive assistant.
Return only a JSON array, never markdown. Classify every email once.
Allowed type values: task, deadline, meeting, reminder, project_update, scholarship, research, club_event, financial_aid, travel, interview, invoice, no_action.
Allowed importance: low, normal, high, urgent.
Use null when date or time is genuinely unknown. Time must be HH:mm. Dates must be YYYY-MM-DD.
Never invent commitments. actionRequired means the owner must decide or do something.
Recommendations must be concise, specific, and preserve stated deadlines and priorities.
responseNeeded is true only when the owner personally owes a reply. suggestedReply must be a concise draft in the owner's style and must never claim an action was completed unless context proves it. It may be empty when no response is needed.
Each object: {id,type,importance,actionRequired,title,summary,rationale,date,time,duration,category,confidence,recommendations,responseNeeded,suggestedReply}.
Allowed category values: school, fitness, work, health, personal, finance, other.

Current ASS context:
${context}

Messages:
${JSON.stringify(input)}`;
  let result;
  try {
    result = await getGeminiModel().generateContent(prompt);
  } catch (error) {
    if (!String(error).includes("429")) throw error;
    rotateGeminiKey();
    result = await getGeminiModel().generateContent(prompt);
  }
  try {
    const parsed = JSON.parse(
      result.response.text().replace(/```json|```/g, "").trim()
    ) as Partial<Classification>[];
    const byId = new Map(
      (Array.isArray(parsed) ? parsed : [])
        .filter((item) => typeof item?.id === "string")
        .map((item) => [String(item.id), item])
    );
    return messages.map((message) => safeClassification(message, byId.get(message.id)));
  } catch (error) {
    console.error(JSON.stringify({ service: "gmail-intelligence", stage: "invalid-model-json", message: error instanceof Error ? error.message : "Invalid JSON" }));
    return messages.map((message) => safeClassification(message));
  }
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function stableEmailId(accountId: string, messageId: string, kind: string) {
  return 6_000_000_000 + createHash("sha256").update(`${accountId}:${messageId}:${kind}`).digest().readUInt32BE(0);
}

function conflictAnalysis(
  item: Classification,
  plans: Array<{ title: string; date: string; start_label: string; end_label: string; priority: string }>
) {
  if (!item.date || !item.time || !["meeting", "club_event", "interview", "travel"].includes(item.type)) {
    return { conflicts: [] as string[], recommendations: item.recommendations ?? [] };
  }
  const start = minutes(item.time);
  const end = start + Math.max(15, item.duration || 60);
  const overlaps = plans.filter((plan) => {
    if (plan.date !== item.date) return false;
    const planStart = minutes(plan.start_label);
    const planEnd = minutes(plan.end_label);
    return start < planEnd && planStart < end;
  });
  if (overlaps.length === 0) {
    return {
      conflicts: [],
      recommendations: [`Would you like to attend ${item.title}?`, ...(item.recommendations ?? [])],
    };
  }
  const conflicts = overlaps.map(
    (plan) => `${plan.title} (${plan.start_label}–${plan.end_label})`
  );
  const movable = overlaps.find((plan) => plan.priority !== "high");
  return {
    conflicts,
    recommendations: movable
      ? [
          `Move ${movable.title} to the next open block after the event.`,
          `Keep ${movable.title} and decline ${item.title}.`,
          ...(item.recommendations ?? []),
        ]
      : [
          `Decline ${item.title}; it conflicts with a high-priority commitment.`,
          ...(item.recommendations ?? []),
        ],
  };
}

async function contextForUser(userId: string) {
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const today = new Date();
  const through = new Date(today);
  through.setDate(through.getDate() + 90);
  const [plans, todos, habits, courses, styles, sourceContext] = await Promise.all([
    supabase.from("plans").select("title,date,start_label,end_label,priority").eq("user_id", userId).gte("date", today.toISOString().slice(0, 10)).lte("date", through.toISOString().slice(0, 10)).order("date").limit(250),
    supabase.from("todos").select("title,priority,due_date").eq("user_id", userId).eq("done", false).limit(40),
    supabase.from("habits").select("name,frequency,time_preference").eq("user_id", userId).limit(30),
    supabase.from("academic_courses").select("name,course_code,status").eq("user_id", userId).limit(30),
    supabase.from("writing_style_profiles").select("context_type,traits,sample_count").eq("user_id", userId),
    supabase.from("file_extractions").select("classification,summary,structured_data,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
  ]);
  const error = [plans, todos, habits, courses, styles, sourceContext].find((result) => result.error)?.error;
  if (error) throw error;
  return {
    plans: (plans.data ?? []) as Array<{ title: string; date: string; start_label: string; end_label: string; priority: string }>,
    prompt: JSON.stringify({ calendar: plans.data ?? [], tasks: todos.data ?? [], habits: habits.data ?? [], classes: courses.data ?? [], writingStyles: styles.data ?? [], selectedDocumentContext: sourceContext.data ?? [] }),
  };
}

export async function scanRecentGmailSuggestions(userId: string, onlyAccountId?: string) {
  const runId = randomUUID();
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const accounts = (await listGoogleAccounts(userId)).filter(
    (account) => !onlyAccountId || String(account.id) === onlyAccountId
  );
  const context = await contextForUser(userId);
  const all: EmailIntelligenceItem[] = [];
  const failures: string[] = [];

  for (const account of accounts) {
    const accountId = String(account.id);
    try {
      await supabase.from("google_tokens").update({ email_sync_status: "syncing", email_sync_error: null }).eq("id", accountId).eq("user_id", userId);
      const accessToken = await getGoogleAccessToken(userId, accountId);
      const list = await gmailFetch<GmailMessageList>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${encodeURIComponent("newer_than:7d")}`,
        accessToken
      );
      const ids = (list.messages ?? []).map((message) => message.id);
      const { data: existing } = ids.length
        ? await supabase.from("email_suggestions").select("external_id").eq("user_id", userId).eq("google_account_id", accountId).in("external_id", ids)
        : { data: [] };
      const seen = new Set((existing ?? []).map((row) => String(row.external_id)));
      const pending = (list.messages ?? []).filter((message) => !seen.has(message.id));
      const messages = await fetchMessages(pending.map((message) => message.id), accessToken);
      const classifications = await classify(messages, context.prompt);
      const byId = new Map(classifications.map((item) => [item.id, item]));
      const processedAt = new Date().toISOString();
      const rows = messages.map((message) => {
        const item = safeClassification(message, byId.get(message.id));
        const analysis = conflictAnalysis(item, context.plans);
        const receivedAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null;
        all.push({ id: `${accountId}:${message.id}`, accountEmail: String(account.connected_email ?? "Google account"), sender: header(message, "From"), title: item.title, summary: item.summary, type: item.type, importance: item.importance, actionRequired: item.actionRequired, date: item.date, time: item.time, conflictDetails: analysis.conflicts, recommendations: analysis.recommendations, receivedAt });
        return {
          user_id: userId, google_account_id: accountId, external_id: message.id,
          message_id: header(message, "Message-ID") || message.id, thread_id: message.threadId ?? null,
          sender: header(message, "Reply-To") || header(message, "From"), received_at: receivedAt,
          title: item.title, date: item.date, time: item.time, duration: item.duration,
          category: item.category, source: message.snippet ?? "",
          intelligence_type: item.type, importance: item.importance,
          action_required: item.actionRequired, summary: item.summary,
          rationale: item.rationale, confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
          response_needed: item.responseNeeded, suggested_reply: item.suggestedReply,
          conflict_details: analysis.conflicts, recommendations: analysis.recommendations,
          processed_at: processedAt, status: item.type === "no_action" ? "dismissed" : "pending",
        };
      });
      if (rows.length > 0) {
        const { data: savedSuggestions, error } = await supabase.from("email_suggestions").upsert(rows, { onConflict: "user_id,google_account_id,external_id" }).select("id,external_id,intelligence_type,action_required,response_needed,suggested_reply,confidence,conflict_details,recommendations,status,title,sender,thread_id,message_id");
        if (error) throw error;
        const draftRows = (savedSuggestions ?? []).filter((row) => row.response_needed && Number(row.confidence) >= 0.82 && String(row.suggested_reply ?? "").trim()).map((row) => ({
          user_id: userId, google_account_id: accountId, email_suggestion_id: row.id, thread_id: row.thread_id, in_reply_to_message_id: row.message_id,
          recipient: String(row.sender ?? "").match(/<([^>]+)>/)?.[1] ?? String(row.sender ?? "").match(/[\w.+-]+@[\w.-]+/)?.[0] ?? null,
          subject: String(row.title ?? "Reply").match(/^re:/i) ? String(row.title) : `Re: ${String(row.title ?? "Reply")}`,
          body: String(row.suggested_reply), context_snapshot: { generatedFrom: "gmail_scan", styleProfilesIncluded: true }, status: "ready", updated_at: processedAt,
        }));
        if (draftRows.length) { const { error: draftError } = await supabase.from("email_drafts").upsert(draftRows, { onConflict: "email_suggestion_id" }); if (draftError) throw draftError; }
        const emailActions = (savedSuggestions ?? []).filter((row) => row.intelligence_type !== "no_action").map((row) => ({
          user_id: userId,
          email_suggestion_id: row.id,
          action_type: ["meeting", "club_event", "interview", "travel"].includes(String(row.intelligence_type)) ? "event_decision" : "review",
          required: Boolean(row.action_required),
          confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
          conflict_details: Array.isArray(row.conflict_details) ? row.conflict_details : [],
          recommendation: Array.isArray(row.recommendations) ? String(row.recommendations[0] ?? "") || null : null,
          status: row.status === "pending" ? "pending" : "ignored",
          updated_at: processedAt,
        }));
        if (emailActions.length) {
          const { error: actionError } = await supabase.from("email_action_items").upsert(emailActions, { onConflict: "user_id,email_suggestion_id" });
          if (actionError) throw actionError;
        }
        const actionable = rows.filter((row) => row.action_required && row.confidence >= 0.82 && row.intelligence_type !== "no_action");
        const taskTypes = new Set(["task", "deadline", "reminder", "financial_aid", "invoice", "scholarship", "research", "project_update"]);
        const taskRows = actionable.filter((row) => taskTypes.has(row.intelligence_type)).map((row) => ({
          user_id: userId,
          local_id: stableEmailId(accountId, row.external_id, "task"),
          title: row.title,
          done: false,
          priority: row.importance === "urgent" || row.importance === "high" ? "high" : "medium",
          duration: row.duration,
          due_date: row.date,
          tags: [row.intelligence_type, "email", String(account.connected_email ?? "google")],
          recurrence: "none",
          subtasks: [],
          updated_at: processedAt,
        }));
        if (taskRows.length) {
          const { error } = await supabase.from("todos").upsert(taskRows, { onConflict: "user_id,local_id" });
          if (error) throw error;
        }
        const deadlineEvents = actionable.filter((row) => row.date && ["deadline", "financial_aid", "invoice"].includes(row.intelligence_type));
        for (const row of deadlineEvents) {
          await createCalendarEvent(userId, {
            title: row.title, date: String(row.date), startLabel: row.time ? formatTimeLabel(row.time) : "12:00 AM",
            endLabel: row.time ? addMinutesToLabel(row.time, Math.max(15, row.duration)) : "11:59 PM", allDay: !row.time,
            recurrence: "none", category: row.category, priority: row.importance === "urgent" || row.importance === "high" ? "high" : "medium",
            notes: row.summary, sourceKind: "gmail", sourceId: `${accountId}:${row.external_id}:deadline`, syncToGoogle: false, googleAccountId: accountId,
          });
        }
        const alertRows = actionable.map((row) => ({
          user_id: userId,
          dedupe_key: `email:${accountId}:${row.external_id}`,
          kind: `email_${row.intelligence_type}`,
          severity: row.importance === "urgent" ? "urgent" : row.importance === "high" ? "high" : "normal",
          title: row.title,
          summary: row.summary,
          recommendation: row.recommendations[0] ?? (row.date ? `Complete by ${row.date}.` : "Review this email and decide the next action."),
          action_type: taskTypes.has(row.intelligence_type) ? "open_tasks" : "review",
          action_payload: { emailSuggestionId: row.external_id, googleAccountId: accountId },
          status: "pending",
          updated_at: processedAt,
        }));
        if (alertRows.length) {
          const { error } = await supabase.from("assistant_alerts").upsert(alertRows, { onConflict: "user_id,dedupe_key" });
          if (error) throw error;
        }
      }
      await supabase.from("google_tokens").update({ last_email_sync_at: processedAt, email_sync_status: "synced", email_sync_error: null, updated_at: processedAt }).eq("id", accountId).eq("user_id", userId);
      console.info(JSON.stringify({ service: "gmail-intelligence", runId, account: accountId.slice(0, 8), processed: rows.length }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Gmail failure";
      failures.push(`${accountId.slice(0, 8)}: ${message}`);
      await supabase.from("google_tokens").update({ email_sync_status: "error", email_sync_error: message, updated_at: new Date().toISOString() }).eq("id", accountId).eq("user_id", userId);
      console.error(JSON.stringify({ service: "gmail-intelligence", runId, account: accountId.slice(0, 8), stage: "failed", message }));
    }
  }
  return { connected: accounts.length > 0, suggestions: all, accounts: accounts.length, failures };
}
