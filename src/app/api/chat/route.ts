import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { assistantActionTypes, executeAssistantActions, type AssistantAction, type AssistantActionResult } from "@/lib/assistantActionExecutor";
import { getGeminiModel, rotateGeminiKey } from "@/lib/gemini";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const maxDuration = 60;

function cleanJson(value: string) { return value.replace(/^```json\s*|\s*```$/g, "").trim(); }
function readModelResponse(raw: string) {
  const parsed = JSON.parse(cleanJson(raw)) as { reply?: unknown; actions?: unknown };
  const actions = Array.isArray(parsed.actions) ? parsed.actions.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const action = candidate as Partial<AssistantAction>;
    return assistantActionTypes.includes(action.type as AssistantAction["type"]) ? [action as AssistantAction] : [];
  }).slice(0, 10) : [];
  return { reply: String(parsed.reply ?? "").trim(), actions };
}

function resultReply(results: AssistantActionResult[]) {
  const parts = results.filter((result) => result.success).map((result) => result.summary);
  for (const result of results.filter((item) => item.status === "requires_confirmation")) parts.push(result.conflicts?.length ? `${result.summary} I found an alternate time; confirm the action card if you want me to use it.` : `${result.summary} Please confirm the action card.`);
  for (const result of results.filter((item) => item.status === "failed")) parts.push(`I understood the request, but ${result.summary.toLowerCase()}`);
  return parts.join("\n\n") || "I understood, but no executable action was produced.";
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let runId: string = randomUUID();
  try {
    const user = await requireApiUser(request);
    const body = await request.json() as { message?: string; messages?: unknown[]; confirmedActions?: AssistantAction[]; runId?: string; timeZone?: string };
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    if (Array.isArray(body.confirmedActions)) {
      runId = body.runId ?? runId;
      const results = await executeAssistantActions(user.id, body.confirmedActions, { confirmed: true, timeZone: body.timeZone });
      const reply = resultReply(results);
      await supabase.from("assistant_action_runs").update({ execution_results: results, final_reply: reply, status: results.every((result) => result.success) ? "completed" : "partial", completed_at: new Date().toISOString() }).eq("id", runId).eq("user_id", user.id);
      return NextResponse.json({ reply, actionResults: results, runId });
    }
    const message = String(body.message ?? "").trim();
    if (!message) throw new ApiAuthError("A chat message is required.", 400);
    const [plans, todos, profile] = await Promise.all([
      supabase.from("plans").select("local_id,canonical_event_id,title,date,start_label,end_label,category,priority,source,google_event_id").eq("user_id", user.id).order("date").limit(300),
      supabase.from("todos").select("local_id,title,due_date,priority,done").eq("user_id", user.id).eq("done", false).limit(200),
      supabase.from("profiles").select("display_name,primary_email,gmail_connected").eq("user_id", user.id).maybeSingle(),
    ]);
    const queryError = [plans, todos, profile].find((result) => result.error)?.error;
    if (queryError) throw queryError;
    await supabase.from("assistant_action_runs").insert({ id: runId, user_id: user.id, request_text: message });
    const prompt = `You are ASS, a concise executive assistant. Return strict JSON only with shape {"reply":"...","actions":[]}.
Current time: ${new Date().toISOString()}. User timezone: ${body.timeZone ?? "America/New_York"}.
For ordinary conversation, actions is empty. For scheduling/action intent, provide executable structured actions and do not claim success in reply.
Every explicit request using schedule, add to calendar, block time, create a task, remind me, or add a deadline MUST emit the corresponding action. Do this even if the requested time appears to conflict; never resolve conflicts in prose because the executor is authoritative and will return alternatives.
Allowed action types: ${assistantActionTypes.join(", ")}.
Action fields: type, title, start, end, dueAt, category, priority, notes, canonicalEventId, localId, taskLocalId, deleteFromGoogle, decision, emailSuggestionId, googleAccountId, subject, body.
Dates must be unambiguous ISO-8601. Resolve today/tomorrow relative to Current time. Study requests use create_study_block. Reminders without a scheduled time use create_task. Due dates use create_deadline.
Never invent an existing object ID. If an update/delete target cannot be identified exactly from the supplied calendar, ask one concise question and emit no action.
Do not move classes, labs, exams, work, interviews, or required meetings unless explicitly requested. Never claim completion; execution writes the final reply.
Calendar: ${JSON.stringify(plans.data ?? [])}
Open tasks: ${JSON.stringify(todos.data ?? [])}
Profile: ${JSON.stringify(profile.data ?? {})}
Recent chat: ${JSON.stringify((body.messages ?? []).slice(-12))}
User: ${message}`;
    let generation;
    try { generation = await getGeminiModel().generateContent(prompt); }
    catch (error) { if (!String(error).includes("429")) throw error; rotateGeminiKey(); generation = await getGeminiModel().generateContent(prompt); }
    const raw = generation.response.text();
    console.info(JSON.stringify({ service: "assistant-chat", stage: "model-response", runId, raw: raw.slice(0, 6000) }));
    let parsed: ReturnType<typeof readModelResponse>;
    try { parsed = readModelResponse(raw); }
    catch (error) {
      console.error(JSON.stringify({ service: "assistant-chat", stage: "parse-failed", runId, message: error instanceof Error ? error.message : "Invalid JSON" }));
      parsed = { reply: raw.trim() || "I could not parse that response.", actions: [] };
    }
    console.info(JSON.stringify({ service: "assistant-chat", stage: "actions-parsed", runId, actions: parsed.actions }));
    const results = parsed.actions.length ? await executeAssistantActions(user.id, parsed.actions, { timeZone: body.timeZone }) : [];
    const reply = results.length ? resultReply(results) : parsed.reply;
    const status = results.some((result) => result.status === "requires_confirmation") ? "awaiting_confirmation" : results.some((result) => !result.success) ? "partial" : "completed";
    await supabase.from("assistant_action_runs").update({ raw_model_response: raw, parsed_actions: parsed.actions, validation_results: results.map((result) => ({ type: result.type, status: result.status, error: result.errorMessage })), conflict_results: results.filter((result) => result.conflicts?.length), execution_results: results, final_reply: reply, status, completed_at: new Date().toISOString() }).eq("id", runId).eq("user_id", user.id);
    console.info(JSON.stringify({ service: "assistant-chat", stage: "completed", runId, status, durationMs: Date.now() - startedAt }));
    return NextResponse.json({ reply, actionResults: results, runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The AI chat route failed.";
    console.error(JSON.stringify({ service: "assistant-chat", stage: "failed", runId, message, durationMs: Date.now() - startedAt }));
    return NextResponse.json({ reply: `I understood the request, but I could not complete it because ${message}`, error: message, runId }, { status: error instanceof ApiAuthError ? error.status : 500 });
  }
}
