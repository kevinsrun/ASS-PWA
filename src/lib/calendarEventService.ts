import { addMinutesToLabel, formatTimeLabel, labelToMinutes } from "@/lib/dateTime";
import { canonicalEventFingerprint, canonicalPlanLocalId, detectCalendarConflicts, type CanonicalGoogleEvent } from "@/lib/calendarCanonical";
import { createGoogleCalendarEvent } from "@/lib/googleCalendarSync";
import { getServiceSupabaseClient } from "@/lib/supabaseServer";
import type { PlanCategory, PlanPriority, PlanRecurrence, SavedPlan } from "@/lib/types";

export type CalendarEventSource = "manual" | "file" | "text" | "gmail" | "drive" | "task" | "habit" | "project" | "assistant";

export type CalendarEventInput = {
  title: string;
  date: string;
  startLabel?: string;
  endLabel?: string;
  allDay?: boolean;
  timeZone?: string;
  recurrence?: PlanRecurrence;
  recurrenceRule?: string | null;
  category?: PlanCategory;
  priority?: PlanPriority;
  notes?: string;
  location?: string | null;
  tentative?: boolean;
  sourceKind: CalendarEventSource;
  sourceId: string;
  syncToGoogle?: boolean;
  googleAccountId?: string;
  googleCalendarId?: string;
};

export type CalendarEventResult = {
  ok: true;
  canonicalEventId: string;
  planLocalId: number;
  duplicate: boolean;
  conflictCount: number;
  googleSynced: boolean;
  googleError: string | null;
};

function validTimeZone(value?: string) {
  const candidate = value?.trim() || "America/New_York";
  try { new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(); return candidate; }
  catch { return "America/New_York"; }
}

function labelFromMinutes(minutes: number) {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return formatTimeLabel(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
}

function normalizedLabel(value: string) {
  return /\b(?:AM|PM)\b/i.test(value) ? labelFromMinutes(labelToMinutes(value)) : formatTimeLabel(value);
}

function localIso(date: string, label: string, timeZone: string) {
  const minutes = labelToMinutes(label);
  const [year, month, day] = date.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let guess = desired;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const represented = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    guess += desired - represented;
  }
  return new Date(guess).toISOString();
}

function normalize(input: CalendarEventInput) {
  const title = input.title.trim();
  if (!title) throw new Error("Event title is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(new Date(`${input.date}T00:00:00Z`).getTime())) throw new Error("Event date must be YYYY-MM-DD.");
  const timeZone = validTimeZone(input.timeZone);
  const allDay = Boolean(input.allDay);
  const startLabel = allDay ? "12:00 AM" : normalizedLabel(input.startLabel || "09:00");
  let endLabel = allDay ? "11:59 PM" : normalizedLabel(input.endLabel || addMinutesToLabel(startLabel, 60));
  if (!allDay && labelToMinutes(endLabel) === labelToMinutes(startLabel)) endLabel = labelFromMinutes(labelToMinutes(startLabel) + 60);
  const startAt = allDay ? `${input.date}T00:00:00.000Z` : localIso(input.date, startLabel, timeZone);
  const endDate = !allDay && labelToMinutes(endLabel) <= labelToMinutes(startLabel)
    ? new Date(new Date(`${input.date}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
    : input.date;
  const endAt = allDay ? `${input.date}T23:59:59.000Z` : localIso(endDate, endLabel, timeZone);
  return { ...input, title, timeZone, allDay, startLabel, endLabel, startAt, endAt };
}

export async function createCalendarEvent(userId: string, input: CalendarEventInput): Promise<CalendarEventResult> {
  const startedAt = Date.now();
  const event = normalize(input);
  const supabase = getServiceSupabaseClient();
  if (!supabase) throw new Error("A Supabase server key is not configured");
  const { data: sourceTombstone, error: tombstoneError } = await supabase.from("event_sources")
    .select("ignore_future_imports").eq("user_id", userId).eq("source_kind", event.sourceKind).eq("source_id", event.sourceId).maybeSingle();
  if (tombstoneError) throw tombstoneError;
  if (sourceTombstone?.ignore_future_imports) throw new Error("This source was deleted or ignored and cannot recreate the calendar event.");
  console.info(JSON.stringify({ service: "calendar-event-service", stage: "normalized", sourceKind: event.sourceKind, sourceId: event.sourceId, title: event.title, date: event.date, start: event.startLabel, end: event.endLabel, recurrence: event.recurrenceRule ?? event.recurrence ?? "none" }));
  const googleShape: CanonicalGoogleEvent = {
    id: `${event.sourceKind}:${event.sourceId}`,
    summary: event.title,
    description: event.notes,
    location: event.location ?? undefined,
    start: event.allDay ? { date: event.date, timeZone: event.timeZone } : { dateTime: event.startAt, timeZone: event.timeZone },
    end: event.allDay ? { date: event.date, timeZone: event.timeZone } : { dateTime: event.endAt, timeZone: event.timeZone },
  };
  const fingerprint = canonicalEventFingerprint(googleShape);
  const { data: existing, error: existingError } = await supabase.from("canonical_events").select("id").eq("user_id", userId).eq("fingerprint", fingerprint).maybeSingle();
  if (existingError) throw existingError;
  const canonicalRow = {
    user_id: userId, fingerprint, title: event.title, start_at: event.startAt, end_at: event.endAt,
    all_day: event.allDay, time_zone: event.timeZone, location: event.location ?? null, description: event.notes ?? null,
    status: event.tentative ? "tentative" : "confirmed", recurrence_rule: event.recurrenceRule ?? null,
    deleted_at: null, deleted_by_user: false, hidden_from_calendar: false, deletion_reason: null,
    last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const { data: canonical, error: canonicalError } = await supabase.from("canonical_events").upsert(canonicalRow, { onConflict: "user_id,fingerprint" }).select("id").single();
  if (canonicalError || !canonical) throw canonicalError ?? new Error("Canonical event was not created");
  const canonicalId = String(canonical.id);
  const planLocalId = canonicalPlanLocalId(canonicalId);
  const plan: SavedPlan = {
    id: planLocalId, title: event.title, date: event.date, startLabel: event.startLabel, endLabel: event.endLabel,
    recurrence: event.recurrence ?? (event.recurrenceRule ? "custom" : "none"), category: event.category ?? "other",
    priority: event.priority ?? "medium", notes: [event.location, event.notes].filter(Boolean).join("\n\n"),
    customRecurrence: event.recurrenceRule ?? "", source: "ass", googleAccountId: event.googleAccountId,
    googleCalendarId: event.googleCalendarId, allDay: event.allDay, canonicalEventId: canonicalId,
  };
  const { error: planError } = await supabase.from("plans").upsert({
    user_id: userId, local_id: plan.id, title: plan.title, date: plan.date, start_label: plan.startLabel, end_label: plan.endLabel,
    recurrence: plan.recurrence, category: plan.category, priority: plan.priority, notes: plan.notes, custom_recurrence: plan.customRecurrence,
    source: "ass", all_day: plan.allDay, canonical_event_id: canonicalId, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,canonical_event_id" });
  if (planError) throw planError;
  const { error: sourceError } = await supabase.from("event_sources").upsert({
    user_id: userId, canonical_event_id: canonicalId, source_kind: event.sourceKind, source_id: event.sourceId,
    metadata: { tentative: Boolean(event.tentative), recurrenceRule: event.recurrenceRule ?? null }, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,source_kind,source_id" });
  if (sourceError) throw sourceError;
  const conflictCount = await detectCalendarConflicts(userId);
  let googleSynced = false;
  let googleError: string | null = null;
  if (event.syncToGoogle && !event.tentative) {
    try {
      const status = await createGoogleCalendarEvent(userId, plan);
      googleSynced = status.state === "synced";
      if (!googleSynced) googleError = status.error || "Google Calendar did not confirm synchronization.";
      console.info(JSON.stringify({ service: "calendar-event-service", stage: "google-result", sourceId: event.sourceId, state: status.state, error: status.error ?? null }));
    } catch (error) {
      googleError = error instanceof Error ? error.message : "Google Calendar synchronization failed.";
      console.error(JSON.stringify({ service: "calendar-event-service", stage: "google-failed", sourceId: event.sourceId, message: googleError }));
    }
  }
  console.info(JSON.stringify({ service: "calendar-event-service", stage: "created", sourceKind: event.sourceKind, sourceId: event.sourceId, canonicalEventId: canonicalId, planLocalId, duplicate: Boolean(existing), conflictCount, googleSynced, googleError, durationMs: Date.now() - startedAt }));
  return { ok: true, canonicalEventId: canonicalId, planLocalId, duplicate: Boolean(existing), conflictCount, googleSynced, googleError };
}
