import { NextRequest, NextResponse } from "next/server";
import { addMinutesToLabel, formatTimeLabel } from "@/lib/dateTime";
import { createCanonicalEvent, createEventDecision, createTask, recordClassificationFeedback } from "@/lib/objectCreation";
import { ApiAuthError, requireApiUser } from "@/lib/serverAuth";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import type { EmailIntelligenceItem, PlanCategory } from "@/lib/types";
import { weatherDecisionContext } from "@/lib/weatherContext";
import { ingestDriveFile } from "@/lib/driveIngestion";

function failure(error: unknown) {
  const status = error instanceof ApiAuthError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Intelligence request failed.";
  console.error(JSON.stringify({ service: "intelligence-feed", stage: "failed", message }));
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    const [{ data, error }, accounts, alerts, actionQueue] = await Promise.all([
      supabase
        .from("email_suggestions")
        .select("id,google_account_id,sender,title,summary,intelligence_type,importance,action_required,date,time,conflict_details,recommendations,received_at,disposition,response_needed")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .eq("suppressed", false)
        .neq("intelligence_type", "no_action")
        .order("received_at", { ascending: false })
        .limit(8),
      supabase.from("google_tokens").select("id,connected_email").eq("user_id", user.id),
      supabase.from("assistant_alerts").select("id,kind,severity,title,summary,recommendation,created_at").eq("user_id", user.id).eq("status", "pending").order("created_at", { ascending: false }).limit(8),
      supabase.from("assistant_action_items").select("id,action_type,title,summary,priority,payload,created_at").eq("user_id", user.id).eq("status", "pending").order("created_at", { ascending: false }).limit(8),
    ]);
    if (error) throw error;
    if (accounts.error) throw accounts.error;
    if (alerts.error) throw alerts.error;
    if (actionQueue.error) throw actionQueue.error;
    const emailByAccount = new Map(
      (accounts.data ?? []).map((account) => [String(account.id), String(account.connected_email ?? "Google account")])
    );
    const items: EmailIntelligenceItem[] = (data ?? []).map((item) => ({
      disposition: item.disposition ?? undefined,
      responseNeeded: Boolean(item.response_needed),
      id: String(item.id),
      accountEmail: emailByAccount.get(String(item.google_account_id)) ?? "Google account",
      sender: String(item.sender ?? ""),
      title: String(item.title),
      summary: String(item.summary ?? ""),
      type: item.intelligence_type as EmailIntelligenceItem["type"],
      importance: item.importance as EmailIntelligenceItem["importance"],
      actionRequired: Boolean(item.action_required),
      date: item.date ? String(item.date) : null,
      time: item.time ? String(item.time) : null,
      conflictDetails: Array.isArray(item.conflict_details) ? item.conflict_details.map(String) : [],
      recommendations: Array.isArray(item.recommendations) ? item.recommendations.map(String) : [],
      receivedAt: item.received_at ? String(item.received_at) : null,
    }));
    for (const item of items) {
      try { const weather = await weatherDecisionContext(user.id, item); if (weather) item.recommendations = [weather, ...item.recommendations]; }
      catch (weatherError) { console.warn(JSON.stringify({ service: "intelligence-feed", stage: "weather-unavailable", message: weatherError instanceof Error ? weatherError.message : "Unknown weather error" })); }
    }
    for (const alert of alerts.data ?? []) {
      const kind = String(alert.kind);
      items.push({
        id: `alert:${alert.id}`,
        accountEmail: "ASS",
        sender: "ASS",
        title: String(alert.title),
        summary: String(alert.summary ?? ""),
        type: kind === "calendar_conflict"
          ? "calendar_conflict"
          : kind === "calendar_merge"
            ? "calendar_merge"
            : kind.startsWith("finance_")
              ? "finance_alert"
              : "reminder",
        importance: alert.severity === "urgent" || alert.severity === "high" ? "urgent" : alert.severity === "medium" ? "high" : "normal",
        actionRequired: true,
        date: null,
        time: null,
        conflictDetails: [],
        recommendations: alert.recommendation ? [String(alert.recommendation)] : [],
        receivedAt: alert.created_at ? String(alert.created_at) : null,
      });
    }
    for (const action of actionQueue.data ?? []) items.push({ id: `action:${action.id}`, accountEmail: "ASS", sender: "ASS", title: String(action.title), summary: String(action.summary ?? ""), type: "reminder", importance: action.priority === "urgent" ? "urgent" : action.priority === "high" ? "high" : "normal", actionRequired: true, date: null, time: null, conflictDetails: [], recommendations: [], receivedAt: action.created_at ? String(action.created_at) : null });
    items.sort((left, right) => String(right.receivedAt ?? "").localeCompare(String(left.receivedAt ?? "")));
    return NextResponse.json({ items: items.slice(0, 8) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiUser(request);
    const body = (await request.json()) as { id?: string; action?: "accept" | "dismiss" | "going" | "maybe" | "not_going" | "add_to_calendar" | "ignore" };
    const actions = ["accept", "dismiss", "going", "maybe", "not_going", "add_to_calendar", "ignore"];
    if (!body.id || !body.action || !actions.includes(body.action)) {
      throw new ApiAuthError("An insight and valid action are required.", 400);
    }
    const supabase = getServiceSupabaseClient();
    if (!supabase) throw new Error("A Supabase server key is not configured");
    if (body.id.startsWith("alert:")) {
      if (!["accept", "dismiss", "ignore"].includes(body.action)) throw new ApiAuthError("That action is not available for this alert.", 400);
      const { error: alertError } = await supabase.from("assistant_alerts").update({
        status: body.action === "accept" ? "accepted" : "dismissed",
        updated_at: new Date().toISOString(),
      }).eq("id", body.id.slice(6)).eq("user_id", user.id);
      if (alertError) throw alertError;
      return NextResponse.json({ ok: true });
    }
    if (body.id.startsWith("action:")) {
      if (!["accept", "dismiss", "ignore"].includes(body.action)) throw new ApiAuthError("That action is not available for this item.", 400);
      const actionId = body.id.slice(7);
      const { data: queued, error: queuedError } = await supabase.from("assistant_action_items").select("action_type,payload").eq("id", actionId).eq("user_id", user.id).single();
      if (queuedError || !queued) throw new ApiAuthError("Assistant action not found.", 404);
      if (body.action === "accept" && queued.action_type === "import_file") {
        const payload = queued.payload as { googleAccountId?: string; driveFileId?: string };
        if (!payload.googleAccountId || !payload.driveFileId) throw new ApiAuthError("This Drive action is missing its source file.", 400);
        await ingestDriveFile(user.id, payload.googleAccountId, payload.driveFileId, true);
      } else if (body.action === "accept" && ["review_extraction", "event_decision"].includes(String(queued.action_type))) {
        throw new ApiAuthError("Review this item in Inbox before completing it.", 409);
      }
      const { error: queueError } = await supabase.from("assistant_action_items").update({ status: body.action === "accept" ? "completed" : "dismissed", updated_at: new Date().toISOString() }).eq("id", body.id.slice(7)).eq("user_id", user.id);
      if (queueError) throw queueError;
      return NextResponse.json({ ok: true });
    }
    const { data: item, error } = await supabase
      .from("email_suggestions")
      .select("*")
      .eq("id", body.id)
      .eq("user_id", user.id)
      .single();
    if (error || !item) throw new ApiAuthError("Insight not found.", 404);
    const eventLike = ["meeting", "club_event", "interview", "travel"].includes(String(item.intelligence_type));
    const addEvent = body.action === "accept" || body.action === "going" || body.action === "add_to_calendar";
    if (addEvent) {
      if (eventLike && item.date && item.time) {
        await createCanonicalEvent(user.id, {
          title: String(item.title),
          date: String(item.date),
          startLabel: formatTimeLabel(String(item.time)),
          endLabel: addMinutesToLabel(String(item.time), Number(item.duration ?? 60)),
          recurrence: "none",
          category: (item.category ?? "other") as PlanCategory,
          priority: item.importance === "urgent" || item.importance === "high" ? "high" : "medium",
          notes: String(item.summary ?? item.source ?? ""),
          sourceKind: "gmail", sourceId: String(item.id), syncToGoogle: true,
          googleAccountId: item.google_account_id ? String(item.google_account_id) : undefined,
        });
      } else {
        await createTask(user.id, { sourceKind: "gmail", sourceId: String(item.id), title: String(item.title), priority: item.importance === "urgent" || item.importance === "high" ? "high" : "medium", duration: Number(item.duration ?? 60), dueDate: item.date ?? null, tags: [String(item.intelligence_type), "email"] });
      }
    }
    if (body.action === "maybe") {
      if (!eventLike || !item.date || !item.time) throw new ApiAuthError("A dated event is required for Maybe.", 400);
      await createCanonicalEvent(user.id, {
        title: String(item.title), date: String(item.date), startLabel: formatTimeLabel(String(item.time)),
        endLabel: addMinutesToLabel(String(item.time), Number(item.duration ?? 60)), recurrence: "none",
        category: (item.category ?? "other") as PlanCategory, priority: "low", notes: String(item.summary ?? item.source ?? ""),
        tentative: true, sourceKind: "gmail", sourceId: `${item.id}:maybe`, syncToGoogle: false,
        googleAccountId: item.google_account_id ? String(item.google_account_id) : undefined,
      });
    }
    const decision = body.action === "accept" ? (eventLike ? "add_to_calendar" : null) : body.action === "dismiss" ? "ignore" : body.action;
    if (decision) {
      await createEventDecision(user.id, { sourceKind: "email", sourceId: String(item.id), decision: decision as "going" | "maybe" | "not_going" | "add_to_calendar" | "ignore", tentative: body.action === "maybe", context: { title: item.title, type: item.intelligence_type, conflicts: item.conflict_details ?? [] } });
    }
    const actionStatus = body.action === "going" ? "going" : body.action === "maybe" ? "maybe" : body.action === "not_going" ? "not_going" : addEvent ? "added" : "ignored";
    const { error: actionItemError } = await supabase.from("email_action_items").update({ status: actionStatus, updated_at: new Date().toISOString() }).eq("email_suggestion_id", item.id).eq("user_id", user.id);
    if (actionItemError) throw actionItemError;
    const { error: updateError } = await supabase
      .from("email_suggestions")
      .update({ status: addEvent || body.action === "maybe" ? "accepted" : "dismissed" })
      .eq("id", body.id)
      .eq("user_id", user.id);
    if (updateError) throw updateError;
    await recordClassificationFeedback(user.id, { sourceType: "email", sourceId: String(item.id), originalText: `${String(item.title)}\n${String(item.source ?? item.summary ?? "")}`, predictedLabel: String(item.intelligence_type), confidence: Number(item.confidence ?? 0), correctedLabel: addEvent ? (eventLike ? "calendar_event" : "task") : body.action === "maybe" ? "maybe" : body.action === "going" ? "going" : body.action === "not_going" ? "not_going" : "ignore", userAction: body.action, context: { sender: item.sender, conflicts: item.conflict_details ?? [] } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
