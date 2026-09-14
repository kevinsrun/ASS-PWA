import { randomUUID } from "crypto";
import { addMinutesToLabel, labelToMinutes } from "@/lib/dateTime";
import { deleteCanonicalEvent } from "@/lib/calendarDeletion";
import { createCanonicalEvent, createDeadline, createEmailDraft, createEventDecision, createTask } from "@/lib/objectCreation";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import { updateGoogleCalendarEvent } from "@/lib/googleCalendarSync";
import type { PlanCategory, PlanPriority, SavedPlan } from "@/lib/types";

export const assistantActionTypes = ["create_calendar_event", "update_calendar_event", "delete_calendar_event", "create_task", "create_deadline", "create_study_block", "move_event", "reschedule_task", "create_event_decision", "create_email_draft"] as const;
export type AssistantActionType = typeof assistantActionTypes[number];
export type AssistantAction = {
  type: AssistantActionType; title?: string; start?: string; end?: string; dueAt?: string;
  category?: string; priority?: PlanPriority; notes?: string; sourceId?: string;
  canonicalEventId?: string; localId?: number; deleteFromGoogle?: boolean;
  taskLocalId?: number; decision?: "going" | "maybe" | "not_going" | "add_to_calendar" | "ignore" | "approve" | "reject";
  emailSuggestionId?: number; googleAccountId?: string; subject?: string; body?: string;
};
export type AssistantActionResult = {
  type: AssistantActionType; success: boolean; status: "completed" | "failed" | "requires_confirmation";
  createdObjectId: string | null; errorMessage: string | null; summary: string; action: AssistantAction;
  conflicts?: string[]; suggestedAction?: AssistantAction;
};

const categoryMap: Record<string, PlanCategory> = { study: "school", school: "school", fitness: "fitness", workout: "fitness", work: "work", health: "health", personal: "personal", finance: "finance", other: "other" };
const risky = new Set<AssistantActionType>(["delete_calendar_event", "update_calendar_event", "move_event", "reschedule_task", "create_email_draft"]);

function toParts(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date/time: ${value}`);
  return {
    date: date.toLocaleDateString("en-CA", { timeZone }),
    label: date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone }),
    instant: date,
  };
}

async function conflictCheck(userId: string, action: AssistantAction, timeZone: string) {
  if (!action.start || !action.end) return { conflicts: [] as string[], suggestedAction: undefined as AssistantAction | undefined };
  const start = toParts(action.start, timeZone); const end = toParts(action.end, timeZone);
  if (end.instant <= start.instant) throw new Error("End time must be after start time.");
  const supabase = getServiceSupabaseClient()!;
  const { data, error } = await supabase.from("plans").select("canonical_event_id,title,start_label,end_label,category,priority").eq("user_id", userId).eq("date", start.date).eq("all_day", false);
  if (error) throw error;
  const startMinutes = labelToMinutes(start.label); const endMinutes = labelToMinutes(end.label);
  const overlaps = (data ?? []).filter((plan) => String(plan.canonical_event_id ?? "") !== String(action.canonicalEventId ?? "") && startMinutes < labelToMinutes(String(plan.end_label)) && labelToMinutes(String(plan.start_label)) < endMinutes);
  if (!overlaps.length) return { conflicts: [], suggestedAction: undefined };
  const latestEnd = Math.max(...overlaps.map((plan) => labelToMinutes(String(plan.end_label))));
  const duration = Math.max(15, Math.round((end.instant.getTime() - start.instant.getTime()) / 60_000));
  const alternateStart = addMinutesToLabel(`${Math.floor(latestEnd / 60)}:${String(latestEnd % 60).padStart(2, "0")}`, 15);
  const alternateEnd = addMinutesToLabel(alternateStart, duration);
  const alternateDate = start.date;
  const localIso = (label: string) => {
    const minutes = labelToMinutes(label); const hour = String(Math.floor(minutes / 60)).padStart(2, "0"); const minute = String(minutes % 60).padStart(2, "0");
    return `${alternateDate}T${hour}:${minute}:00`;
  };
  return {
    conflicts: overlaps.map((plan) => `${String(plan.title)} (${String(plan.start_label)}–${String(plan.end_label)})`),
    suggestedAction: { ...action, start: localIso(alternateStart), end: localIso(alternateEnd) },
  };
}

function failure(action: AssistantAction, error: unknown): AssistantActionResult {
  const message = error instanceof Error ? error.message : "Unknown execution failure";
  return { type: action.type, success: false, status: "failed", createdObjectId: null, errorMessage: message, summary: `Could not complete ${action.type.replaceAll("_", " ")}: ${message}`, action };
}

export async function executeAssistantActions(userId: string, actions: AssistantAction[], options?: { confirmed?: boolean; timeZone?: string }) {
  const timeZone = options?.timeZone ?? "America/New_York";
  const results: AssistantActionResult[] = [];
  for (const input of actions.slice(0, 10)) {
    const action = { ...input, sourceId: input.sourceId ?? `chat:${randomUUID()}` };
    console.info(JSON.stringify({ service: "assistant-action-executor", stage: "validation-started", type: action.type, sourceId: action.sourceId }));
    if (!assistantActionTypes.includes(action.type)) { results.push(failure(action, new Error("Unsupported assistant action."))); continue; }
    if (risky.has(action.type) && !options?.confirmed) {
      results.push({ type: action.type, success: false, status: "requires_confirmation", createdObjectId: null, errorMessage: null, summary: `${action.type.replaceAll("_", " ")} requires confirmation.`, action });
      continue;
    }
    try {
      if (["create_calendar_event", "create_study_block"].includes(action.type)) {
        if (!action.title || !action.start || !action.end) throw new Error("Title, start, and end are required.");
        const conflict = await conflictCheck(userId, action, timeZone);
        console.info(JSON.stringify({ service: "assistant-action-executor", stage: "conflict-checked", type: action.type, conflicts: conflict.conflicts }));
        if (conflict.conflicts.length && !options?.confirmed) {
          results.push({ type: action.type, success: false, status: "requires_confirmation", createdObjectId: null, errorMessage: null, summary: `This overlaps ${conflict.conflicts.join(", ")}.`, action, conflicts: conflict.conflicts, suggestedAction: conflict.suggestedAction });
          continue;
        }
        const start = toParts(action.start, timeZone); const end = toParts(action.end, timeZone);
        const supabase = getServiceSupabaseClient()!;
        const { count } = await supabase.from("google_tokens").select("id", { count: "exact", head: true }).eq("user_id", userId);
        const created = await createCanonicalEvent(userId, { title: action.title, date: start.date, startLabel: start.label, endLabel: end.label, recurrence: "none", category: action.type === "create_study_block" ? "school" : categoryMap[action.category ?? "personal"] ?? "personal", priority: action.priority ?? "medium", notes: action.notes ?? "Created from ASS chat", sourceKind: "assistant", sourceId: action.sourceId!, syncToGoogle: Boolean(count) });
        results.push({ type: action.type, success: true, status: "completed", createdObjectId: created.canonicalEventId, errorMessage: created.googleError, summary: `${action.title} was added to the calendar${created.googleSynced ? " and synced to Google" : ""}.`, action });
      } else if (action.type === "create_task") {
        if (!action.title) throw new Error("Task title is required.");
        const created = await createTask(userId, { sourceKind: "assistant", sourceId: action.sourceId!, title: action.title, dueDate: action.dueAt?.slice(0, 10) ?? null, priority: action.priority });
        results.push({ type: action.type, success: true, status: "completed", createdObjectId: String(created.localId), errorMessage: null, summary: `${action.title} was added to tasks.`, action });
      } else if (action.type === "create_deadline") {
        if (!action.title || !action.dueAt) throw new Error("Deadline title and due time are required.");
        const created = await createDeadline(userId, { sourceKind: "assistant", sourceId: action.sourceId!, title: action.title, dueAt: action.dueAt, timeZone, priority: action.priority, notes: action.notes });
        results.push({ type: action.type, success: true, status: "completed", createdObjectId: created.id, errorMessage: created.event.googleError, summary: `${action.title} was added as a task and deadline.`, action });
      } else if (action.type === "delete_calendar_event") {
        const deleted = await deleteCanonicalEvent(userId, { canonicalEventId: action.canonicalEventId, localId: action.localId, deleteFromGoogle: action.deleteFromGoogle });
        results.push({ type: action.type, success: true, status: "completed", createdObjectId: action.canonicalEventId ?? String(action.localId), errorMessage: null, summary: deleted.googleDeleted ? "The event was deleted from ASS and Google Calendar." : "The event was hidden from ASS.", action });
      } else if (["update_calendar_event", "move_event"].includes(action.type)) {
        if (!action.canonicalEventId || !action.start || !action.end) throw new Error("An exact calendar event, start, and end are required.");
        const supabase = getServiceSupabaseClient()!;
        const { data: current, error } = await supabase.from("plans").select("*").eq("user_id", userId).eq("canonical_event_id", action.canonicalEventId).single();
        if (error || !current) throw error ?? new Error("Calendar event not found.");
        const start = toParts(action.start, timeZone); const end = toParts(action.end, timeZone);
        const title = action.title?.trim() || String(current.title);
        const { error: planError } = await supabase.from("plans").update({ title, date: start.date, start_label: start.label, end_label: end.label, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("canonical_event_id", action.canonicalEventId);
        if (planError) throw planError;
        const { error: canonicalError } = await supabase.from("canonical_events").update({ title, start_at: start.instant.toISOString(), end_at: end.instant.toISOString(), updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", action.canonicalEventId);
        if (canonicalError) throw canonicalError;
        let googleError: string | null = null;
        if (current.google_calendar_id && current.google_event_id) {
          const status = await updateGoogleCalendarEvent(userId, {
            id: Number(current.local_id), title, date: start.date, startLabel: start.label, endLabel: end.label,
            recurrence: current.recurrence ?? "none", category: current.category ?? "other", priority: current.priority ?? "medium",
            notes: current.notes ?? "", customRecurrence: current.custom_recurrence ?? "", source: current.source ?? "ass",
            googleEventId: current.google_event_id, googleAccountId: current.google_account_id,
            googleCalendarId: current.google_calendar_id, googleRecurringEventId: current.google_recurring_event_id,
            googleColor: current.google_color, googleEtag: current.google_etag, googleUpdatedAt: current.google_updated_at,
            allDay: Boolean(current.all_day), canonicalEventId: action.canonicalEventId,
          } satisfies SavedPlan);
          if (status.state !== "synced") googleError = status.error ?? "Google Calendar update failed.";
        }
        results.push({ type: action.type, success: true, status: "completed", createdObjectId: action.canonicalEventId, errorMessage: googleError, summary: `${title} was updated${googleError ? ", but Google sync needs attention" : ""}.`, action });
      } else if (action.type === "reschedule_task") {
        if (!action.taskLocalId || !action.dueAt) throw new Error("An exact task and new due date are required.");
        const { error } = await getServiceSupabaseClient()!.from("todos").update({ due_date: action.dueAt.slice(0, 10), updated_at: new Date().toISOString() }).eq("user_id", userId).eq("local_id", action.taskLocalId);
        if (error) throw error;
        results.push({ type: action.type, success: true, status: "completed", createdObjectId: String(action.taskLocalId), errorMessage: null, summary: `${action.title ?? "The task"} was rescheduled.`, action });
      } else if (action.type === "create_event_decision") {
        const created = await createEventDecision(userId, { sourceKind: "file", sourceId: action.sourceId!, decision: action.decision });
        results.push({ type: action.type, success: true, status: "completed", createdObjectId: created.id, errorMessage: null, summary: "The event decision was saved.", action });
      } else if (action.type === "create_email_draft") {
        if (!action.emailSuggestionId || !action.googleAccountId || !action.subject || !action.body) throw new Error("A connected email suggestion, account, subject, and body are required.");
        const created = await createEmailDraft(userId, { googleAccountId: action.googleAccountId, emailSuggestionId: action.emailSuggestionId, subject: action.subject, body: action.body });
        results.push({ type: action.type, success: true, status: "completed", createdObjectId: created.id, errorMessage: null, summary: "The email draft was created for review.", action });
      } else {
        throw new Error("Updating and moving existing objects requires an exact object identifier and is not available from an ambiguous request.");
      }
    } catch (error) { results.push(failure(action, error)); }
    console.info(JSON.stringify({ service: "assistant-action-executor", stage: "execution-result", result: results.at(-1) }));
  }
  return results;
}
